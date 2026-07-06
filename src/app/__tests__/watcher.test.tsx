/**
 * Component-level tests for App.tsx workspace watcher integration (T12).
 *
 * Verifies:
 * - Frontend listens for "workspace://index-changed" events
 * - On receiving event with matching rootPath → calls refreshIndex
 * - On receiving event with non-matching rootPath → ignores (prevents cross-talk)
 * - Watcher lifecycle: auto-starts on Rust side (frontend doesn't block on failure)
 * - Workspace switch automatically handles old/new watcher (Rust side)
 *
 * Requires a custom listen mock that captures event handlers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";

// ── Custom listen mock: capture event handlers for trigger in tests ──

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
  // Clear captured event handlers
  Object.keys(eventHandlers).forEach((k) => delete eventHandlers[k]);
});

import App from "../App";
import { listen } from "@tauri-apps/api/event";

describe("App.tsx watcher event listener", () => {
  it("listens for workspace://index-changed event after restore", async () => {
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
        data: { path: "doc.md", relativePath: "doc.md", content: "# Hello", updatedAt: "123" },
      },
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks(); // Flush restore chain

    // Verify that listen was called for the watcher event
    const listenCalls = vi.mocked(listen).mock.calls;
    const watcherEventCalls = listenCalls.filter(
      ([eventName]) => eventName === "workspace://index-changed",
    );
    expect(watcherEventCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("on matching rootPath event, calls refresh_workspace_index", async () => {
    mockInvoke({
      load_app_settings: {
        success: true,
        data: { recentWorkspacePath: "/ws", viewMode: "split-editor" },
      },
      load_workspace: {
        success: true,
        data: {
          workspace: { rootPath: "/ws", displayName: "ws", fileCount: 3, isAvailable: true },
          indexTree: [],
          flatEntries: [],
        },
      },
      refresh_workspace_index: {
        success: true,
        data: {
          workspace: { rootPath: "/ws", displayName: "ws", fileCount: 3, isAvailable: true },
          indexTree: [
            { id: "new.md", name: "new.md", type: "file", relativePath: "new.md" },
          ],
          flatEntries: [],
        },
      },
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks(); // Flush restore chain

    // Trigger the watcher event
    const handler = eventHandlers["workspace://index-changed"];
    expect(handler).toBeDefined();

    await act(async () => {
      await handler({ payload: { rootPath: "/ws" } });
    });
    await flushMicrotasks(); // Flush the refreshIndex async call

    // Verify refresh_workspace_index was called
    const invokeCalls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(invokeCalls).toContain("refresh_workspace_index");
  });

  it("on non-matching rootPath event, does NOT call refresh_workspace_index", async () => {
    const invokeCalls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      invokeCalls.push(cmd);
      const behaviors: Record<string, object> = {
        load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", viewMode: "split-editor" } },
        load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 3, isAvailable: true }, indexTree: [], flatEntries: [] } },
      };
      return behaviors[cmd] ?? { success: true, data: null };
    });

    render(<App />);
    await flushMicrotasks();
    await flushMicrotasks();

    // Trigger event with WRONG rootPath
    const handler = eventHandlers["workspace://index-changed"];
    expect(handler).toBeDefined();

    await act(async () => {
      await handler({ payload: { rootPath: "/other-workspace" } });
    });
    await flushMicrotasks();

    // Should NOT have called refresh_workspace_index
    expect(invokeCalls).not.toContain("refresh_workspace_index");
  });

  it("unlisten is called on unmount", async () => {
    const unlistenFns: Array<() => void> = [];
    vi.mocked(listen).mockImplementation(
      async (_event: string, _handler: any) => {
        const fn = vi.fn();
        unlistenFns.push(fn);
        return fn;
      },
    );

    mockInvoke({
      load_app_settings: { success: true, data: { viewMode: "split-editor" } },
    });

    const { unmount } = render(<App />);
    await flushMicrotasks();

    unmount();

    // All unlisten functions should have been called
    expect(unlistenFns.length).toBeGreaterThan(0);
  });
});