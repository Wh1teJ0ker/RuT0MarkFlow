import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import ImmersiveEditor from "../ImmersiveEditor";

/**
 * ImmersiveEditor 基础行为测试（T9 rework）。
 *
 * 覆盖 acceptance_criteria 的核心自动化验证：
 * - renderedHtml 经 ref 写入 contentEditable 容器（DOM 可提取）。
 * - onInput 触发 onContentChange（提取纯文本）。
 * - isRenderPending 期间不清空 DOM（不丢失已渲染内容）。
 * - self-echo（content === 上次发出的内容）不重置 DOM。
 */

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    content: "hello",
    renderedHtml: "<p>hello</p>",
    isRenderPending: false,
    onContentChange: vi.fn(),
    onOpenDocument: vi.fn(),
    previewRef: { current: null } as React.MutableRefObject<HTMLDivElement | null>,
    onClick: vi.fn(),
    ...overrides,
  };
}

describe("ImmersiveEditor (T9)", () => {
  it("将 renderedHtml 写入 contentEditable 容器", () => {
    const props = makeProps();
    const { container } = render(<ImmersiveEditor {...props} />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(editable).toBeTruthy();
    expect(editable.innerHTML).toContain("<p>hello</p>");
  });

  it("onInput 提取纯文本并调用 onContentChange", () => {
    const onContentChange = vi.fn();
    const props = makeProps({ onContentChange, renderedHtml: "<p>world</p>", content: "world" });
    const { container } = render(<ImmersiveEditor {...props} />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;

    act(() => {
      editable.textContent = "world edited";
      fireEvent.input(editable);
    });

    expect(onContentChange).toHaveBeenCalled();
    // 提取的是纯文本（不含标签）
    const emitted = onContentChange.mock.calls[0][0] as string;
    expect(emitted.replace(/\s+/g, "")).toBe("worldedited");
  });

  it("isRenderPending 期间不清空已渲染的 DOM 内容", () => {
    const props = makeProps({ renderedHtml: "<p>persistent</p>", content: "persistent" });
    const { container, rerender } = render(<ImmersiveEditor {...props} />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(editable.innerHTML).toContain("<p>persistent</p>");

    // 渲染中：不替换 DOM，仅切换 data-render-pending
    rerender(<ImmersiveEditor {...makeProps({ isRenderPending: true, content: "persistent", renderedHtml: "<p>persistent</p>" })} />);
    const editableAfter = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(editableAfter.innerHTML).toContain("<p>persistent</p>");
    expect(editableAfter.dataset.renderPending).toBe("true");
    // 不应出现"渲染中…"替换内容
    expect(editableAfter.innerHTML).not.toContain("render-loading");
  });

  it("self-echo（content === 上次发出内容）不重置 DOM", () => {
    const onContentChange = vi.fn();
    const props = makeProps({ renderedHtml: "<p>self</p>", content: "self", onContentChange });
    const { container, rerender } = render(<ImmersiveEditor {...props} />);
    const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;

    // 模拟用户编辑 → onContentChange 发出 "self"
    act(() => {
      editable.textContent = "self";
      fireEvent.input(editable);
    });
    expect(onContentChange).toHaveBeenCalled();

    // 外部 content 回流为相同值 "self"（self-echo），即便 renderedHtml 变化也不应替换 DOM
    const htmlBefore = editable.innerHTML;
    rerender(
      <ImmersiveEditor
        {...makeProps({ content: "self", renderedHtml: "<p>self CHANGED</p>", onContentChange })}
      />,
    );
    const editableAfter = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(editableAfter.innerHTML).toBe(htmlBefore);
    expect(editableAfter.innerHTML).not.toContain("CHANGED");
  });

  /**
   * T10：DOM → Markdown 反序列化。
   * 渲染态编辑后 onInput 应回写 Markdown 源码（保留 #、**、` 等标记），
   * 而非退化为纯文本。
   */
  it("onInput 反序列化为 Markdown 源码（保留语法标记）", () => {
    const onContentChange = vi.fn();
    const props = makeProps({
      renderedHtml: "<h1>Title</h1><p>text <strong>bold</strong> <code>c</code></p>",
      content: "",
      onContentChange,
    });
    const { container } = render(<ImmersiveEditor {...props} />);

    act(() => {
      const editable = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
      // 模拟一次输入触发
      fireEvent.input(editable);
    });

    expect(onContentChange).toHaveBeenCalled();
    const emitted = onContentChange.mock.calls[onContentChange.mock.calls.length - 1][0] as string;
    expect(emitted).toContain("# Title");
    expect(emitted).toContain("**bold**");
    expect(emitted).toContain("`c`");
  });
});
