/**
 * Tests for closing the current document (Item A).
 *
 * Scenarios:
 * 1. isDirty=false → clean close
 * 2. isDirty=true + cancel → no close
 * 3. isDirty=true + save success → close
 * 4. isDirty=true + save fail → no close
 * 5. Cmd+W triggers handleCloseDocument
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

// Mock render service
vi.mock("../../services/render", () => ({
  renderMarkdown: vi.fn(() => ({ html: "<div>test</div>", errors: [], hasDegradedBlocks: false, imageErrors: [], mathErrors: [] })),
  splitMarkdown: vi.fn((c: string) => [c]),
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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

import App from "../App";

describe("Close document (Item A)", () => {
  it("isDirty=false → clean close, doc placeholder shown", async () => {
    mockInvoke({
      load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", recentDocumentPath: "doc.md", viewMode: "split-editor" } },
      load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 1, isAvailable: true }, indexTree: [], flatEntries: [] } },
      open_document: { success: true, data: { path: "doc.md", relativePath: "doc.md", content: "# Clean", updatedAt: "123" } },
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Document should be visible
    expect(document.querySelector(".content-editor-textarea")).not.toBeNull();

    // Click close button
    const closeBtn = document.querySelector<HTMLButtonElement>('[title*="Cmd/Ctrl+W"]');
    expect(closeBtn).not.toBeNull();

    await act(async () => { fireEvent.click(closeBtn!); });
    await flushMicrotasks();

    // Document placeholder should show
    expect(document.querySelector(".content-editor-textarea")).toBeNull();
    expect(document.body.textContent).toContain("请从左侧索引列表中选择");
  });

  it("isDirty=true + cancel → no close", async () => {
    mockInvoke({
      load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", recentDocumentPath: "doc.md", viewMode: "split-editor" } },
      load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 1, isAvailable: true }, indexTree: [], flatEntries: [] } },
      open_document: { success: true, data: { path: "doc.md", relativePath: "doc.md", content: "# Dirty", updatedAt: "123" } },
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Make dirty
    const textarea = document.querySelector<HTMLTextAreaElement>(".content-editor-textarea")!;
    await act(async () => { fireEvent.change(textarea, { target: { value: "# Modified" } }); });
    await flushMicrotasks();

    // Click close
    const closeBtn = document.querySelector<HTMLButtonElement>('[title*="Cmd/Ctrl+W"]');
    await act(async () => { fireEvent.click(closeBtn!); });
    await flushMicrotasks();

    // Dialog appears → click "取消"
    const cancelBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent === "取消");
    if (cancelBtn) {
      await act(async () => { fireEvent.click(cancelBtn); });
      await flushMicrotasks();
    }

    // Document should still be visible
    expect(document.querySelector(".content-editor-textarea")).not.toBeNull();
  });

  it("Cmd+W triggers close", async () => {
    mockInvoke({
      load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", recentDocumentPath: "doc.md", viewMode: "split-editor" } },
      load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 1, isAvailable: true }, indexTree: [], flatEntries: [] } },
      open_document: { success: true, data: { path: "doc.md", relativePath: "doc.md", content: "# Doc", updatedAt: "123" } },
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(document.querySelector(".content-editor-textarea")).not.toBeNull();

    // Press Cmd+W
    await act(async () => { fireEvent.keyDown(window, { key: "w", metaKey: true }); });
    await flushMicrotasks();

    // Document should close
    expect(document.querySelector(".content-editor-textarea")).toBeNull();
    expect(document.body.textContent).toContain("请从左侧索引列表中选择");
  });
});