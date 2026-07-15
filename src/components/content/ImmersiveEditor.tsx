import { useCallback, useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { KeyboardEvent } from "react";
import { deserializeHtmlToMarkdown } from "../../services/render";

/**
 * ImmersiveEditor — 类 Typora 的无感编辑组件。
 *
 * 以 `contentEditable` 容器承载经 DOMPurify 净化后的渲染 HTML，
 * 用户可直接在渲染态点击编辑文本。编辑结果提取为纯文本并同步到
 * documentStore.content（经上层 onContentChange），再由渲染管线
 * （marked → DOMPurify → KaTeX）回灌为新的 sanitized HTML。
 *
 * 设计要点：
 * - 不引入 ProseMirror / Lexical / TipTap 等富文本框架。
 * - 渲染输出仍经过 DOMPurify 净化（由上层渲染管线保证）。
 * - 自身编辑触发的渲染回流不重置 DOM（避免光标跳动）；
 *   仅当文档身份切换或外部内容变更时，才以新的 renderedHtml 重置。
 * - 光标位置在重置前后尽量保持：以 Selection API 的字符偏移量
 *   （相对 contentEditable 容器）记录并恢复。
 * - 内部 .md 链接与外链仍走与 ContentArea 一致的委托逻辑。
 * - 粘贴仅保留纯文本，避免引入未净化 HTML。
 * - DOM→Markdown 反序列化（v0.1.6 起，T10）：onInput 时不再提取纯文本
 *   （会丢失 `#`、`**` 等语法标记），改为遍历 contentEditable DOM 重建
 *   Markdown 源码（见 services/render/serialize.ts）。支持标题/段落/
 *   列表/引用/代码块/表格/粗体/斜体/删除线/行内代码；公式块以携带源码
 *   的 `.math-source-block` 容器呈现，编辑时以源码块参与回写（不实现
 *   公式本身的 WYSIWYG 编辑，符合 out_of_scope）。
 *
 * 已知限制：
 * - 公式块以渲染态呈现，用户直接编辑 KaTeX DOM 不会被反序列化捕获；
 *   公式的可编辑事实源是容器上的 `data-formula-source`。这是“不实现公式
 *   WYSIWYG”约束的直接结果，符合 acceptance_criteria。
 */

interface ImmersiveEditorProps {
  /** Markdown 源码（documentStore.content） */
  content: string;
  /** 经渲染管线净化后的 HTML（renderedHtml） */
  renderedHtml: string;
  /** 是否正在渲染中 */
  isRenderPending: boolean;
  /** 内容变化回调（同步到 documentStore.content） */
  onContentChange: (content: string) => void;
  /** 打开工作区内 .md 文档 */
  onOpenDocument: (relativePath: string) => void;
  /** 容器 ref（供 FindBar 使用） */
  previewRef: React.RefObject<HTMLDivElement | null>;
  /** 点击事件回调（图片错误重试、链接委托等，由 ContentArea 注入） */
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * 计算当前 Selection 在给定容器内的字符偏移。
 * 返回 { start, end }；无选区或选区不在容器内时返回 null。
 *
 * 用 Range.selectNodeContents + setEnd 测量字符偏移，对跨节点
 * 选区也能给出近似值，用于 DOM 重置后恢复光标。
 */
function getSelectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  const measure = (node: Node, offset: number): number => {
    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(node, offset);
    return preRange.toString().length;
  };

  try {
    return {
      start: measure(range.startContainer, range.startOffset),
      end: measure(range.endContainer, range.endOffset),
    };
  } catch {
    return null;
  }
}

/**
 * 在容器内将字符偏移恢复为 Selection。
 * 通过 TreeWalker 遍历文本节点累加长度定位目标位置。
 */
function setSelectionOffsets(container: HTMLElement, start: number, end: number): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let charCount = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  let node: Text | null = walker.nextNode() as Text | null;
  while (node) {
    const len = node.nodeValue?.length ?? 0;
    if (!startNode && charCount + len >= start) {
      startNode = node;
      startOffset = start - charCount;
    }
    if (!endNode && charCount + len >= end) {
      endNode = node;
      endOffset = end - charCount;
    }
    if (startNode && endNode) break;
    charCount += len;
    node = walker.nextNode() as Text | null;
  }

  const sel = window.getSelection();
  if (!sel) return;
  const newRange = document.createRange();
  try {
    if (startNode) {
      const startClamped = Math.min(startOffset, startNode.nodeValue?.length ?? 0);
      newRange.setStart(startNode, startClamped);
      if (endNode) {
        newRange.setEnd(endNode, Math.min(endOffset, endNode.nodeValue?.length ?? 0));
      } else {
        newRange.setEnd(startNode, startClamped);
      }
    } else {
      newRange.selectNodeContents(container);
      newRange.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(newRange);
  } catch {
    // 选区恢复失败不应阻断渲染
  }
}

/**
 * 在当前 Selection 处插入纯文本。
 * 优先用 Selection API（Range.insertNode），避免依赖已废弃的
 * `document.execCommand("insertText")`。Selection API 不可用时
 * 回退到 execCommand；两者都不可用则放弃插入（已知降级，粘贴阶段
 * 已 preventDefault，用户需重新粘贴或手动键入）。
 */
function insertPlainText(text: string): void {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    // 先删除选中内容，再在原位插入
    sel.deleteFromDocument();
  }
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const textNode = document.createTextNode(text);
    try {
      range.insertNode(textNode);
      // 将选区折叠到插入文本之后，使后续输入接续
      const newRange = document.createRange();
      newRange.setStartAfter(textNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      return;
    } catch {
      // Selection API 路径失败 → 回退 execCommand
    }
  }
  if (typeof document.execCommand === "function") {
    document.execCommand("insertText", false, text);
  }
}

