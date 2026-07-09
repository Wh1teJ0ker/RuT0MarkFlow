import { useCallback, useRef, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getAppErrorDisplay } from "../../services/tauri";
import type { DocumentState, ViewMode } from "../../types";
import FindBar from "./FindBar";

interface ContentAreaProps {
  document: DocumentState;
  viewMode: ViewMode;
  hasWorkspace: boolean;
  onContentChange: (content: string) => void;
  renderedHtml: string;
  isRenderPending: boolean;
  hasRenderErrors: boolean;
  onOpenDocument: (relativePath: string) => void;
  onImageError?: (src: string) => void;
  /** True while a document is being opened (file read in progress). */
  isOpening?: boolean;
  /** The relative path of the document being opened (shown in skeleton header). */
  openingPath?: string | null;
  /** Called when user clicks a failed image placeholder to retry loading. */
  onRetryImage?: (src: string) => void;
  /** Find-in-page bar (Cmd+F). */
  isFindBarOpen?: boolean;
  onCloseFindBar?: () => void;
}

/**
 * ContentArea — Central content region.
 *
 * States:
 *  - No workspace → welcome prompt
 *  - Workspace, no doc → placeholder
 *  - isNew → editable textarea for new doc
 *  - Document open → split-editor (edit + preview) or immersive-preview (rendered only)
 *
 * Link click delegation: intercepts clicks on rendered HTML's internal .md links
 * to call onOpenDocument, and lets external links open in system browser.
 */
