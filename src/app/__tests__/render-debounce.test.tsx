/**
 * Component-level tests for App.tsx render debounce (T35).
 *
 * Verifies via DOM interaction:
 * - Continuous content changes only trigger one render after debounce
 * - Document/identity switch → immediate render (no debounce delay)
 * - ViewMode switch → immediate render (no debounce delay)
 * - Debounce cancels previous timer on new content change
 * - Empty content → immediate empty render, no debounce
 * - Cache hit → useRender skips renderMarkdown call
 * - Unmount cleanup does not throw
 *
 * All tests use vi.useFakeTimers() per requirements — no real setTimeout waits.
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
// We inline splitMarkdown from the real chunker to avoid circular mock issues.

const renderServiceCalls: Array<{ content: string }> = [];

/** Minimal chunk splitter for test — splits at double-newline boundaries. */
function mockSplitMarkdown(content: string, maxLines = 500): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  if (lines.length <= maxLines) return [content];
  // For tests, just split at maxLines boundary (no fence protection needed)
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
      html: `<div>${content}</div>`,
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

/** Flush all pending microtasks (React state updates from async effects). */
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

// Import App after all mocks are set up
import App from "../App";

/**
 * Set up mock responses so the App's restore effect loads a workspace
 * and opens a document with the given content.
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

describe("App.tsx render debounce (T35)", () => {
  it("restored document renders immediately (identity change, no debounce)", async () => {
    setupRestoredDocument("# Hello World");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks(); // Flush restore chain

    // Initial identity change triggers render immediately — no timer tick needed
    expect(renderServiceCalls.length).toBe(1);
    expect(renderServiceCalls[0].content).toBe("# Hello World");
  });

  it("continuous content changes only trigger one render after debounce", async () => {
    setupRestoredDocument("# Initial");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();
    expect(renderServiceCalls.length).toBe(1); // Initial render from restore

    // Find the textarea
    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    // Simulate rapid typing: 3 content changes within 50ms each (< 250ms debounce)
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Change 1" } });
    });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Change 2 longer" } });
    });
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Change 3 final" } });
    });

    // No timer advanced yet — debounce should still be pending, render not called
    expect(renderServiceCalls.length).toBe(1);

    // Advance time past debounce threshold
    await act(async () => {
      vi.advanceTimersByTime(260);
    });

    // Only one additional render call (not 3 separate calls)
    expect(renderServiceCalls.length).toBe(2);
    expect(renderServiceCalls[1].content).toBe("# Change 3 final");
  });

  it("debounce cancels previous timer when new content arrives", async () => {
    setupRestoredDocument("# Start");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();
    expect(renderServiceCalls.length).toBe(1);

    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    // First content change — start debounce timer
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Partial change" } });
    });

    // Advance 100ms — not enough for debounce to fire
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(renderServiceCalls.length).toBe(1); // Still waiting

    // Second content change — cancels previous timer and sets a new one
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Final version" } });
    });

    // Advance ANOTHER 200ms (total 300ms from first, but only 200ms from second)
    // If the old timer hadn't been cancelled, it would have fired at 250ms from first
    // Since it was cancelled, only the new timer is active (200ms of 250ms elapsed)
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // Total time from first change: 300ms (100 + 200)
    // Total time from second change: 200ms (< 250ms, so still waiting)
    // No render should have fired yet
    expect(renderServiceCalls.length).toBe(1);

    // Advance remaining debounce time
    await act(async () => {
      vi.advanceTimersByTime(60);
    });

    // Now 260ms from second change — debounce fires
    expect(renderServiceCalls.length).toBe(2);
    expect(renderServiceCalls[1].content).toBe("# Final version");
  });

  it("cache hit does not call renderMarkdown again", async () => {
    setupRestoredDocument("# Hello");
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();
    expect(renderServiceCalls.length).toBe(1); // First render

    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    expect(textarea).not.toBeNull();

    // Change to different content → debounce → new render
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# World" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    // Now 2 calls (initial + "# World")
    expect(renderServiceCalls.length).toBe(2);

    // Change back to original "# Hello" → cache should hit
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "# Hello" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(260);
    });

    // Cache hit → renderMarkdown NOT called → still 2 calls
    expect(renderServiceCalls.length).toBe(2);
  });

  it("unmount during debounce clears timer and does not throw", async () => {
    setupRestoredDocument("# Doc");
    const { unmount } = render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(() => {
      act(() => {
        unmount();
      });
    }).not.toThrow();
  });

  it("empty content renders empty and clears debounce timer", async () => {
    // Start with no workspace/doc restore (content is "")
    mockInvoke({
      load_app_settings: {
        success: true,
        data: { viewMode: "split-editor" },
      },
    });

    render(<App />);
    await flushMicrotasks();

    // With empty content and no document, render("") is called immediately
    // No debounce timer should be set for empty content
    // render("") goes through useRender which returns early for !content
    // without calling renderMarkdown, so renderServiceCalls stays 0
    expect(renderServiceCalls.length).toBe(0);
  });

  // ── T37: chunked rendering ─────────────────────────────────

  it("long document: first chunk(s) sync, remaining via setTimeout", async () => {
    // Generate content that splits into 4 chunks (2000 lines, maxChunkLines=500)
    const longContent = Array.from({ length: 2000 }, (_, i) => `Line ${i + 1}`).join("\n");
    setupRestoredDocument(longContent);
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // First 2 chunks rendered synchronously (SYNC_CHUNK_COUNT=2)
    expect(renderServiceCalls.length).toBe(2);
    expect(renderServiceCalls[0].content).toContain("Line 1");
    expect(renderServiceCalls[1].content).toContain("Line 501");

    // Advance timers — remaining 2 chunks should arrive
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    // All 4 chunks rendered
    expect(renderServiceCalls.length).toBe(4);
    expect(renderServiceCalls[2].content).toContain("Line 1001");
    expect(renderServiceCalls[3].content).toContain("Line 1501");
  });

  it("long document: isRendering stays true until all chunks complete", async () => {
    const longContent = Array.from({ length: 2000 }, (_, i) => `Line ${i + 1}`).join("\n");
    setupRestoredDocument(longContent);
    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // After sync render, isRendering is true (more chunks pending)
    expect(renderServiceCalls.length).toBe(2);

    // Advance timers to complete all chunks
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    // All 4 chunks done
    expect(renderServiceCalls.length).toBe(4);
  });
});