import { invokeTauriCommand } from "../../services/tauri";
import { logger } from "../../services/logger";
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
 *
 * `cancelled` is true when the user dismissed the native folder picker
 * without choosing a directory. In that case the caller should preserve
 * the existing workspace/document context instead of clearing it.
 */
export interface WorkspaceSelectionResult {
  state: WorkspaceState;
  workspace: WorkspaceInfo | null;
  error: AppErrorPayload | null;
  fileCount: number;
  indexTree: IndexTreeNode[];
  cancelled: boolean;
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
      cancelled: false,
    };
  }

  if (result.error?.code === "CANCELLED") {
    // User dismissed the picker: signal cancellation so the caller can keep
    // the existing workspace/document context instead of clearing it.
    return {
      state: "idle",
      workspace: null,
      error: null,
      fileCount: 0,
      indexTree: [],
      cancelled: true,
    };
  }

  return {
    state: "error",
    workspace: null,
    error: result.error,
    fileCount: 0,
    indexTree: [],
    cancelled: false,
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
      cancelled: false,
    };
  }

  return {
    state: "error",
    workspace: null,
    error: result.error,
    fileCount: 0,
    indexTree: [],
    cancelled: false,
  };
}

/**
 * Refresh the workspace index (re-scan + re-build tree) without a dialog.
 *
 * The workspace root is read from the Rust-side AppState; the front-end no
 * longer supplies a `rootPath`.
 */
export async function refreshWorkspaceIndex(): Promise<WorkspaceSelectionResult> {
  const result = await invokeTauriCommand<WorkspaceLoadResult>(
    "refresh_workspace_index",
    undefined,
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
      cancelled: false,
    };
  }

  return {
    state: "error",
    workspace: null,
    error: result.error,
    fileCount: 0,
    indexTree: [],
    cancelled: false,
  };
}

// ── Watcher commands ──────────────────────────────────────────────

/**
 * Start the file-system watcher for the current authorised workspace.
 *
 * The workspace root is read from the Rust-side AppState; the front-end no
 * longer supplies a `rootPath`. The watcher monitors .md/.markdown file
 * changes and emits "workspace://index-changed" events after a debounce
 * period.
 */
export async function startWorkspaceWatcher(): Promise<boolean> {
  const result = await invokeTauriCommand<string>(
    "start_workspace_watcher",
  );
  if (!result.success) {
    logger.warn("Failed to start workspace watcher", { code: result.error?.code, message: result.error?.message });
  }
  return result.success;
}

/**
 * Stop the currently-running workspace watcher.
 */
export async function stopWorkspaceWatcher(): Promise<boolean> {
  const result = await invokeTauriCommand<string>(
    "stop_workspace_watcher",
  );
  if (!result.success) {
    logger.warn("Failed to stop workspace watcher", { code: result.error?.code, message: result.error?.message });
  }
  return result.success;
}

// ── Settings persistence ─────────────────────────────────────────

export async function loadAppSettings(): Promise<AppSettings> {
  const result = await invokeTauriCommand<AppSettings>("load_app_settings");
  if (result.success && result.data) {
    return result.data;
  }
  logger.warn("Failed to load app settings, using defaults", { code: result.error?.code, message: result.error?.message });
  // Default fallback
  return {
    viewMode: "split-editor",
    theme: "light",
  };
}

export async function saveAppSettings(
  settings: AppSettings,
): Promise<void> {
  const result = await invokeTauriCommand<null>("save_app_settings", {
    settings,
  });
  if (!result.success) {
    logger.warn("Failed to save app settings", { code: result.error?.code, message: result.error?.message });
  }
  // Silently ignore errors
}
