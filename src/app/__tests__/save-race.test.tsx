/**
 * Tests for T4: save / save-as race condition fixes.
 *
 * Race 1 (handleSaveDocument): if the user types while a save is in-flight,
 * the success handler must not mark the new content as saved. It must set
 * lastSavedContent to the snapshot that was actually saved and recompute
 * isDirty by comparing the latest content against that snapshot.
 *
 * Race 2 (handleSaveAs): if the user types while a save-as is in-flight,
 * the success handler must preserve the latest content (prev.content) and
 * not overwrite it with the stale closure snapshot.
 *
 * Timing strategy: we replace `invoke` with a mock whose `save_document` /
 * `save_document_as` return a promise we control. This lets us type into
 * the textarea AFTER the save call has started but BEFORE it resolves,
 * which is exactly the race window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { act } from "react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ destroy: vi.fn() })),
}));

vi.mock("../../services/render", () => ({
  renderMarkdown: vi.fn(() => ({
    html: "<div>test</div>",
    errors: [],
    hasDegradedBlocks: false,
    imageErrors: [],
    mathErrors: [],
  })),
  splitMarkdown: vi.fn((c: string) => [c]),
}));

import { invoke } from "@tauri-apps/api/core";
import App from "../App";

/** Holder for a controllable save promise so tests can resolve it on demand. */
let resolveSave: ((value: unknown) => void) | null = null;
let saveCallCount = 0;

function mockInvoke(behaviors: Record<string, unknown>) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd in behaviors) {
      const b = behaviors[cmd];
      // For save_document / save_document_as, return a controllable promise
      // so we can type during the in-flight save.
      if (cmd === "save_document" || cmd === "save_document_as") {
        saveCallCount += 1;
        // Record the content that was passed to the save call.
        saveCallArgs.push((args as { content?: string })?.content ?? "");
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      }
      return b;
    }
    return {
      success: false,
      data: null,
      error: {
        code: "NO_MOCK",
        message: "no mock for " + cmd,
        recoverable: true,
      },
    };
  });
}

let saveCallArgs: string[] = [];

async function flushMicrotasks() {
  await act(() => Promise.resolve());
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveSave = null;
  saveCallCount = 0;
  saveCallArgs = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

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
        workspace: {
          rootPath: "/ws",
          displayName: "ws",
          fileCount: 1,
          isAvailable: true,
        },
        indexTree: [],
        flatEntries: [],
      },
    },
    open_document: {
      success: true,
      data: {
        path: "doc.md",
        relativePath: "doc.md",
        content,
        updatedAt: "123",
      },
    },
    set_document_dirty: null,
    save_document: { success: true, data: { path: "doc.md" } },
    save_document_as: { success: true, data: { path: "new.md" } },
  });
}

async function renderApp() {
  render(<App />);
  await flushMicrotasks();
  await flushMicrotasks();
}

function getSaveButton(): HTMLButtonElement | null {
  // The toolbar save button has a Cmd/Ctrl+S tooltip hint.
  return document.querySelector<HTMLButtonElement>('[title*="Cmd/Ctrl+S"]');
}

function triggerCmdS() {
  return act(async () => {
    fireEvent.keyDown(window, { key: "s", metaKey: true });
  });
}

