use crate::models::response::CommandResponse;
use crate::models::workspace::{IndexEntry, WorkspaceInfo, WorkspaceLoadResult};
use crate::modules::workspace::indexer;
use crate::modules::workspace::scanner;
use crate::modules::workspace::watcher;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Internal scan result passed between spawn_blocking and the async caller.
struct ScanResult {
    flat_entries: Vec<IndexEntry>,
    file_count: u64,
    root_path: String,
    display_name: String,
}

/// Normalise OS-native path separators to forward slashes.
/// On Windows `PathBuf::to_string_lossy` yields `\`, but the rest of the
/// codebase (indexer, front-end) assumes `/`.  This function is applied
/// at the boundary where `PathBuf` is stringified into `IndexEntry` fields.
fn normalize_sep(p: &str) -> String {
    p.replace('\\', "/")
}

/// Run the full scan + index-build for a given path.
/// Called inside `spawn_blocking` (thread pool, not main thread).
fn run_scan(root_path: &str) -> Result<ScanResult, String> {
    let folder_path = std::path::Path::new(root_path);

    if !folder_path.exists() {
        return Err("所选路径不存在".to_string());
    }
    if !folder_path.is_dir() {
        return Err("所选路径不是文件夹".to_string());
    }

    let scanned = scanner::scan_markdown_files(folder_path);
    let file_count = scanned.len() as u64;

    let flat_entries: Vec<IndexEntry> = scanned
        .into_iter()
        .map(|(abs, rel)| {
            let name = abs
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let parent = rel
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = abs
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_else(|| "md".to_string());

            let (updated_at, size) = match abs.metadata() {
                Ok(meta) => (
                    meta.modified()
                        .ok()
                        .map(|t| {
                            t.duration_since(std::time::UNIX_EPOCH)
                                .ok()
                                .map(|d| d.as_secs().to_string())
                                .unwrap_or_default()
                        }),
                    Some(meta.len()),
                ),
                Err(_) => (None, None),
            };

            IndexEntry {
                id: normalize_sep(&rel.to_string_lossy()),
                name,
                absolute_path: abs.to_string_lossy().to_string(),
                relative_path: normalize_sep(&rel.to_string_lossy()),
                parent_relative_path: normalize_sep(&parent),
                extension: ext,
                updated_at,
                size,
            }
        })
        .collect();

    let display_name = folder_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| folder_path.to_string_lossy().to_string());

    Ok(ScanResult {
        flat_entries,
        file_count,
        root_path: root_path.to_string(),
        display_name,
    })
}

/// Build a full `WorkspaceLoadResult` from a `ScanResult`.
fn build_workspace_result(scan: ScanResult) -> WorkspaceLoadResult {
    let index_tree = indexer::build_index_tree(&scan.flat_entries);

    let workspace = WorkspaceInfo {
        root_path: scan.root_path,
        display_name: scan.display_name,
        is_available: true,
        file_count: scan.file_count,
        last_indexed_at: Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs().to_string())
                .unwrap_or_default(),
        ),
    };

    WorkspaceLoadResult {
        workspace,
        index_tree,
        flat_entries: scan.flat_entries,
        restored_document_path: None,
    }
}

/// Select a workspace folder via system dialog, scan it for Markdown files,
/// and return the workspace info together with a flat index entry list.
///
/// The folder dialog runs synchronously on the main thread (required by macOS),
/// but the scanning & index-building runs on the Tauri thread pool via
/// `spawn_blocking` so the webview stays responsive during scanning.
///
/// On success, automatically starts the file-system watcher for this workspace.
#[tauri::command]
pub async fn select_workspace(app: tauri::AppHandle) -> CommandResponse<WorkspaceLoadResult> {
    // ── Step 1: Open system folder picker (sync, main thread) ──
    let folder = app.dialog().file().blocking_pick_folder();

    let folder_path = match folder {
        Some(f) => match f.as_path() {
            Some(p) => p.to_path_buf(),
            None => {
                return CommandResponse::error(
                    "INVALID_PATH",
                    "选择的路径格式无效",
                    None,
                    true,
                );
            }
        },
        None => {
            return CommandResponse::error(
                "CANCELLED",
                "用户取消了工作区选择",
                None,
                true,
            );
        }
    };

    let root_path = folder_path.to_string_lossy().to_string();

    // ── Step 2: Validate path (fast, sync) ────────────────────
    if !folder_path.exists() {
        return CommandResponse::error(
            "WORKSPACE_NOT_FOUND",
            "所选路径不存在",
            Some(root_path),
            true,
        );
    }
    if !folder_path.is_dir() {
        return CommandResponse::error(
            "INVALID_PATH",
            "所选路径不是文件夹",
            Some(root_path),
            true,
        );
    }

    // ── Step 3: Scan + index (async, thread pool) ─────────────
    let scan_path = root_path.clone();
    let scan_result = tauri::async_runtime::spawn_blocking(move || {
        run_scan(&scan_path)
    })
    .await;

    let scan = match scan_result {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return CommandResponse::error("SCAN_FAILED", &e, Some(root_path), true);
        }
        Err(_) => {
            return CommandResponse::error(
                "SCAN_FAILED",
                "扫描线程异常",
                Some(root_path),
                true,
            );
        }
    };

    let result = build_workspace_result(scan);

    // ── Step 4: Auto-start watcher (after scan, on main executor) ──
    start_watcher_for_workspace(&result.workspace.root_path, &app);

    CommandResponse::success_with_data(result)
}

