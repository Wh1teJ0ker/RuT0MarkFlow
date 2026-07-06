/**
 * Component-level tests for T38 document switch experience.
 *
 * Verifies (per HANDOFF acceptance_criteria):
 * - opening 占位在 Promise 未 resolve 时已渲染（App 级）
 * - latest-request-wins（A→B 竞态：最终显示 B，不显示 A）
 * - same-path fast path 不触发第二次 invoke
 * - opening 失败后退出 loading
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { act } from "react";

// ── Mock Tauri modules ───────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ destroy: vi.fn() })),
}));

import { invoke } from "@tauri-apps/api/core";
import ContentArea from "../../components/content/ContentArea";
import type { DocumentState } from "../../types";

/** Flush all pending microtasks (React state updates from async effects). */
async function flushMicrotasks() {
  await act(() => Promise.resolve());
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── ContentArea skeleton tests (component-level) ────────────────

describe("ContentArea opening skeleton", () => {
	  const doc: DocumentState = {
    path: "test.md",
    relativePath: "test.md",
    title: "test.md",
    content: "# Hello",
    lastSavedContent: "# Hello",
    isDirty: false,
    isSaving: false,
    isNew: false,
  };

  it("renders dual-pane skeleton in split-editor when isOpening=true", () => {
    const { container } = render(
      <ContentArea
        document={doc}
        viewMode="split-editor"
        hasWorkspace={true}
        onContentChange={vi.fn()}
        renderedHtml=""
        isRenderPending={false}
        hasRenderErrors={false}
        onOpenDocument={vi.fn()}
        isOpening={true}
        openingPath="docs/new.md"
      />,
    );
    expect(container.querySelectorAll(".content-opening-skeleton").length).toBe(2);
    expect(container.querySelectorAll(".content-document-title")[0].textContent).toBe("docs/new.md");
  });

  it("renders single-pane skeleton in immersive-preview when isOpening=true", () => {
    const { container } = render(
      <ContentArea
        document={doc}
        viewMode="immersive-preview"
        hasWorkspace={true}
        onContentChange={vi.fn()}
        renderedHtml=""
        isRenderPending={false}
        hasRenderErrors={false}
        onOpenDocument={vi.fn()}
        isOpening={true}
        openingPath="guide.md"
      />,
    );
    expect(container.querySelectorAll(".content-opening-skeleton").length).toBe(1);
    expect(container.querySelectorAll(".content-document-title")[0].textContent).toBe("guide.md");
  });

it("does NOT render skeleton when isOpening=false", () => {
	    const { container } = render(
	      <ContentArea
	        document={doc}
	        viewMode="split-editor"
	        hasWorkspace={true}
	        onContentChange={vi.fn()}
	        renderedHtml="<p>Rendered</p>"
	        isRenderPending={false}
	        hasRenderErrors={false}
	        onOpenDocument={vi.fn()}
	        isOpening={false}
	      />,
	    );
	    expect(container.querySelectorAll(".content-opening-skeleton").length).toBe(0);
	    expect(container.textContent).toContain("Rendered");
	  });

	  it("prioritises skeleton over isNew textarea when both isNew and isOpening are true", () => {
	    const newDoc: DocumentState = {
	      path: null,
	      relativePath: null,
	      title: "",
	      content: "",
	      lastSavedContent: "",
	      isDirty: false,
	      isSaving: false,
	      isNew: true,
	    };
	    const { container } = render(
	      <ContentArea
	        document={newDoc}
	        viewMode="split-editor"
	        hasWorkspace={true}
	        onContentChange={vi.fn()}
	        renderedHtml=""
	        isRenderPending={false}
	        hasRenderErrors={false}
	        onOpenDocument={vi.fn()}
	        isOpening={true}
	        openingPath="newly-opened.md"
	      />,
	    );
	    // skeleton must be visible
	    expect(container.querySelectorAll(".content-opening-skeleton").length).toBe(2);
	    // header shows opening path, not "未命名文档"
	    expect(container.querySelectorAll(".content-document-title")[0].textContent).toBe("newly-opened.md");
	    // new-document textarea must NOT appear
	    expect(container.textContent).not.toContain("未命名文档");
	  });
});

// ── App-level document switch tests ────────────────────────────

import App from "../App";

describe("App.tsx document switch (T38)", () => {
  it("same-path fast path: restore already shows doc, clicking same doc does NOT re-invoke open_document", async () => {
    const invokeCalls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      invokeCalls.push(cmd);
      const behaviors: Record<string, object> = {
        load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", recentDocumentPath: "doc.md", viewMode: "split-editor" } },
        load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 1, isAvailable: true }, indexTree: [
          { id: "doc.md", name: "doc.md", type: "file", relativePath: "doc.md", entry: { id: "doc.md", name: "doc.md", absolutePath: "/ws/doc.md", relativePath: "doc.md", parentRelativePath: "", extension: "md" } },
        ], flatEntries: [] } },
        open_document: { success: true, data: { path: "doc.md", relativePath: "doc.md", content: "# Content", updatedAt: "123" } },
      };
      return behaviors[cmd] ?? { success: true, data: null };
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // open_document was called once during restore
    expect(invokeCalls.filter(c => c === "open_document").length).toBe(1);

    // Click the SAME file (doc.md) — fast path should skip invoke
    const fileRows = document.querySelectorAll(".tree-node-row--file");
    expect(fileRows.length).toBeGreaterThanOrEqual(1);

    await act(async () => { fireEvent.click(fileRows[0]); });
    await flushMicrotasks();

    // open_document count must still be 1 (no new invoke)
    expect(invokeCalls.filter(c => c === "open_document").length).toBe(1);
  });

  it("same-path fast path: open doc A, then click A again — no re-invoke", async () => {
    let resolveOpen: ((value: unknown) => void) | null = null;
    const invokeCalls: string[] = [];

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      invokeCalls.push(cmd);
      if (cmd === "open_document") {
        return new Promise((resolve) => { resolveOpen = resolve; });
      }
      const behaviors: Record<string, object> = {
        load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", viewMode: "split-editor" } },
        load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 2, isAvailable: true }, indexTree: [
          { id: "a.md", name: "a.md", type: "file", relativePath: "a.md", entry: { id: "a.md", name: "a.md", absolutePath: "/ws/a.md", relativePath: "a.md", parentRelativePath: "", extension: "md" } },
          { id: "b.md", name: "b.md", type: "file", relativePath: "b.md", entry: { id: "b.md", name: "b.md", absolutePath: "/ws/b.md", relativePath: "b.md", parentRelativePath: "", extension: "md" } },
        ], flatEntries: [] } },
      };
      return behaviors[cmd] ?? { success: true, data: null };
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(invokeCalls.filter(c => c === "open_document").length).toBe(0); // No doc restored

    // Click A
    const fileRows = document.querySelectorAll(".tree-node-row--file");
    expect(fileRows.length).toBe(2);

    await act(async () => { fireEvent.click(fileRows[0]); }); // a.md
    expect(resolveOpen).not.toBeNull();

    // Resolve A — now doc A is current
    await act(async () => { resolveOpen!({ success: true, data: { path: "a.md", relativePath: "a.md", content: "# Document A", updatedAt: "123" } }); });
    await flushMicrotasks();

    expect(invokeCalls.filter(c => c === "open_document").length).toBe(1);

    // Click a.md AGAIN — fast path should prevent re-invoke
    await act(async () => { fireEvent.click(fileRows[0]); }); // a.md again
    await flushMicrotasks();

    expect(invokeCalls.filter(c => c === "open_document").length).toBe(1);
  });

  it("opening skeleton appears in App while open_document is pending", async () => {
    // open_document never resolves → keeps isDocumentOpening=true
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "open_document") return new Promise(() => {});
      const behaviors: Record<string, object> = {
        load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", viewMode: "split-editor" } },
        load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 1, isAvailable: true }, indexTree: [
          { id: "doc.md", name: "doc.md", type: "file", relativePath: "doc.md", entry: { id: "doc.md", name: "doc.md", absolutePath: "/ws/doc.md", relativePath: "doc.md", parentRelativePath: "", extension: "md" } },
        ], flatEntries: [] } },
      };
      return behaviors[cmd] ?? { success: true, data: null };
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Before clicking: no skeleton
    expect(document.querySelectorAll(".content-opening-skeleton").length).toBe(0);

    // Click a file to trigger open_document (never resolves → stays opening)
    const fileRows = document.querySelectorAll(".tree-node-row--file");
    expect(fileRows.length).toBe(1);

    await act(async () => { fireEvent.click(fileRows[0]); });
    await flushMicrotasks(); // Flush so setIsDocumentOpening(true) renders

    // Skeleton must be visible (open_document Promise is still pending)
    expect(document.querySelectorAll(".content-opening-skeleton").length).toBeGreaterThan(0);

