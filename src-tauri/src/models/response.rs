use serde::{Deserialize, Serialize};

use crate::modules::errors::app_error::AppErrorPayload;

/// CommandResponse<T> — Unified response wrapper for all Tauri commands.
///
/// Every command returns this structure so the frontend has a consistent
/// contract for handling success and failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResponse<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<AppErrorPayload>,
}

impl<T: Serialize> CommandResponse<T> {
    /// Creates a successful response with data.
    pub fn success_with_data(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    /// Creates an error response.
    pub fn error(code: &str, message: &str, detail: Option<String>, recoverable: bool) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(AppErrorPayload {
                code: code.to_string(),
                message: message.to_string(),
                detail,
                recoverable,
            }),
        }
    }
}