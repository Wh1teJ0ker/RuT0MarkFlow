/**
 * App-level tests for T37 long-document chunked rendering.
 *
 * Verifies:
 * - First chunks render synchronously (visible in DOM immediately)
 * - Remaining chunks arrive via incremental scheduling
 * - Per-chunk cache: editing one chunk only re-renders that chunk
 * - Short documents (single chunk) do not use chunked path
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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

// ── Mock the render service to track calls ────────────────────

const renderServiceCalls: Array<{ content: string }> = [];

/** Minimal splitter for test — splits at maxLines boundary. */
function mockSplitMarkdown(content: string, maxLines = 500): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  if (lines.length <= maxLines) return [content];
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    chunks.push(lines.slice(i, i + maxLines).join("\n"));
  }
  return chunks;
}

vi.mock("../../services/render", () => ({
  renderMarkdown: vi.fn((content: string) => {
    renderServiceCalls.push({ content });
    return {
      html: `<div class="mock-render">${content.substring(0, 50)}</div>`,
      errors: [],
      hasDegradedBlocks: false,
      imageErrors: [],
      mathErrors: [],
    };
  }),
  splitMarkdown: mockSplitMarkdown,
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
  renderServiceCalls.length = 0;
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

describe("App.tsx long document chunking (T37)", () => {
  it("short document: single chunk, no chunked html", async () => {
    setupRestoredDocument("# Short doc");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(renderServiceCalls.length).toBe(1);
    // No .render-chunk wrapper for single chunk
    const chunkEls = document.querySelectorAll(".render-chunk");
    expect(chunkEls.length).toBe(0);
  });

  it("long document: first chunks visible in DOM immediately", async () => {
    const longContent = Array.from({ length: 2000 }, (_, i) => `Line ${i + 1}`).join("\n");
    setupRestoredDocument(longContent);
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();
    await act(async () => {}); // Flush pending React state updates

    // First 2 chunks rendered synchronously
    expect(renderServiceCalls.length).toBe(2);

    // .render-chunk elements should be in the DOM (from sync chunks)
    const chunkEls = document.querySelectorAll(".render-chunk");
    expect(chunkEls.length).toBe(2);
  });

  it("long document: all chunks arrive after scheduling", async () => {
    const longContent = Array.from({ length: 2000 }, (_, i) => `Line ${i + 1}`).join("\n");
    setupRestoredDocument(longContent);
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();
    await act(async () => {}); // Flush pending React state updates

    // 2 sync chunks
    expect(renderServiceCalls.length).toBe(2);
    expect(document.querySelectorAll(".render-chunk").length).toBe(2);

    // Advance timers — remaining chunks arrive
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    await act(async () => {}); // Flush pending React state updates

    // All 4 chunks
    expect(renderServiceCalls.length).toBe(4);
    expect(document.querySelectorAll(".render-chunk").length).toBe(4);
  });

  it("per-chunk cache: editing unchanged chunks does not re-render", async () => {
    const longContent = Array.from({ length: 2000 }, (_, i) => `Line ${i + 1}`).join("\n");
    setupRestoredDocument(longContent);
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // All chunks arrive
    await act(async () => { vi.advanceTimersByTime(10); });
    await act(async () => {}); // Flush
    expect(renderServiceCalls.length).toBe(4);

    // Find the textarea and edit the content (change only the first chunk)
    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    // Change first line only (rest of doc unchanged)
    const newContent = "## Modified\n" + longContent.split("\n").slice(1).join("\n");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: newContent } });
    });
    // Advance past debounce (250ms)
    await act(async () => { vi.advanceTimersByTime(260); });
    await act(async () => {}); // Flush

    // Should have rendered only the changed chunk(s)
    // The first chunk changed, so it should be re-rendered
    // The other chunks are unchanged → served from cache
    expect(renderServiceCalls.length).toBe(5);
  });
});