function ContentArea({
  document,
  viewMode,
  hasWorkspace,
  onContentChange,
  renderedHtml,
  isRenderPending,
  hasRenderErrors: _hasRenderErrors,
  onOpenDocument,
  onImageError,
  isOpening = false,
  openingPath = null,
  onRetryImage,
  isFindBarOpen = false,
  onCloseFindBar,
}: ContentAreaProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef<{ split: number; immersive: number }>({ split: 0, immersive: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  // ── Restore cursor position on mode switch (Item D) ─────────
  useEffect(() => {
    if (viewMode === "split-editor" && selectionRef.current && textareaRef.current) {
      textareaRef.current.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
      textareaRef.current.focus();
    }
  }, [viewMode]);

  // ── Image error delegation ────────────────────────────────────
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    const handler = (e: Event) => {
      const img = e.target as HTMLImageElement;
      if (img.tagName !== "IMG") return;
      // Replace with placeholder
      const src = img.getAttribute("src") || "";
      const alt = img.getAttribute("alt") || "";
      img.outerHTML = `<span class="image-error" data-failed-src="${src}" title="图片加载失败: ${src}">[图片: ${alt || src}]</span>`;
      onImageError?.(src || alt || "unknown");
    };

    container.addEventListener("error", handler, true);
    return () => container.removeEventListener("error", handler, true);
  }, [renderedHtml, onImageError]);

  // ── Link click delegation ─────────────────────────────────────
  const handlePreviewClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;

      // Image-error click → retry image load
      const imageErrorEl = target.closest(".image-error");
      if (imageErrorEl && onRetryImage) {
        const src = imageErrorEl.getAttribute("data-failed-src");
        if (src) {
          onRetryImage(src);
          return;
        }
      }

      const anchor = target.closest("a");
      if (!anchor) return;

      const internalMd = anchor.getAttribute("data-internal-md");
      const externalLink = anchor.getAttribute("data-external-link");

      // Internal .md link → open in app
      if (internalMd) {
        e.preventDefault();
        onOpenDocument(internalMd);
        return;
      }

      // External link → open in system default browser via Tauri opener
      if (externalLink) {
        e.preventDefault();
        const href = anchor.getAttribute("href");
        if (href) {
          openUrl(href);
        }
        return;
      }

      // Other links — let default behavior handle
    },
    [onOpenDocument, onRetryImage],
  );

  // ── Save scroll position on mode switch ──────────────────────
  useEffect(() => {
    return () => {
      // Save scroll position when component unmounts (mode switch)
      if (previewRef.current) {
        const key = viewMode === "split-editor" ? "split" : "immersive";
        scrollPosRef.current[key] = previewRef.current.scrollTop;
      }
    };
  }, [viewMode]);

  // ── Restore scroll position after render ─────────────────────
  useEffect(() => {
    if (previewRef.current) {
      const key = viewMode === "split-editor" ? "split" : "immersive";
      previewRef.current.scrollTop = scrollPosRef.current[key] || 0;
    }
  }, [renderedHtml, viewMode]);

  // ── Empty workspace ────────────────────────────────────────
  if (!hasWorkspace) {
    return (
      <div className="content-placeholder">
        <div className="content-placeholder-inner">
          <h1>RuT0MarkFlow</h1>
          <p>选择工作区文件夹以开始浏览和管理 Markdown 文档。</p>
          <p className="content-placeholder-hint">使用顶部工具栏「打开工作区」按钮选择文件夹</p>
        </div>
      </div>
    );
  }

  // ── Document opening skeleton (must precede isNew, so opening
  //    takes priority over "new document" textarea) ────────────
  if (isOpening) {
    const title = openingPath || "正在打开…";
    const skeleton = (
      <div className="content-opening-skeleton">
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-line skeleton-line--long" />
        <div className="skeleton-line skeleton-line--medium" />
        <div className="skeleton-line skeleton-line--long" />
        <div className="skeleton-line skeleton-line--short" />
        <div className="skeleton-line skeleton-line--long" />
        <div className="skeleton-line skeleton-line--medium" />
        <div className="skeleton-line skeleton-line--short" />
      </div>
    );

    if (viewMode === "immersive-preview") {
      return (
        <div className="content-document">
          <div className="content-document-header">
            <span className="content-document-title">{title}</span>
          </div>
          {skeleton}
        </div>
      );
    }

    // Split-editor: dual-pane skeleton
    return (
      <div className="content-document content-split">
        <div className="content-split-pane">
          <div className="content-document-header">
            <span className="content-document-title">{title}</span>
          </div>
          {skeleton}
        </div>
        <div className="content-split-pane">
          <div className="content-document-header">
            <span>预览</span>
          </div>
          {skeleton}
        </div>
      </div>
    );
  }

  // ── Open error state ───────────────────────────────────────
  if (document.openError) {
    const errorDisplay = getAppErrorDisplay(document.openError);
    return (
      <div className="content-placeholder">
        <div className="content-placeholder-inner">
          <p className="content-error-text">{errorDisplay?.title ?? "文档打开失败"}</p>
          <p className="content-placeholder-hint">
            {errorDisplay?.description ?? document.openError.message}
          </p>
          {document.relativePath && errorDisplay?.canRetry && (
            <button
              className="content-retry-btn"
              onClick={() => onOpenDocument(document.relativePath!)}
            >
              {errorDisplay.actionLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── New document (isNew) — only if !isOpening ──────────────
  if (document.isNew) {
    return (
      <div className="content-document">
        <div className="content-document-header">
          <span className="content-document-title">未命名文档</span>
          <span className="content-document-header-hint">新建 — 保存时将选择路径</span>
        </div>
        <textarea
          className="content-editor-textarea"
          value={document.content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder="输入 Markdown 内容后保存以落盘"
        />
      </div>
    );
  }

  // ── Workspace loaded, no document ──────────────────────────
  if (!document.path) {
    return (
      <div className="content-placeholder">
        <div className="content-placeholder-inner">
          <p>请从左侧索引列表中选择一个文档打开</p>
        </div>
      </div>
    );
  }

  // ── Immersive preview mode ──────────────────────────────────
  if (viewMode === "immersive-preview") {
    return (
      <div className="content-document">
        <div className="content-document-header">
          <span className="content-document-title">{document.title}</span>
        </div>
        <FindBar open={isFindBarOpen} onClose={onCloseFindBar!} containerRef={previewRef} />
        <div
          className="content-render-preview markdown-body"
          ref={previewRef}
          onClick={handlePreviewClick}
        >
          {isRenderPending ? (
            <div className="render-loading">渲染中…</div>
          ) : renderedHtml ? (
            <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
          ) : (
            <pre className="content-fallback-text">{document.content}</pre>
          )}
        </div>
      </div>
    );
  }

  // ── Split-editor mode ──────────────────────────────────────
  return (
    <div className="content-document content-split">
      <div className="content-split-pane">
        <div className="content-document-header">
          <span className="content-document-title">{document.title}</span>
        </div>
        <textarea
          ref={textareaRef}
          className="content-editor-textarea"
          value={document.content}
          onChange={(e) => onContentChange(e.target.value)}
          onBlur={(e) => {
            selectionRef.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
          }}
          placeholder="在双栏编辑模式中编辑 Markdown 源码"
        />
      </div>
      <div className="content-split-pane">
        <div className="content-document-header">
          <span>预览</span>
        </div>
        <FindBar open={isFindBarOpen} onClose={onCloseFindBar!} containerRef={previewRef} />
        <div
          className="content-render-preview markdown-body"
          ref={previewRef}
          onClick={handlePreviewClick}
        >
          {isRenderPending ? (
            <div className="render-loading">渲染中…</div>
          ) : renderedHtml ? (
            <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
          ) : (
            <pre className="content-fallback-text">{document.content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default ContentArea;