describe("T4 — handleSaveDocument race condition", () => {
  it("typing during save keeps new content and marks isDirty=true", async () => {
    setupRestoredDocument("# Initial");
    await renderApp();

    // Make the document dirty so save is enabled.
    const textarea = document.querySelector<HTMLTextAreaElement>(
      ".content-editor-textarea",
    )!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Modified" } });
    });
    await flushMicrotasks();

    // Start save (Cmd+S). save_document is in-flight (controllable promise).
    await triggerCmdS();
    await flushMicrotasks();

    expect(saveCallCount).toBe(1);
    // The snapshot passed to save_document is the content BEFORE typing-during-save.
    expect(saveCallArgs[0]).toBe("# Modified");

    // Simulate the user typing MORE content while the save is in-flight.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Modified\nnew line during save" } });
    });
    await flushMicrotasks();

    // Now resolve the save. The success handler must:
    //  - set lastSavedContent to "# Modified" (the snapshot actually saved)
    //  - recompute isDirty: latest content !== snapshot → true
    await act(async () => {
      resolveSave!({ success: true, data: { path: "doc.md" } });
    });
    await flushMicrotasks();

    // The textarea must still show the latest content (not lost).
    expect(textarea.value).toBe("# Modified\nnew line during save");

    // The document must be marked dirty (new content not yet saved).
    // We assert via the status bar dirty indicator text if present,
    // and via the save button being enabled (dirty=true).
    const saveBtn = getSaveButton();
    expect(saveBtn).not.toBeNull();
    expect(saveBtn!.disabled).toBe(false);

    // Verify by triggering a re-render assertion: the status message should
    // indicate "已保存" but isDirty recomputed true. We assert the textarea
    // content is preserved (the core of the race fix).
    expect(textarea.value).toContain("new line during save");
  });

  it("no typing during save → isDirty=false after success", async () => {
    setupRestoredDocument("# Initial");
    await renderApp();

    const textarea = document.querySelector<HTMLTextAreaElement>(
      ".content-editor-textarea",
    )!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Modified" } });
    });
    await flushMicrotasks();

    await triggerCmdS();
    await flushMicrotasks();

    // No further typing — resolve immediately.
    await act(async () => {
      resolveSave!({ success: true, data: { path: "doc.md" } });
    });
    await flushMicrotasks();

    // latest content === snapshot → isDirty false
    expect(textarea.value).toBe("# Modified");
    const saveBtn = getSaveButton();
    expect(saveBtn).not.toBeNull();
    // When not dirty, save button should be disabled.
    expect(saveBtn!.disabled).toBe(true);
  });
});

describe("T4 — handleSaveAs race condition", () => {
  function setupSaveAsMocks(content: string) {
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
          workspace: {
            rootPath: "/ws",
            displayName: "ws",
            fileCount: 1,
            isAvailable: true,
          },
          indexTree: [],
          flatEntries: [],
        },
      },
      open_document: {
        success: true,
        data: {
          path: "doc.md",
          relativePath: "doc.md",
          content,
          updatedAt: "123",
        },
      },
      set_document_dirty: null,
      pick_save_path: {
        success: true,
        data: {
          saveToken: "tok-123",
          absolutePath: "/ws/new.md",
          relativePath: "new.md",
          isWithinWorkspace: true,
        },
      },
      refresh_workspace_index: {
        success: true,
        data: {
          workspace: {
            rootPath: "/ws",
            displayName: "ws",
            fileCount: 2,
            isAvailable: true,
          },
          indexTree: [],
          flatEntries: [],
        },
      },
      save_document_as: { success: true, data: { path: "new.md" } },
    });
  }

  function triggerCmdShiftS() {
    return act(async () => {
      fireEvent.keyDown(window, { key: "s", metaKey: true, shiftKey: true });
    });
  }

  it("typing during save-as preserves new content and marks isDirty=true", async () => {
    setupSaveAsMocks("# Initial");
    await renderApp();

    const textarea = document.querySelector<HTMLTextAreaElement>(
      ".content-editor-textarea",
    )!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# To save-as" } });
    });
    await flushMicrotasks();

    // Start save-as (Cmd+Shift+S). pick_save_path resolves synchronously-ish,
    // then save_document_as is in-flight via the controllable promise.
    await triggerCmdShiftS();
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(saveCallCount).toBe(1);
    expect(saveCallArgs[0]).toBe("# To save-as");

    // Type more content while save-as is in-flight.
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "# To save-as\nmore typing during save-as" },
      });
    });
    await flushMicrotasks();

    // Resolve the save-as.
    await act(async () => {
      resolveSave!({ success: true, data: { path: "new.md" } });
    });
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    // The new content typed during save-as must NOT be lost.
    expect(textarea.value).toBe("# To save-as\nmore typing during save-as");

    // isDirty must be true: latest content !== snapshot that was saved.
    const saveBtn = getSaveButton();
    expect(saveBtn).not.toBeNull();
    expect(saveBtn!.disabled).toBe(false);
  });

  it("no typing during save-as → isDirty=false and content preserved", async () => {
    setupSaveAsMocks("# Initial");
    await renderApp();

    const textarea = document.querySelector<HTMLTextAreaElement>(
      ".content-editor-textarea",
    )!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# To save-as" } });
    });
    await flushMicrotasks();

    await triggerCmdShiftS();
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    // No further typing — resolve.
    await act(async () => {
      resolveSave!({ success: true, data: { path: "new.md" } });
    });
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(textarea.value).toBe("# To save-as");
    const saveBtn = getSaveButton();
    expect(saveBtn).not.toBeNull();
    expect(saveBtn!.disabled).toBe(true);
  });
});
