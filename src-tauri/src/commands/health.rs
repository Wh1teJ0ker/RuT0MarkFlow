use crate::models::response::CommandResponse;

/// Health check command — verifies the Rust backend is alive and responsive.
///
/// This is the first Tauri command to wire up; it allows the frontend to
/// confirm the Tauri bridge is working end-to-end.
///
/// Returns the backend version string on success.
///
/// TODO: Add more detailed health info (uptime, loaded workspace count, etc.)
#[tauri::command]
pub fn health_check() -> CommandResponse<String> {
    CommandResponse::success_with_data("RuT0MarkFlow backend v0.1.0 (Tauri 2 / Rust)".to_string())
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check_returns_success() {
        let response = health_check();
        assert!(response.success);
        assert!(response.data.is_some());
        assert!(response.error.is_none());

        let version = response.data.unwrap();
        assert!(version.contains("v0.1.0"));
    }

    #[test]
    fn test_health_check_contains_tauri_and_rust() {
        let response = health_check();
        let version = response.data.unwrap();
        assert!(version.contains("Tauri"));
        assert!(version.contains("Rust"));
    }
}