function ImmersiveEditor({
  content,
  renderedHtml,
  isRenderPending,
  onContentChange,
  onOpenDocument,
  previewRef,
  onClick,
}: ImmersiveEditorProps) {
  const editableRef = useRef<HTMLDivElement>(null);
  // 最近一次由本组件 onInput 触发同步的 content，用于判定
  // 后续的 content/renderedHtml 变化是否来自自身编辑（避免重置 DOM）。
  const lastEmittedContentRef = useRef<string>("");
  // 是否已产生过一次自身编辑回流（用于区分初始空内容与自身发出的空内容）。
  const hasEmittedRef = useRef<boolean>(false);

  /**
   * 从 contentEditable 容器反序列化为 Markdown 源码。
   *
   * 替换原 innerText 纯文本提取（v0.1.6 起，T10）：遍历渲染态 DOM
   * 重建 Markdown 语法标记，使编辑后内容能正确回写为 Markdown 源码，
   * 不再丢失 `#`、`**`、`` ` ``、列表/引用/表格结构等。
   */
  const extractMarkdown = useCallback((): string => {
    const el = editableRef.current;
    if (!el) return "";
    return deserializeHtmlToMarkdown(el);
  }, []);

  /**
   * 处理用户输入：反序列化 DOM → Markdown 源码 → 同步到 documentStore.content。
   * 不在此处重置 DOM，保留原生 contentEditable 行为以稳定光标。
   */
  const handleInput = useCallback(() => {
    const md = extractMarkdown();
    lastEmittedContentRef.current = md;
    hasEmittedRef.current = true;
    onContentChange(md);
  }, [extractMarkdown, onContentChange]);

  /**
   * 外部 content/renderedHtml 同步：
   * - 若 content === lastEmittedContentRef.current，说明是自身编辑回流，
   *   不重置 DOM（保持光标）。
   * - 否则（文档切换、外部重置、撤销/重做），以 renderedHtml 重置 DOM，
   *   并尽量恢复光标位置。
   * - 渲染中（isRenderPending）：不清空、不替换 DOM。长文档异步分批
   *   渲染期间 isRendering=true 会在用户停顿后触发，若此时清空容器会
   *   丢失用户正在编辑的输入与光标。加载态由 CSS overlay 体现
   *   （.immersive-editor[data-render-pending="true"]），不影响真实 DOM。
   *
   * 容器 innerHTML 完全由本 effect 管理，不通过 React children 渲染，
   * 避免 contentEditable 与 React 调和冲突。
   */
  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;

    // isRenderPending 期间不替换 DOM 内容，避免丢失正在编辑的输入与光标。
    // 仅通过 data 属性驱动 CSS overlay 显示加载提示。
    el.dataset.renderPending = isRenderPending ? "true" : "false";

    const isSelfEcho =
      hasEmittedRef.current &&
      (content === lastEmittedContentRef.current ||
        content === lastEmittedContentRef.current.replace(/\s+$/, ""));
    if (isSelfEcho) {
      // 自身编辑回流：DOM 保持不变，避免光标跳动
      return;
    }

    // 外部变更：记录光标 → 重置 → 恢复光标
    const savedOffsets = getSelectionOffsets(el);

    if (renderedHtml) {
      el.innerHTML = renderedHtml;
    } else {
      // 无渲染结果（如空内容）→ 以纯文本占位
      el.textContent = content;
    }

    if (savedOffsets) {
      // 下一帧恢复，确保 DOM 已 commit
      requestAnimationFrame(() => {
        if (editableRef.current) {
          setSelectionOffsets(editableRef.current, savedOffsets.start, savedOffsets.end);
        }
      });
    }
  }, [content, renderedHtml, isRenderPending]);

  /**
   * 链接点击委托（与 ContentArea 行为一致）：
   * - 内部 .md 链接 → onOpenDocument
   * - 外链 → openUrl
   * 先交给上层注入的 onClick（图片错误重试等）。
   */
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onClick?.(e);

      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (!anchor) return;

      const internalMd = anchor.getAttribute("data-internal-md");
      const externalLink = anchor.getAttribute("data-external-link");

      if (internalMd) {
        e.preventDefault();
        onOpenDocument(internalMd);
        return;
      }

      if (externalLink) {
        e.preventDefault();
        const href = anchor.getAttribute("href");
        if (href) {
          openUrl(href);
        }
        return;
      }
    },
    [onOpenDocument, onClick],
  );

  /**
   * 阻止粘贴富文本（仅保留纯文本），避免引入未净化的 HTML。
   * 渲染管线只在重新渲染时净化，粘贴阶段也应收敛到纯文本。
   * 通过 insertPlainText（Selection API，execCommand 回退）插入，
   * 避免依赖已废弃的 document.execCommand("insertText")。
   */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    insertPlainText(text);
  }, []);

  const handleKeyDown = useCallback((_e: KeyboardEvent) => {
    // 占位：当前依赖浏览器原生 contentEditable 的换行与删除行为，
    // 后续若需要更精细控制（如强制 <br> 换行），可在此扩展。
  }, []);

  return (
    <div
      className="content-render-preview markdown-body immersive-editor"
      ref={(node) => {
        // 同时赋给本地 ref 与外部 previewRef（FindBar 需要）
        (editableRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (previewRef) {
          (previewRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      }}
      contentEditable={true}
      suppressContentEditableWarning={true}
      spellCheck={false}
      onInput={handleInput}
      onClick={handleClick}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
    />
  );
}

export default ImmersiveEditor;
