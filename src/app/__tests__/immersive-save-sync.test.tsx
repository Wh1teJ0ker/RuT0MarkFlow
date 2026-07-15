/**
 * Integration tests for T11 — 无感编辑器与保存状态联动.
 *
 * Acceptance criteria verified end-to-end (at App level):
 * 1. 编辑内容实时同步到 documentStore.content
 *    (immersive-preview mode → ImmersiveEditor.onInput → App.handleContentChange)
 * 2. dirty 状态正确传播到 Rust（set_document_dirty）
 *    (App effect invokes set_document_dirty with the current isDirty value)
 * 3. 模式切换后编辑内容不丢失
 *    (split → immersive → split: textarea still reflects edited content)
 * 4. 保存后 dirty 状态正确清除
 *    (save_document success → isDirty=false → set_document_dirty(false) invoked)
 *
 * Uses the same mock pattern as undo-redo.test.tsx / save-race.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { act } from "react";

// ── Mocks ─────────────────────────────────────────────────────

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

// Mock render service: echo content so the rendered HTML reflects edits,
// and provide a real deserializer so ImmersiveEditor.onInput round-trips
// the contentEditable DOM back to Markdown source.
vi.mock("../../services/render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/render")>();
  return {
    ...actual,
    renderMarkdown: vi.fn((content: string) => ({
      html: `<div>${content}</div>`,
      errors: [],
      hasDegradedBlocks: false,
      imageErrors: [],
      mathErrors: [],
    })),
    splitMarkdown: vi.fn((c: string) => [c]),
  };
});

import { invoke } from "@tauri-apps/api/core";
import App from "../App";

/** Captured set_document_dirty calls (dirty arg). */
let dirtyCalls: boolean[] = [];
/** Controllable save promise. */
let resolveSave: ((value: unknown) => void) | null = null;
let saveCallCount = 0;

function mockInvoke(behaviors: Record<string, unknown>) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "set_document_dirty") {
      const dirty = (args as { dirty?: boolean })?.dirty ?? false;
      dirtyCalls.push(dirty);
      return null;
    }
    if (cmd === "save_document") {
      saveCallCount += 1;
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    }
    const b = behaviors[cmd];
    return b ?? {
      success: false,
      data: null,
      error: { code: "NO_MOCK", message: "no mock for " + cmd, recoverable: true },
    };
  });
}

async function flushMicrotasks() {
  await act(() => Promise.resolve());
}

beforeEach(() => {
  vi.clearAllMocks();
  dirtyCalls = [];
  resolveSave = null;
  saveCallCount = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setupRestoredDocument(content: string, viewMode = "split-editor") {
  mockInvoke({
    load_app_settings: {
      success: true,
      data: { recentWorkspacePath: "/ws", recentDocumentPath: "doc.md", viewMode },
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

function getSaveButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[title*="Cmd/Ctrl+S"]');
}

describe("T11 — 无感编辑器与保存状态联动", () => {
  it("immersive 编辑内容实时同步到 documentStore.content", async () => {
    setupRestoredDocument("# Hello", "immersive-preview");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Should be in immersive-preview mode — contentEditable present, textarea absent.
    const editable = document.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(editable).toBeTruthy();
    expect(document.querySelector(".content-editor-textarea")).toBeNull();

    // Simulate user edit in the contentEditable: replace text and fire input.
    await act(async () => {
      editable.textContent = "# Hello edited";
      fireEvent.input(editable);
    });
    await flushMicrotasks();

    // Switch back to split-editor to read the authoritative content via textarea.
    await act(async () => {
      fireEvent.keyDown(window, { key: "2", metaKey: true });
    });
    await flushMicrotasks();

    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();
    // The edited content must have propagated to documentStore.content.
    expect(textarea.value).toContain("edited");
  });

  it("编辑后 dirty 状态传播到 Rust（set_document_dirty true）", async () => {
    setupRestoredDocument("# Initial", "split-editor");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Initial restore: document is not dirty → set_document_dirty(false) at least once.
    const initialFalseCount = dirtyCalls.filter((d) => d === false).length;
    expect(initialFalseCount).toBeGreaterThanOrEqual(1);

    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    // Edit → isDirty becomes true → effect invokes set_document_dirty(true).
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Modified" } });
    });
    await flushMicrotasks();

    expect(dirtyCalls).toContain(true);

    // Save button should be enabled (dirty).
    const saveBtn = getSaveButton();
    expect(saveBtn).not.toBeNull();
    expect(saveBtn!.disabled).toBe(false);
  });

  it("模式切换后编辑内容不丢失", async () => {
    setupRestoredDocument("# Original", "split-editor");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Edit in split-editor.
    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Edited in split" } });
    });
    await flushMicrotasks();

    // Switch to immersive-preview.
    await act(async () => {
      fireEvent.keyDown(window, { key: "1", metaKey: true });
    });
    await flushMicrotasks();
    expect(document.querySelector(".content-editor-textarea")).toBeNull();

    // Switch back to split-editor.
    await act(async () => {
      fireEvent.keyDown(window, { key: "2", metaKey: true });
    });
    await flushMicrotasks();

    // The edited content must still be present (not reverted to original).
    const textareaAfter = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textareaAfter.value).toBe("# Edited in split");
  });

  it("保存后 dirty 状态正确清除（set_document_dirty false）", async () => {
    setupRestoredDocument("# Initial", "split-editor");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Make dirty.
    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Saved content" } });
    });
    await flushMicrotasks();

    const trueCountBeforeSave = dirtyCalls.filter((d) => d === true).length;
    expect(trueCountBeforeSave).toBeGreaterThanOrEqual(1);

    // Trigger save (Cmd+S). save_document is in-flight via controllable promise.
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", metaKey: true });
    });
    await flushMicrotasks();

    expect(saveCallCount).toBe(1);

    // Resolve the save successfully.
    await act(async () => {
      resolveSave!({ success: true, data: { path: "doc.md" } });
    });
    await flushMicrotasks();

    // After save: latest content === snapshot → isDirty=false.
    // Save button should be disabled (not dirty).
    const saveBtn = getSaveButton();
    expect(saveBtn).not.toBeNull();
    expect(saveBtn!.disabled).toBe(true);

    // set_document_dirty(false) must have been invoked after the save cleared isDirty.
    // Find a false call that occurred after the last true call.
    const lastTrueIdx = dirtyCalls.lastIndexOf(true);
    const falseAfterSave = dirtyCalls
      .slice(lastTrueIdx >= 0 ? lastTrueIdx + 1 : 0)
      .some((d) => d === false);
    expect(falseAfterSave).toBe(true);
  });
});
