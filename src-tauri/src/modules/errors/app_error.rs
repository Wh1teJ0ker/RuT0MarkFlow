use serde::{Deserialize, Serialize};

/// AppErrorPayload — Structured error information returned in CommandResponse.
///
/// Mirrors the frontend `AppErrorPayload` TypeScript interface.
///
/// Fields:
///  - `code`: Machine-readable error identifier (e.g. "WORKSPACE_NOT_FOUND")
///  - `message`: Human-readable error description in Chinese or English
///  - `detail`: Optional additional context (file path, OS error, etc.)
///  - `recoverable`: Whether the user can retry or recover without restarting
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorPayload {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
    pub recoverable: bool,
}

impl AppErrorPayload {
    /// Convenience constructor for common errors.
    pub fn new(code: &str, message: &str, recoverable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            detail: None,
            recoverable,
        }
    }

    /// Adds detail to an existing error payload.
    pub fn with_detail(mut self, detail: String) -> Self {
        self.detail = Some(detail);
        self
    }
}

// ── Predefined error codes ──────────────────────────────────────

pub const ERR_WORKSPACE_NOT_FOUND: &str = "WORKSPACE_NOT_FOUND";
pub const ERR_WORKSPACE_INACCESSIBLE: &str = "WORKSPACE_INACCESSIBLE";
pub const ERR_FILE_NOT_FOUND: &str = "FILE_NOT_FOUND";
pub const ERR_FILE_READ_FAILED: &str = "FILE_READ_FAILED";
pub const ERR_FILE_WRITE_FAILED: &str = "FILE_WRITE_FAILED";
pub const ERR_INDEX_BUILD_FAILED: &str = "INDEX_BUILD_FAILED";
pub const ERR_INTERNAL: &str = "INTERNAL_ERROR";