/**
 * Tests for Tauri window close guard (P0-1).
 *
 * The Rust side emits "app://close-requested" after prevent_close().
 * The front-end listens for this event and decides whether to
 * actually destroy the window or keep it open.
 *
 * Scenarios tested:
 * 1. isDirty=true + cancel → destroy NOT called
 * 2. isDirty=false → destroy called
 * 3. isDirty=true + save success → destroy called
 * 4. isDirty=true + save failure → destroy NOT called
 *
 * Uses the same mock patterns as the watcher test for listen capture.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";

// ── Custom listen mock: capture event handlers ─────────────────

const eventHandlers: Record<string, (event: { payload: unknown }) => void> = {};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (event: string, handler: (event: { payload: unknown }) => void) => {
      eventHandlers[event] = handler;
      return Promise.resolve(() => {
        delete eventHandlers[event];
      });
    },
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// ── Window mock: capture destroy for call-count assertions ─────

let destroyMock = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ destroy: vi.fn(() => destroyMock()) })),
}));

import { invoke } from "@tauri-apps/api/core";

function mockInvoke(behaviors: Record<string, object>) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    const b = behaviors[cmd];
    return b ?? { success: false, data: null, error: { code: "NO_MOCK", message: "no mock for " + cmd, recoverable: true } };
  });
}

async function flushMicrotasks() {
  await act(() => Promise.resolve());
}

beforeEach(() => {
  vi.clearAllMocks();
  destroyMock = vi.fn();
  // Reset eventHandlers but keep the mock active
  for (const key of Object.keys(eventHandlers)) {
    delete eventHandlers[key];
  }
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

import App from "../App";

/**
 * Set up mock responses so the App restores a workspace and opens a doc
 * with the given content and dirty state.
 */
function setupRestoredDocument(content: string) {
  mockInvoke({
    load_app_settings: {
      success: true,
      data: {
        recentWorkspacePath: "/ws",
        recentDocumentPath: "doc.md",
        viewMode: "split-editor",
      },
    },
    load_workspace: {
      success: true,
      data: {
        workspace: { rootPath: "/ws", displayName: "ws", fileCount: 3, isAvailable: true },
        indexTree: [],
        flatEntries: [],
      },
    },
    open_document: {
      success: true,
      data: { path: "doc.md", relativePath: "doc.md", content, updatedAt: "123" },
    },
  });
}

/** Trigger the "app://close-requested" event handler as Rust would. */
async function triggerCloseRequest() {
  const handler = eventHandlers["app://close-requested"];
  expect(handler).toBeDefined();
  await act(async () => { handler({ payload: {} }); });
  await flushMicrotasks();
}

describe("Window close guard (P0-1)", () => {
  it("isDirty=false → destroy is called", async () => {
    setupRestoredDocument("# Clean doc");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(destroyMock).not.toHaveBeenCalled();

    await triggerCloseRequest();

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("isDirty=true + cancel → destroy is NOT called", async () => {
    // Mock requestUnsavedConfirm → "cancel"
    // The confirm dialog buttons call onCancel when "取消" is clicked.
    // We need the invoke mock to return isDirty for the doc content.
    setupRestoredDocument("# Initial");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Make the document dirty by typing in the textarea
    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    await act(async () => {
      // Use fireEvent from testing-library
      const { fireEvent } = await import("@testing-library/react");
      fireEvent.change(textarea, { target: { value: "# Modified content" } });
    });
    await flushMicrotasks();

    // Now isDirty should be true.  Trigger close.
    // The close handler calls requestUnsavedConfirm → shows dialog.
    // We need to mock the dialog's cancel button.
    // The dialog uses getByText("取消") which renders based on state.
    // We click "取消" to trigger the cancel path.

    await triggerCloseRequest();

    // After close-requested, the confirm dialog should appear
    // Click "取消" to cancel
    const cancelBtn = document.querySelector<HTMLButtonElement>(".dialog-btn-cancel")
      || Array.from(document.querySelectorAll("button")).find(b => b.textContent === "取消");
    if (cancelBtn) {
      await act(async () => { cancelBtn.click(); });
      await flushMicrotasks();
    }

    expect(destroyMock).not.toHaveBeenCalled();
  });

  it("isDirty=true + save success → destroy is called", async () => {
    // Mock save_document to succeed
    mockInvoke({
      load_app_settings: {
        success: true,
        data: {
          recentWorkspacePath: "/ws",
          recentDocumentPath: "doc.md",
          viewMode: "split-editor",
        },
      },
      load_workspace: {
        success: true,
        data: {
          workspace: { rootPath: "/ws", displayName: "ws", fileCount: 3, isAvailable: true },
          indexTree: [],
          flatEntries: [],
        },
      },
      open_document: {
        success: true,
        data: { path: "doc.md", relativePath: "doc.md", content: "# Initial", updatedAt: "123" },
      },
      save_document: {
        success: true,
        data: { path: "doc.md", relativePath: "doc.md", content: "# Modified content", updatedAt: "456" },
      },
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Make dirty
    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    await act(async () => {
      const { fireEvent } = await import("@testing-library/react");
      fireEvent.change(textarea, { target: { value: "# Modified content" } });
    });
    await flushMicrotasks();

    // Trigger close
    await triggerCloseRequest();

    // Dialog shows → click "保存并继续" (save)
    const saveBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent === "保存并继续");
    if (saveBtn) {
      await act(async () => { saveBtn.click(); });
      await flushMicrotasks();
    }

    // After save succeeds, destroy should be called
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("isDirty=true + save failure → destroy is NOT called", async () => {
    // Mock save_document to fail
    mockInvoke({
      load_app_settings: {
        success: true,
        data: {
          recentWorkspacePath: "/ws",
          recentDocumentPath: "doc.md",
          viewMode: "split-editor",
        },
      },
      load_workspace: {
        success: true,
        data: {
          workspace: { rootPath: "/ws", displayName: "ws", fileCount: 3, isAvailable: true },
          indexTree: [],
          flatEntries: [],
        },
      },
      open_document: {
        success: true,
        data: { path: "doc.md", relativePath: "doc.md", content: "# Initial", updatedAt: "123" },
      },
      save_document: {
        success: false,
        data: null,
        error: { code: "SAVE_FAILED", message: "保存失败", recoverable: true },
      },
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Make dirty
    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    await act(async () => {
      const { fireEvent } = await import("@testing-library/react");
      fireEvent.change(textarea, { target: { value: "# Modified content" } });
    });
    await flushMicrotasks();

    // Trigger close
    await triggerCloseRequest();

    // Dialog shows → click "保存并继续" (save)
    const saveBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent === "保存并继续");
    if (saveBtn) {
      await act(async () => { saveBtn.click(); });
      await flushMicrotasks();
    }

    // After save fails, destroy should NOT be called (window stays open)
    expect(destroyMock).not.toHaveBeenCalled();
  });
});