/// Refresh the workspace index without opening a dialog.
///
/// Runs the scan + index-build on the Tauri thread pool so the webview
/// stays responsive during scanning.
#[tauri::command]
pub async fn refresh_workspace_index(root_path: String) -> CommandResponse<WorkspaceLoadResult> {
    let scan_path = root_path.clone();
    let scan_result = tauri::async_runtime::spawn_blocking(move || {
        run_scan(&scan_path)
    })
    .await;

    let scan = match scan_result {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return CommandResponse::error(
                "WORKSPACE_NOT_FOUND",
                &e,
                Some(root_path),
                true,
            );
        }
        Err(_) => {
            return CommandResponse::error(
                "SCAN_FAILED",
                "扫描线程异常",
                Some(root_path),
                true,
            );
        }
    };

    let result = build_workspace_result(scan);
    CommandResponse::success_with_data(result)
}

/// Load a workspace by path (no dialog). Used for startup recovery.
///
/// On success, automatically starts the file-system watcher for this workspace.
#[tauri::command]
pub async fn load_workspace(
    app: tauri::AppHandle,
    root_path: String,
) -> CommandResponse<WorkspaceLoadResult> {
    let scan_path = root_path.clone();
    let scan_result = tauri::async_runtime::spawn_blocking(move || {
        run_scan(&scan_path)
    })
    .await;

    let scan = match scan_result {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return CommandResponse::error(
                "WORKSPACE_NOT_FOUND",
                &e,
                Some(root_path),
                true,
            );
        }
        Err(_) => {
            return CommandResponse::error(
                "SCAN_FAILED",
                "扫描线程异常",
                Some(root_path),
                true,
            );
        }
    };

    let result = build_workspace_result(scan);

    // ── Auto-start watcher (after scan, on main executor) ─────
    start_watcher_for_workspace(&result.workspace.root_path, &app);

    CommandResponse::success_with_data(result)
}

/// Start the file-system watcher for the given workspace root path.
///
/// Stops any previously-running watcher first. Failure to start is non-fatal:
/// the workspace continues to work with manual refresh only.
fn start_watcher_for_workspace(root_path: &str, app: &tauri::AppHandle) {
    let state: tauri::State<'_, Mutex<watcher::WatcherState>> = app.state();

    // Stop old watcher first
    watcher::stop_watcher(&state);

    // Start new watcher
    match watcher::start_watcher(root_path, app.clone()) {
        Ok(w) => {
            if let Ok(mut guard) = state.lock() {
                guard.watcher = Some(w);
            }
        }
        Err(e) => {
            eprintln!("[RuT0MarkFlow] watcher 启动失败（降级为手动刷新）: {}", e);
        }
    }
}

/// Manually start the workspace watcher for the current workspace.
#[tauri::command]
pub fn start_workspace_watcher(
    app: tauri::AppHandle,
    root_path: String,
) -> CommandResponse<String> {
    let state: tauri::State<'_, Mutex<watcher::WatcherState>> = app.state();

    watcher::stop_watcher(&state);

    match watcher::start_watcher(&root_path, app.clone()) {
        Ok(w) => {
            if let Ok(mut guard) = state.lock() {
                guard.watcher = Some(w);
            }
            CommandResponse::success_with_data("watcher 已启动".to_string())
        }
        Err(e) => CommandResponse::error(
            "WATCHER_START_FAILED",
            &format!("watcher 启动失败: {}", e),
            None,
            true,
        ),
    }
}

/// Manually stop the workspace watcher.
#[tauri::command]
pub fn stop_workspace_watcher(app: tauri::AppHandle) -> CommandResponse<String> {
    let state: tauri::State<'_, Mutex<watcher::WatcherState>> = app.state();
    watcher::stop_watcher(&state);
    CommandResponse::success_with_data("watcher 已停止".to_string())
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::response::CommandResponse;

    fn make_fake_success() -> CommandResponse<WorkspaceLoadResult> {
        let workspace = WorkspaceInfo {
            root_path: "/tmp/test".into(),
            display_name: "test".into(),
            is_available: true,
            file_count: 5,
            last_indexed_at: Some("1234567890".into()),
        };

        CommandResponse::success_with_data(WorkspaceLoadResult {
            workspace,
            index_tree: vec![],
            flat_entries: vec![],
            restored_document_path: None,
        })
    }

    #[test]
    fn test_success_response_has_correct_shape() {
        let resp = make_fake_success();
        assert!(resp.success);
        assert!(resp.data.is_some());
        assert!(resp.error.is_none());

        let data = resp.data.unwrap();
        assert_eq!(data.workspace.display_name, "test");
        assert_eq!(data.workspace.file_count, 5);
        assert!(data.index_tree.is_empty());
        assert!(data.flat_entries.is_empty());
        assert!(data.restored_document_path.is_none());
    }

    #[test]
    fn test_error_response_has_correct_shape() {
        let resp: CommandResponse<WorkspaceLoadResult> = CommandResponse::error(
            "CANCELLED",
            "用户取消",
            None,
            true,
        );
        assert!(!resp.success);
        assert!(resp.data.is_none());
        assert!(resp.error.is_some());

        let err = resp.error.unwrap();
        assert_eq!(err.code, "CANCELLED");
        assert!(err.recoverable);
    }

    #[test]
    fn test_run_scan_nonexistent_path() {
        let result = run_scan("/tmp/rut0markflow_test_nonexistent_xyz789");
        assert!(result.is_err());
    }
}