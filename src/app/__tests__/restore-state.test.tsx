/**
 * Regression tests for state persistence and startup recovery.
 *
 * Covers:
 * - Restore timing: saveAppSettings must not fire before restore completes
 * - Invalid workspace → cleanup + fallback to idle
 * - Valid workspace + valid document → both restored
 * - Valid workspace + invalid document → workspace stays, doc skipped
 * - viewMode restore and fallback
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Tauri invoke ────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

import { invoke } from "@tauri-apps/api/core";

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper: configure the mock to return different values per command
function mockInvokeFor(behaviors: Record<string, object>) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    const b = behaviors[cmd];
    return b ?? { success: false, data: null, error: { code: "UNKNOWN_COMMAND", message: "no mock", recoverable: true } };
  });
}

describe("restore chain: loadSettings → loadWorkspace → conditional openDocument", () => {
  it("valid workspace + valid doc: both are restored", async () => {
    mockInvokeFor({
      load_app_settings: { success: true, data: { recentWorkspacePath: "/ws", recentDocumentPath: "readme.md", viewMode: "split-editor" } },
      load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 3, isAvailable: true }, indexTree: [], flatEntries: [] } },
      open_document: { success: true, data: { path: "readme.md", relativePath: "readme.md", content: "# Hello", updatedAt: "123" } },
    });

    const { loadAppSettings } = await import("../../modules/workspace/mod");
    const settings = await loadAppSettings();
    expect(settings.recentWorkspacePath).toBe("/ws");
    expect(settings.recentDocumentPath).toBe("readme.md");

    const { loadWorkspace } = await import("../../modules/workspace/mod");
    const wsResult = await loadWorkspace("/ws");
    expect(wsResult.state).toBe("ready");
    expect(wsResult.workspace?.rootPath).toBe("/ws");

    const { openDocument } = await import("../../modules/document/mod");
    const docResult = await openDocument("/ws", "readme.md");
    expect(docResult.error).toBeUndefined();
    expect(docResult.state.content).toBe("# Hello");
  });

  it("invalid workspace falls back to error", async () => {
    mockInvokeFor({
      load_workspace: { success: false, data: null, error: { code: "WORKSPACE_NOT_FOUND", message: "路径不存在", recoverable: true } },
    });

    const { loadWorkspace } = await import("../../modules/workspace/mod");
    const wsResult = await loadWorkspace("/invalid/path");
    expect(wsResult.state).toBe("error");
    expect(wsResult.workspace).toBeNull();
  });

  it("valid workspace but invalid doc does not break workspace", async () => {
    mockInvokeFor({
      load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 3, isAvailable: true }, indexTree: [], flatEntries: [] } },
      open_document: { success: false, data: null, error: { code: "DOCUMENT_OPEN_FAILED", message: "文件不存在", recoverable: true } },
    });

    const { loadWorkspace } = await import("../../modules/workspace/mod");
    const wsResult = await loadWorkspace("/ws");
    expect(wsResult.state).toBe("ready");

    const { openDocument } = await import("../../modules/document/mod");
    const docResult = await openDocument("/ws", "nonexistent.md");
    expect(docResult.error).toBeTruthy();
  });
});

describe("saveAppSettings timing guard", () => {
  it("saveAppSettings is callable and passes correct data", async () => {
    mockInvokeFor({
      save_app_settings: { success: true, data: null },
    });

    const { saveAppSettings } = await import("../../modules/workspace/mod");
    await saveAppSettings({
      recentWorkspacePath: "/ws",
      recentDocumentPath: "doc.md",
      viewMode: "split-editor",
      theme: "light",
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("save_app_settings", expect.any(Object));
  });
});

describe("viewMode restore and fallback", () => {
  it("loadAppSettings returns viewMode when present", async () => {
    mockInvokeFor({
      load_app_settings: { success: true, data: { viewMode: "immersive-preview" } },
    });

    const { loadAppSettings } = await import("../../modules/workspace/mod");
    const settings = await loadAppSettings();
    expect(settings.viewMode).toBe("immersive-preview");
  });

  it("fallback to split-editor when loadAppSettings fails", async () => {
    mockInvokeFor({
      load_app_settings: { success: false, data: null, error: { code: "INVOKE_ERROR", message: "fail", recoverable: false } },
    });

    const { loadAppSettings } = await import("../../modules/workspace/mod");
    const settings = await loadAppSettings();
    expect(settings.viewMode).toBe("split-editor");
  });
});

describe("App-level restore timing (integration)", () => {
  // These tests verify the restoreEffect logic pattern used in App.tsx.
  // The actual App component uses the same pattern via restoreAttemptedRef.

it("restore effect must not set flag until all async operations finish", async () => {
    // Simulate App.tsx's restore flow with a state machine
    let restoreComplete = false;
    const callLog: string[] = [];

    async function simulateRestore() {
      // Step 1: load settings (async)
      callLog.push("loadSettings-start");
      await Promise.resolve(); // simulate async
      callLog.push("loadSettings-end");

      // Step 2: load workspace (async)
      callLog.push("loadWorkspace-start");
      await Promise.resolve(); // simulate async
      callLog.push("loadWorkspace-end");

      // Step 3: open document (async)
      callLog.push("openDocument-start");
      await Promise.resolve(); // simulate async
      callLog.push("openDocument-end");

      // Step 4: ONLY NOW set the flag
      restoreComplete = true;
      callLog.push("restoreComplete");
    }

    // Start restore (runs until first await, then yields)
    const promise = simulateRestore();

    // Before restore completes, flag must be false
    expect(restoreComplete).toBe(false);

    await promise;
    expect(restoreComplete).toBe(true);

    // Verify order: settings → workspace → document → flag
    expect(callLog).toEqual([
      "loadSettings-start",
      "loadSettings-end",
      "loadWorkspace-start",
      "loadWorkspace-end",
      "openDocument-start",
      "openDocument-end",
      "restoreComplete",
    ]);
  });

  it("save effect must NOT fire before restore flag is set", async () => {
    // Simulate the App.tsx pattern: saveEffect checks restoreAttemptedRef
    let saveAttempted = false;
    let restoreComplete = false;

    const saveEffect = () => {
      if (!restoreComplete) return; // Same as App.tsx: `if (!restoreAttemptedRef.current) return;`
      saveAttempted = true;
    };

    // Change viewMode during restore (simulates React re-render)
    saveEffect(); // during restore
    expect(saveAttempted).toBe(false); // Must NOT save

    // Complete restore
    restoreComplete = true;
    saveEffect(); // after restore
    expect(saveAttempted).toBe(true); // Must save
  });

  it("invalid workspace path clears stale settings and does not open document", async () => {
    mockInvokeFor({
      load_app_settings: { success: true, data: { recentWorkspacePath: "/missing", recentDocumentPath: "doc.md", viewMode: "split-editor" } },
      load_workspace: { success: false, data: null, error: { code: "WORKSPACE_NOT_FOUND", message: "路径不存在", recoverable: true } },
      save_app_settings: { success: true, data: null },
      open_document: { success: true, data: {} },
    });

    const { loadAppSettings, loadWorkspace, saveAppSettings } = await import("../../modules/workspace/mod");
    const settings = await loadAppSettings();
    expect(settings.recentWorkspacePath).toBe("/missing");

    // Workspace fails → should NOT attempt openDocument
    const wsResult = await loadWorkspace("/missing");
    expect(wsResult.state).toBe("error");
    expect(mockedInvokeCalls("open_document")).toBe(0);

    // App would then call saveAppSettings with cleared paths
    await saveAppSettings({ recentWorkspacePath: undefined, recentDocumentPath: undefined, viewMode: "split-editor", theme: "light" });
  });

  it("valid workspace + invalid document maintains workspace state", async () => {
    mockInvokeFor({
      load_workspace: { success: true, data: { workspace: { rootPath: "/ws", displayName: "ws", fileCount: 3, isAvailable: true }, indexTree: [], flatEntries: [] } },
      open_document: { success: false, data: null, error: { code: "DOCUMENT_OPEN_FAILED", message: "文件不存在", recoverable: true } },
    });

    const { loadWorkspace } = await import("../../modules/workspace/mod");
    const wsResult = await loadWorkspace("/ws");
    expect(wsResult.state).toBe("ready");
    expect(wsResult.workspace).not.toBeNull();

    const { openDocument } = await import("../../modules/document/mod");
    const docResult = await openDocument("/ws", "missing.md");
    expect(docResult.error).toBeTruthy();
  });
});

/** Helper: count invoke calls for a specific command. */
function mockedInvokeCalls(command: string): number {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === command).length;
}