// Skeleton header shows document path
	    const titles = document.querySelectorAll(".content-document-title");
	    expect(Array.from(titles).some(t => t.textContent?.includes("doc.md"))).toBe(true);
	  });

	  it("isNew → click existing file → opening skeleton visible (isOpening priority over isNew)", async () => {
	    // open_document never resolves → keeps isDocumentOpening=true
	    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
	      if (cmd === "open_document") return new Promise(() => {});
	      const behaviors: Record<string, object> = {
	        load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", viewMode: "split-editor" } },
	        load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 1, isAvailable: true }, indexTree: [
	          { id: "existing.md", name: "existing.md", type: "file", relativePath: "existing.md", entry: { id: "existing.md", name: "existing.md", absolutePath: "/ws/existing.md", relativePath: "existing.md", parentRelativePath: "", extension: "md" } },
	        ], flatEntries: [] } },
	      };
	      return behaviors[cmd] ?? { success: true, data: null };
	    });

	    render(<App />);
	    await flushMicrotasks();
	    await flushMicrotasks();

	    // No skeleton before any interaction
	    expect(document.querySelectorAll(".content-opening-skeleton").length).toBe(0);

	    // Click "新建" to enter isNew state
	    const newBtn = screen.getByText("新建");
	    expect(newBtn).not.toBeNull();
	    await act(async () => { fireEvent.click(newBtn); });
	    await flushMicrotasks();

	    // Now in isNew state — should show textarea, not skeleton
	    expect(document.querySelectorAll(".content-opening-skeleton").length).toBe(0);
	    expect(document.body.textContent || "").toContain("未命名文档");

	    // Click the existing file — triggers open_document (never resolves → stays opening)
	    const fileRows = document.querySelectorAll(".tree-node-row--file");
	    expect(fileRows.length).toBe(1);

	    await act(async () => { fireEvent.click(fileRows[0]); });
	    await flushMicrotasks();

	    // Skeleton must be visible (isOpening takes priority over isNew)
	    expect(document.querySelectorAll(".content-opening-skeleton").length).toBeGreaterThan(0);

	    // Header must show opening path, not "未命名文档"
	    expect(document.body.textContent || "").not.toContain("未命名文档");
	  });

  it("latest-request-wins: rapid A→B clicks, stale A response does not override B", async () => {
    let resolveA: ((value: unknown) => void) | null = null;
    let resolveB: ((value: unknown) => void) | null = null;

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "open_document") {
        return new Promise((resolve) => {
          if (!resolveA) resolveA = resolve;
          else if (!resolveB) resolveB = resolve;
        });
      }
      const behaviors: Record<string, object> = {
        load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", viewMode: "split-editor" } },
        load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 2, isAvailable: true }, indexTree: [
          { id: "a.md", name: "a.md", type: "file", relativePath: "a.md", entry: { id: "a.md", name: "a.md", absolutePath: "/ws/a.md", relativePath: "a.md", parentRelativePath: "", extension: "md" } },
          { id: "b.md", name: "b.md", type: "file", relativePath: "b.md", entry: { id: "b.md", name: "b.md", absolutePath: "/ws/b.md", relativePath: "b.md", parentRelativePath: "", extension: "md" } },
        ], flatEntries: [] } },
      };
      return behaviors[cmd] ?? { success: true, data: null };
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    const fileRows = document.querySelectorAll(".tree-node-row--file");
    expect(fileRows.length).toBe(2);

    // Click A, THEN click B before A resolves
    await act(async () => { fireEvent.click(fileRows[0]); }); // a.md
    await act(async () => { fireEvent.click(fileRows[1]); }); // b.md

    // Resolve A FIRST (stale — should be discarded by latest-request-wins)
    expect(resolveA).not.toBeNull();
    await act(async () => { resolveA!({ success: true, data: { path: "a.md", relativePath: "a.md", content: "# Document A", updatedAt: "123" } }); });
    await flushMicrotasks();

    // Assert stale A did NOT overwrite UI
    expect(document.body.textContent || "").not.toContain("Document A");

    // Resolve B (latest — should win)
    expect(resolveB).not.toBeNull();
    await act(async () => { resolveB!({ success: true, data: { path: "b.md", relativePath: "b.md", content: "# Document B", updatedAt: "456" } }); });
    await flushMicrotasks();

    const bodyAfterB = document.body.textContent || "";

    // B's content must be visible
    expect(bodyAfterB).toContain("Document B");

    // A's content must NOT appear
    expect(bodyAfterB).not.toContain("Document A");

    // Skeleton must be gone (opening complete)
    expect(document.querySelectorAll(".content-opening-skeleton").length).toBe(0);

    // Status message mentions B
    expect(bodyAfterB).toContain("b.md");
  });

  it("opening failure exits loading and shows error message", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "open_document") {
        return { success: false, data: null, error: { code: "DOCUMENT_OPEN_FAILED", message: "文件不存在或无法读取", recoverable: true } };
      }
      const behaviors: Record<string, object> = {
        load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", viewMode: "split-editor" } },
        load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 1, isAvailable: true }, indexTree: [
          { id: "doc.md", name: "doc.md", type: "file", relativePath: "doc.md", entry: { id: "doc.md", name: "doc.md", absolutePath: "/ws/doc.md", relativePath: "doc.md", parentRelativePath: "", extension: "md" } },
        ], flatEntries: [] } },
      };
      return behaviors[cmd] ?? { success: true, data: null };
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    const fileRows = document.querySelectorAll(".tree-node-row--file");
    expect(fileRows.length).toBe(1);

    await act(async () => { fireEvent.click(fileRows[0]); });
    await flushMicrotasks();

    // Skeleton must be gone after failure
    expect(document.querySelectorAll(".content-opening-skeleton").length).toBe(0);

    // Error message visible
    expect(document.body.textContent || "").toContain("文件不存在或无法读取");
  });
});