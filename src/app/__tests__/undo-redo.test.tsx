/**
 * Integration tests for undo/redo + keyboard shortcuts (P1).
 *
 * Uses the same mock pattern as window-close-guard.test.tsx and
 * render-debounce.test.tsx.
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

// Mock render service
const renderCalls: Array<{ content: string }> = [];
vi.mock("../../services/render", () => ({
  renderMarkdown: vi.fn((content: string) => {
    renderCalls.push({ content });
    return { html: `<div>${content}</div>`, errors: [], hasDegradedBlocks: false, imageErrors: [], mathErrors: [] };
  }),
  splitMarkdown: vi.fn((c: string, m = 500) => {
    const lines = c.split("\n");
    return lines.length <= m ? [c] : [c]; // simplified for test
  }),
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
  renderCalls.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

import App from "../App";

function setupRestoredDocument(content: string) {
  mockInvoke({
    load_app_settings: {
      success: true,
      data: { recentWorkspacePath: "/ws", recentDocumentPath: "doc.md", viewMode: "split-editor" },
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

describe("Undo/redo + keyboard shortcuts (P1)", () => {
  it("Cmd+Z undoes content change", async () => {
    setupRestoredDocument("# v0");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    // Type v1
    await act(async () => { fireEvent.change(textarea, { target: { value: "# v1" } }); });
    await flushMicrotasks();

    expect(textarea.value).toBe("# v1");

    // Press Cmd+Z to undo
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });
    await flushMicrotasks();

    expect(textarea.value).toBe("# v0");
  });

  it("Cmd+Shift+Z redoes content change", async () => {
    setupRestoredDocument("# v0");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    // Type v1
    await act(async () => { fireEvent.change(textarea, { target: { value: "# v1" } }); });
    await flushMicrotasks();

    // Undo
    await act(async () => { fireEvent.keyDown(window, { key: "z", metaKey: true }); });
    await flushMicrotasks();
    expect(textarea.value).toBe("# v0");

    // Redo
    await act(async () => { fireEvent.keyDown(window, { key: "z", shiftKey: true, metaKey: true }); });
    await flushMicrotasks();
    expect(textarea.value).toBe("# v1");
  });

  it("Cmd+1 switches to immersive-preview (textarea disappears)", async () => {
    setupRestoredDocument("# Hello");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Should be in split-editor mode initially — textarea present
    expect(document.querySelector(".content-editor-textarea")).not.toBeNull();

    // Press Cmd+1 for immersive-preview
    await act(async () => {
      fireEvent.keyDown(window, { key: "1", metaKey: true });
    });
    await flushMicrotasks();

    // In immersive-preview, textarea should not be present
    expect(document.querySelector(".content-editor-textarea")).toBeNull();
  });

  it("Cmd+2 switches to split-editor (textarea reappears)", async () => {
    setupRestoredDocument("# Hello");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Switch to immersive first
    await act(async () => { fireEvent.keyDown(window, { key: "1", metaKey: true }); });
    await flushMicrotasks();
    expect(document.querySelector(".content-editor-textarea")).toBeNull();

    // Press Cmd+2 for split-editor
    await act(async () => {
      fireEvent.keyDown(window, { key: "2", metaKey: true });
    });
    await flushMicrotasks();

    // Textarea should be back
    expect(document.querySelector(".content-editor-textarea")).not.toBeNull();
  });
});