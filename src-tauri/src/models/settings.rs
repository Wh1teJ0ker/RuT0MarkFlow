use serde::{Deserialize, Serialize};

/// Lightweight persisted application settings.
///
/// Only the fields required for startup recovery and persistent preferences:
/// - `recentWorkspacePath`: last successfully loaded workspace root
/// - `recentDocumentPath`: relative path of the last opened document
/// - `viewMode`: last used view mode (defaults to split-editor)
/// - `theme`: last used color theme (defaults to "light")
///
/// All fields are optional to tolerate missing/corrupt data on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub recent_workspace_path: Option<String>,
    pub recent_document_path: Option<String>,
    pub view_mode: String,
    pub theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            recent_workspace_path: None,
            recent_document_path: None,
            view_mode: "split-editor".to_string(),
            theme: "light".to_string(),
        }
    }
}