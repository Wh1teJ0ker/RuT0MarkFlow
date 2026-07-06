import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import ContentArea from "../ContentArea";
import type { DocumentState } from "../../../types";

describe("ContentArea retry (T39)", () => {
  const baseDoc: DocumentState = {
    path: null,
    relativePath: null,
    title: "",
    content: "",
    lastSavedContent: "",
    isDirty: false,
    isSaving: false,
    isNew: false,
  };

  it("openError + relativePath → renders retry button, click calls onOpenDocument", () => {
    const onOpenDocument = vi.fn();
    const doc = { ...baseDoc, openError: "文件无法读取", relativePath: "doc.md", path: "/ws/doc.md" };

    render(
      <ContentArea
        document={doc}
        viewMode="split-editor"
        hasWorkspace={true}
        onContentChange={vi.fn()}
        renderedHtml=""
        isRenderPending={false}
        hasRenderErrors={false}
        onOpenDocument={onOpenDocument}
      />,
    );

    const btn = screen.getByText("重试打开");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onOpenDocument).toHaveBeenCalledWith("doc.md");
  });

  it('openError starts with "文件不存在:" → button text is "目标不存在，重新选择"', () => {
    const doc = { ...baseDoc, openError: "文件不存在: foo.md", relativePath: "doc.md", path: "/ws/doc.md" };

    render(
      <ContentArea
        document={doc}
        viewMode="split-editor"
        hasWorkspace={true}
        onContentChange={vi.fn()}
        renderedHtml=""
        isRenderPending={false}
        hasRenderErrors={false}
        onOpenDocument={vi.fn()}
      />,
    );

    expect(screen.getByText("目标不存在，重新选择")).toBeTruthy();
  });

  it("openError + relativePath=null → no retry button", () => {
    const doc = { ...baseDoc, openError: "文件无法读取", relativePath: null, path: "/ws/doc.md" };

    render(
      <ContentArea
        document={doc}
        viewMode="split-editor"
        hasWorkspace={true}
        onContentChange={vi.fn()}
        renderedHtml=""
        isRenderPending={false}
        hasRenderErrors={false}
        onOpenDocument={vi.fn()}
      />,
    );

    expect(screen.queryByText("重试打开")).toBeNull();
    expect(screen.queryByText("目标不存在，重新选择")).toBeNull();
  });
});