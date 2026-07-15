use crate::models::response::CommandResponse;
use crate::models::version::VersionInfo;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionManifest {
    app_version: String,
    frontend_version: String,
    backend_version: String,
    workspace_schema_version: String,
}

fn load_version_manifest() -> VersionManifest {
    match serde_json::from_str(include_str!("../../../version-manifest.json")) {
        Ok(m) => m,
        Err(e) => {
            log::error!("version-manifest.json parse failed: {}, using fallback", e);
            VersionManifest {
                app_version: "0.1.0".to_string(),
                frontend_version: "0.1.0".to_string(),
                backend_version: "0.1.0".to_string(),
                workspace_schema_version: "1.0.0".to_string(),
            }
        }
    }
}

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
    let versions = load_version_manifest();
    CommandResponse::success_with_data(format!(
        "RuT0MarkFlow backend v{} (app v{}, Tauri {}, workspace schema v{})",
        versions.backend_version,
        versions.app_version,
        tauri::VERSION,
        versions.workspace_schema_version,
    ))
}

#[tauri::command]
pub fn version_info() -> CommandResponse<VersionInfo> {
    let versions = load_version_manifest();

    CommandResponse::success_with_data(VersionInfo {
        release_tag: format!("v{}", versions.app_version),
        app_version: versions.app_version,
        frontend_version: versions.frontend_version,
        backend_version: versions.backend_version,
        workspace_schema_version: versions.workspace_schema_version,
        tauri_version: tauri::VERSION.to_string(),
    })
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

        let VersionManifest { app_version, .. } = load_version_manifest();
        let version = response.data.unwrap();
        assert!(version.contains(&format!("app v{}", app_version)));
    }

    #[test]
    fn test_health_check_contains_tauri_and_schema_version() {
        let response = health_check();
        let version = response.data.unwrap();
        assert!(version.contains("Tauri"));
        assert!(version.contains("workspace schema"));
    }

    #[test]
    fn test_version_info_returns_component_versions() {
        let response = version_info();
        assert!(response.success);
        assert!(response.error.is_none());

        let VersionManifest {
            app_version,
            frontend_version,
            backend_version,
            workspace_schema_version,
        } = load_version_manifest();
        let version_info = response.data.unwrap();
        assert_eq!(version_info.release_tag, format!("v{}", app_version));
        assert_eq!(version_info.app_version, app_version);
        assert_eq!(version_info.frontend_version, frontend_version);
        assert_eq!(version_info.backend_version, backend_version);
        assert_eq!(version_info.workspace_schema_version, workspace_schema_version);
        assert!(!version_info.tauri_version.is_empty());
    }
}
