use crate::app_state::AppState;
use crate::models::document::{DocumentOpenResult, DocumentSaveResult};
use crate::models::response::CommandResponse;
use crate::modules::document::reader;
use crate::modules::document::writer;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Result of the save-dialog path picker.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickSavePathResult {
    /// One-time token bound to the picked path. The frontend must pass it
    /// back to `save_document_as` instead of a raw path; the token is consumed
    /// on use and cannot be replayed.
    pub save_token: String,
    pub absolute_path: String,
    pub relative_path: Option<String>,
    pub is_within_workspace: bool,
}

/// Open a Markdown document from the current authorised workspace.
///
/// The workspace root is read from `AppState` — the front-end no longer
/// supplies a `root_path`. File reading runs on the Tauri thread pool via
/// `spawn_blocking` so the frontend can render its opening-UI before the read
/// completes.
#[tauri::command]
pub async fn open_document(
    app: tauri::AppHandle,
    relative_path: String,
) -> CommandResponse<DocumentOpenResult> {
    let app_state: tauri::State<'_, AppState> = app.state();
    let root = match app_state.require_root() {
        Ok(p) => p,
        Err(e) => {
            return CommandResponse::error(
                "WORKSPACE_NOT_AUTHORIZED",
                &e,
                None,
                true,
            );
        }
    };

    let rel = relative_path.clone();
    let root_for_read = root.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        reader::read_markdown_file(&root_for_read, &rel)
    })
    .await;

    match result {
        Ok(Ok(doc)) => {
            log::info!("Document opened: {}", doc.relative_path);
            CommandResponse::success_with_data(DocumentOpenResult {
                path: doc.file_name,
                relative_path: doc.relative_path,
                content: doc.content,
                updated_at: doc.updated_at,
            })
        }
        Ok(Err(msg)) => {
            let detail = std::path::Path::new(&root).join(&relative_path);
            CommandResponse::error(
                "DOCUMENT_OPEN_FAILED",
                &msg,
                Some(detail.to_string_lossy().to_string()),
                true,
            )
        },
        Err(_) => {
            log::error!("Thread error opening document: {}", relative_path);
            let detail = std::path::Path::new(&root).join(&relative_path);
            CommandResponse::error(
                "DOCUMENT_OPEN_FAILED",
                "读取文档时线程异常",
                Some(detail.to_string_lossy().to_string()),
                true,
            )
        },
    }
}

/// Save content to an existing Markdown document (overwrite).
///
/// The workspace root is read from `AppState` — the front-end no longer
/// supplies a `root_path`.
#[tauri::command]
pub fn save_document(
    app: tauri::AppHandle,
    relative_path: String,
    content: String,
) -> CommandResponse<DocumentSaveResult> {
    let app_state: tauri::State<'_, AppState> = app.state();
    let root = match app_state.require_root() {
        Ok(p) => p,
        Err(e) => {
            return CommandResponse::error(
                "WORKSPACE_NOT_AUTHORIZED",
                &e,
                None,
                true,
            );
        }
    };

    match writer::write_markdown_file(&root, &relative_path, &content) {
        Ok(result) => {
            log::info!("Document saved: {}", relative_path);
            CommandResponse::success_with_data(DocumentSaveResult {
                path: result.path,
                updated_at: result.updated_at,
                content_hash: result.content_hash,
            })
        }
        Err(msg) => {
            let detail = std::path::Path::new(&root).join(&relative_path);
            CommandResponse::error(
                "DOCUMENT_SAVE_FAILED",
                &msg,
                Some(detail.to_string_lossy().to_string()),
                true,
            )
        },
    }
}

/// Open system save-dialog, let the user pick a path, and return the path info.
/// The frontend then calls save_document_as with the result.
///
/// The workspace root is read from `AppState` to determine whether the picked
/// path falls within the authorised workspace.
#[tauri::command]
pub fn pick_save_path(
    app: tauri::AppHandle,
    default_name: String,
) -> CommandResponse<PickSavePathResult> {
    let app_state: tauri::State<'_, AppState> = app.state();
    let root = match app_state.require_root() {
        Ok(p) => p,
        Err(e) => {
            return CommandResponse::error(
                "WORKSPACE_NOT_AUTHORIZED",
                &e,
                None,
                true,
            );
        }
    };

    let file = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(&default_name)
        .blocking_save_file();

    let file_path = match file {
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
            log::debug!("Save dialog cancelled by user");
            return CommandResponse::error("CANCELLED", "用户取消了保存", None, true);
        }
    };

    // Ensure .md extension
    let path = if file_path.extension().is_none() {
        file_path.with_extension("md")
    } else {
        file_path
    };

    // Determine if the path is within the workspace
    let root_path_obj = std::path::Path::new(&root);
    let is_within = path.starts_with(root_path_obj);
    let relative = if is_within {
        path.strip_prefix(root_path_obj).ok().map(|p| p.to_string_lossy().to_string())
    } else {
        None
    };

    let absolute_path = path.to_string_lossy().to_string();

    // Issue a one-time token bound to the picked path. The frontend does not
    // receive the binding directly; it must pass the token back to
    // `save_document_as`, which consumes it and reads the bound path from
    // AppState. This stops a compromised webview from supplying an arbitrary
    // `target_path` it never picked via the native dialog.
    let save_token = match app_state.issue_save_token(&absolute_path) {
        Ok(t) => t,
        Err(e) => {
            return CommandResponse::error(
                "SAVE_TOKEN_ISSUE_FAILED",
                &e,
                None,
                true,
            );
        }
    };

    CommandResponse::success_with_data(PickSavePathResult {
        save_token,
        absolute_path,
        relative_path: relative,
        is_within_workspace: is_within,
    })
}

