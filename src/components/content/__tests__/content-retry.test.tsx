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
    const doc = {
      ...baseDoc,
      openError: {
        code: "DOCUMENT_OPEN_FAILED",
        message: "文件无法读取",
        recoverable: true,
        domain: "document" as const,
        operation: "open-document" as const,
        recoveryAction: "retry-open-document" as const,
      },
      relativePath: "doc.md",
      title: "doc.md",
    };

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

    const btn = screen.getByText("重试打开文档");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onOpenDocument).toHaveBeenCalledWith("doc.md");
  });

  it("recoverable openError uses unified title and description", () => {
    const doc = {
      ...baseDoc,
      openError: {
        code: "DOCUMENT_OPEN_FAILED",
        message: "文件不存在或无法读取",
        recoverable: true,
        domain: "document" as const,
        operation: "open-document" as const,
        recoveryAction: "retry-open-document" as const,
      },
      relativePath: "doc.md",
      title: "doc.md",
    };

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

    expect(screen.getByText("文档打开失败")).toBeTruthy();
    expect(screen.getByText("文件不存在或无法读取")).toBeTruthy();
    expect(screen.getByText("重试打开文档")).toBeTruthy();
  });

  it("non-recoverable openError or missing relativePath → no retry button", () => {
    const doc = {
      ...baseDoc,
      openError: {
        code: "DOCUMENT_OPEN_FAILED",
        message: "权限不足",
        recoverable: false,
        domain: "document" as const,
        operation: "open-document" as const,
        recoveryAction: "none" as const,
      },
      relativePath: null,
      title: "doc.md",
    };

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

    expect(screen.queryByText("重试打开文档")).toBeNull();
  });
});
