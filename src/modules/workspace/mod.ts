import { invokeTauriCommand } from "../../services/tauri";
import type {
  WorkspaceState,
  WorkspaceInfo,
  WorkspaceLoadResult,
  IndexTreeNode,
  AppErrorPayload,
  AppSettings,
} from "../../types";

/**
 * Result of a workspace selection attempt.
 */
export interface WorkspaceSelectionResult {
  state: WorkspaceState;
  workspace: WorkspaceInfo | null;
  error: AppErrorPayload | null;
  fileCount: number;
  indexTree: IndexTreeNode[];
}

/**
 * Invoke the `select_workspace` Tauri command.
 */
export async function selectWorkspace(): Promise<WorkspaceSelectionResult> {
  const result = await invokeTauriCommand<WorkspaceLoadResult>(
    "select_workspace",
    undefined,
    {
      domain: "workspace",
      operation: "select-workspace",
      fallbackMessage: "暂时无法加载工作区",
      recoveryAction: "reselect-workspace",
      recoverable: true,
    },
  );

  if (result.success && result.data) {
    return {
      state: "ready",
      workspace: result.data.workspace,
      error: null,
      fileCount: result.data.workspace.fileCount,
      indexTree: result.data.indexTree ?? [],
    };
  }

  if (result.error?.code === "CANCELLED") {
    return {
      state: "idle",
      workspace: null,
      error: null,
      fileCount: 0,
      indexTree: [],
    };
  }

  return {
    state: "error",
    workspace: null,
    error: result.error,
    fileCount: 0,
    indexTree: [],
  };
}

/**
 * Load a workspace by path (no dialog). Used for startup recovery.
 */
export async function loadWorkspace(
  rootPath: string,
): Promise<WorkspaceSelectionResult> {
  const result = await invokeTauriCommand<WorkspaceLoadResult>(
    "load_workspace",
    { rootPath },
    {
      domain: "workspace",
      operation: "load-workspace",
      fallbackMessage: "暂时无法加载工作区",
      recoveryAction: "reselect-workspace",
      recoverable: true,
    },
  );

  if (result.success && result.data) {
    return {
      state: "ready",
      workspace: result.data.workspace,
      error: null,
      fileCount: result.data.workspace?.fileCount ?? 0,
      indexTree: result.data.indexTree ?? [],
    };
  }

  return {
    state: "error",
    workspace: null,
    error: result.error,
    fileCount: 0,
    indexTree: [],
  };
}

/**
 * Refresh the workspace index (re-scan + re-build tree) without a dialog.
 */
export async function refreshWorkspaceIndex(
  rootPath: string,
): Promise<WorkspaceSelectionResult> {
  const result = await invokeTauriCommand<WorkspaceLoadResult>(
    "refresh_workspace_index",
    { rootPath },
    {
      domain: "workspace",
      operation: "refresh-workspace",
      fallbackMessage: "暂时无法刷新工作区索引",
      recoveryAction: "none",
      recoverable: true,
    },
  );

  if (result.success && result.data) {
    return {
      state: "ready",
      workspace: result.data.workspace,
      error: null,
      fileCount: result.data.workspace.fileCount,
      indexTree: result.data.indexTree ?? [],
    };
  }

  return {
    state: "error",
    workspace: null,
    error: result.error,
    fileCount: 0,
    indexTree: [],
  };
}

// ── Watcher commands ──────────────────────────────────────────────

/**
 * Start the file-system watcher for the given workspace root path.
 * The watcher monitors .md/.markdown file changes and emits
 * "workspace://index-changed" events after a debounce period.
 */
export async function startWorkspaceWatcher(rootPath: string): Promise<boolean> {
  const result = await invokeTauriCommand<string>(
    "start_workspace_watcher",
    { rootPath },
  );
  return result.success;
}

/**
 * Stop the currently-running workspace watcher.
 */
export async function stopWorkspaceWatcher(): Promise<boolean> {
  const result = await invokeTauriCommand<string>(
    "stop_workspace_watcher",
  );
  return result.success;
}

// ── Settings persistence ─────────────────────────────────────────

export async function loadAppSettings(): Promise<AppSettings> {
  const result = await invokeTauriCommand<AppSettings>("load_app_settings");
  if (result.success && result.data) {
    return result.data;
  }
  // Default fallback
  return {
    viewMode: "split-editor",
    theme: "light",
  };
}

export async function saveAppSettings(
  settings: AppSettings,
): Promise<void> {
  await invokeTauriCommand<null>("save_app_settings", {
    settings,
  });
  // Silently ignore errors
}