/// Save content to a target path chosen by the system save-as dialog
/// (supports both internal and external paths).
///
/// The target path is no longer supplied by the front-end. Instead the
/// front-end passes back the one-time `save_token` returned by
/// `pick_save_path`; the token is consumed here and the bound path is read
/// from `AppState`. This means a compromised webview cannot forge a
/// `target_path` it never picked through the native dialog, and a token is
/// single-use: once consumed, it is no longer valid.
///
/// The workspace root is read from `AppState` — the front-end never supplies
/// a `root_path`.
#[tauri::command]
pub fn save_document_as(
    app: tauri::AppHandle,
    save_token: String,
    content: String,
) -> CommandResponse<DocumentSaveResult> {
    let app_state: tauri::State<'_, AppState> = app.state();
    let root = match app_state.require_root() {
        Ok(p) => p,
        Err(e) => {
            return CommandResponse::error(
                "WORKSPACE_NOT_AUTHORIZED",
                &e,
                None,
                true,
            );
        }
    };

    // Consume the one-time token to recover the picker-chosen target path.
    // On failure the token remains spent (consume is take()-based) only when
    // the token matched; a mismatch leaves the pending slot cleared, so a
    // failed replay cannot be retried with the same token.
    let target_path = match app_state.consume_save_token(&save_token) {
        Ok(p) => p,
        Err(e) => {
            return CommandResponse::error(
                "SAVE_TOKEN_INVALID",
                &e,
                None,
                true,
            );
        }
    };

    match writer::write_to_any_path(&root, &target_path, &content) {
        Ok(result) => {
            log::info!("Document saved as: {}", target_path);
            CommandResponse::success_with_data(DocumentSaveResult {
                path: result.path,
                updated_at: result.updated_at,
                content_hash: result.content_hash,
            })
        }
        Err(msg) => CommandResponse::error(
            "DOCUMENT_SAVE_FAILED",
            &msg,
            Some(target_path),
            true,
        ),
    }
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_document_success_shape() {
        let resp = CommandResponse::success_with_data(DocumentOpenResult {
            path: "test.md".into(),
            relative_path: "test.md".into(),
            content: "# Hello".into(),
            updated_at: "1234567890".into(),
        });
        assert!(resp.success);
    }

    #[test]
    fn test_open_document_error_shape() {
        let resp: CommandResponse<DocumentOpenResult> =
            CommandResponse::error("DOCUMENT_OPEN_FAILED", "文件不存在", None, true);
        assert!(!resp.success);
        let err = resp.error.unwrap();
        assert_eq!(err.code, "DOCUMENT_OPEN_FAILED");
    }

    #[test]
    fn test_save_document_success_shape() {
        let resp = CommandResponse::success_with_data(DocumentSaveResult {
            path: "test.md".into(),
            updated_at: "1234567890".into(),
            content_hash: "abc123".into(),
        });
        assert!(resp.success);
    }

    #[test]
    fn test_save_document_error_shape() {
        let resp: CommandResponse<DocumentSaveResult> =
            CommandResponse::error("DOCUMENT_SAVE_FAILED", "权限不足", None, true);
        assert!(!resp.success);
        let err = resp.error.unwrap();
        assert_eq!(err.code, "DOCUMENT_SAVE_FAILED");
    }

    #[test]
    fn test_save_document_as_success_shape() {
        let resp = CommandResponse::success_with_data(DocumentSaveResult {
            path: "/tmp/new.md".into(),
            updated_at: "1234567890".into(),
            content_hash: "def456".into(),
        });
        assert!(resp.success);
    }

    #[test]
    fn test_save_document_as_error_shape() {
        let resp: CommandResponse<DocumentSaveResult> =
            CommandResponse::error("DOCUMENT_SAVE_FAILED", "不支持的文件类型", None, true);
        assert!(!resp.success);
        assert!(resp.error.is_some());
    }

    #[test]
    fn test_pick_save_path_result_shape() {
        let resp = CommandResponse::success_with_data(PickSavePathResult {
            save_token: "abc123".into(),
            absolute_path: "/tmp/test.md".into(),
            relative_path: Some("test.md".into()),
            is_within_workspace: true,
        });
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert!(!data.save_token.is_empty());
        assert!(data.relative_path.is_some());
        assert!(data.is_within_workspace);
    }
}