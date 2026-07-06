/**
 * Component-level tests for App.tsx startup restore effect.
 *
 * Renders the actual <App /> component with mocked Tauri invoke,
 * then verifies the restore flow: load settings → load workspace →
 * conditional document open, with correct timing and state transitions.
 *
 * Uses proper act() wrappers to flush async microtasks from
 * React useEffect, avoiding both setTimeout fragility and
 * act(...) warnings.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";

// ── Mock all Tauri modules ───────────────────────────────────────

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
});

// Import App after all mocks are set up
import App from "../App";

describe("App.tsx startup restore — component-level", () => {
  it("mounts and calls load_app_settings", async () => {
    const mock = vi.mocked(invoke);
    mockInvoke({
      load_app_settings: { success: true, data: { viewMode: "split-editor" } },
    });

    render(<App />);
    await flushMicrotasks();

    const allCalls = mock.mock.calls.map(([cmd]) => cmd);
    expect(allCalls.length).toBeGreaterThan(0);
    expect(allCalls).toContain("load_app_settings");
  });

  it("with valid workspace + doc, calls load_workspace then open_document in order", async () => {
    const mock = vi.mocked(invoke);
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
          flatEntries: [
            { id: "doc.md", name: "doc.md", absolutePath: "/ws/doc.md", relativePath: "doc.md", parentRelativePath: "", extension: "md" },
          ],
        },
      },
      open_document: {
        success: true,
        data: { path: "doc.md", relativePath: "doc.md", content: "# Doc", updatedAt: "123" },
      },
    });

    render(<App />);
    await flushMicrotasks();
    // Second flush to let the document-open effect settle
    await flushMicrotasks();

    const allCalls = mock.mock.calls.map(([cmd]) => cmd);
    expect(allCalls).toContain("load_app_settings");
    expect(allCalls).toContain("load_workspace");
    expect(allCalls).toContain("open_document");

    const loadIdx = allCalls.indexOf("load_app_settings");
    const wsIdx = allCalls.indexOf("load_workspace");
    const docIdx = allCalls.indexOf("open_document");
    // Order: settings → workspace → document
    expect(loadIdx).toBeLessThan(wsIdx);
    expect(wsIdx).toBeLessThan(docIdx);
  });

  it("with invalid workspace, does NOT call open_document", async () => {
    const mock = vi.mocked(invoke);
    mockInvoke({
      load_app_settings: {
        success: true,
        data: { recentWorkspacePath: "/missing", recentDocumentPath: "doc.md", viewMode: "split-editor" },
      },
      load_workspace: {
        success: false,
        data: null,
        error: { code: "WORKSPACE_NOT_FOUND", message: "路径不存在", recoverable: true },
      },
    });

    render(<App />);
    await flushMicrotasks();
    // Also flush any settings-save effect
    await flushMicrotasks();

    const allCalls = mock.mock.calls.map(([cmd]) => cmd);
    expect(allCalls).toContain("load_workspace");
    expect(allCalls).not.toContain("open_document");
  });

  it("save_app_settings is called only after restore (load_workspace) completes", async () => {
    const invokeCalls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      invokeCalls.push(cmd);
      const behaviors: Record<string, object> = {
        load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", viewMode: "split-editor" } },
        load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 1, isAvailable: true }, indexTree: [], flatEntries: [] } },
      };
      return behaviors[cmd] ?? { success: true, data: null };
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(invokeCalls).toContain("load_app_settings");
    expect(invokeCalls).toContain("load_workspace");

    const loadIdx = invokeCalls.indexOf("load_app_settings");
    const wsIdx = invokeCalls.indexOf("load_workspace");
    const saveIdx = invokeCalls.indexOf("save_app_settings");

    expect(loadIdx).toBeLessThan(wsIdx);
    if (saveIdx !== -1) {
      expect(saveIdx).toBeGreaterThan(wsIdx);
    }
  });
});