use crate::models::document::{DocumentOpenResult, DocumentSaveResult};
use crate::models::response::CommandResponse;
use crate::modules::document::reader;
use crate::modules::document::writer;
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;

/// Result of the save-dialog path picker.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickSavePathResult {
    pub absolute_path: String,
    pub relative_path: Option<String>,
    pub is_within_workspace: bool,
}

/// Open a Markdown document from the current workspace.
///
/// File reading runs on the Tauri thread pool via `spawn_blocking` so the
/// frontend can render its opening-UI before the read completes.
#[tauri::command]
pub async fn open_document(
    root_path: String,
    relative_path: String,
) -> CommandResponse<DocumentOpenResult> {
    let root = root_path.clone();
    let rel = relative_path.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        reader::read_markdown_file(&root, &rel)
    })
    .await;

    match result {
        Ok(Ok(doc)) => CommandResponse::success_with_data(DocumentOpenResult {
            path: doc.file_name,
            relative_path: doc.relative_path,
            content: doc.content,
            updated_at: doc.updated_at,
        }),
        Ok(Err(msg)) => CommandResponse::error(
            "DOCUMENT_OPEN_FAILED",
            &msg,
            Some(format!("{}/{}", root_path, relative_path)),
            true,
        ),
        Err(_) => CommandResponse::error(
            "DOCUMENT_OPEN_FAILED",
            "读取文档时线程异常",
            Some(format!("{}/{}", root_path, relative_path)),
            true,
        ),
    }
}

/// Save content to an existing Markdown document (overwrite).
#[tauri::command]
pub fn save_document(
    root_path: String,
    relative_path: String,
    content: String,
) -> CommandResponse<DocumentSaveResult> {
    match writer::write_markdown_file(&root_path, &relative_path, &content) {
        Ok(result) => CommandResponse::success_with_data(DocumentSaveResult {
            path: result.path,
            updated_at: result.updated_at,
            content_hash: result.content_hash,
        }),
        Err(msg) => CommandResponse::error(
            "DOCUMENT_SAVE_FAILED",
            &msg,
            Some(format!("{}/{}", root_path, relative_path)),
            true,
        ),
    }
}

/// Open system save-dialog, let the user pick a path, and return the path info.
/// The frontend then calls save_document_as with the result.
#[tauri::command]
pub fn pick_save_path(
    app: tauri::AppHandle,
    root_path: String,
    default_name: String,
) -> CommandResponse<PickSavePathResult> {
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
    let root = std::path::Path::new(&root_path);
    let is_within = path.starts_with(root);
    let relative = if is_within {
        path.strip_prefix(root).ok().map(|p| p.to_string_lossy().to_string())
    } else {
        None
    };

    CommandResponse::success_with_data(PickSavePathResult {
        absolute_path: path.to_string_lossy().to_string(),
        relative_path: relative,
        is_within_workspace: is_within,
    })
}

/// Save content to a target path (supports both internal and external paths).
#[tauri::command]
pub fn save_document_as(
    root_path: String,
    target_path: String,
    content: String,
) -> CommandResponse<DocumentSaveResult> {
    match writer::write_to_any_path(&root_path, &target_path, &content) {
        Ok(result) => CommandResponse::success_with_data(DocumentSaveResult {
            path: result.path,
            updated_at: result.updated_at,
            content_hash: result.content_hash,
        }),
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
            absolute_path: "/tmp/test.md".into(),
            relative_path: Some("test.md".into()),
            is_within_workspace: true,
        });
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert!(data.relative_path.is_some());
        assert!(data.is_within_workspace);
    }
}