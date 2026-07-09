use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub release_tag: String,
    pub app_version: String,
    pub frontend_version: String,
    pub backend_version: String,
    pub workspace_schema_version: String,
    pub tauri_version: String,
}
