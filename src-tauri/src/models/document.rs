use serde::{Deserialize, Serialize};

/// DocumentOpenResult — Returned by open_document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenResult {
    pub path: String,
    pub relative_path: String,
    pub content: String,
    pub updated_at: String,
}

/// DocumentSaveResult — Returned by save_document / save_document_as.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveResult {
    pub path: String,
    pub updated_at: String,
    pub content_hash: String,
}