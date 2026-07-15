use crate::models::response::CommandResponse;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// Result of a check-for-updates call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Result of an install-update call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallResult {
    pub success: bool,
    pub restarted: bool,
}

/// Check for updates via the Tauri updater plugin.
///
/// Returns whether an update is available, along with version info.
/// Errors are returned as structured error responses (domain: system, operation: check-update).
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> CommandResponse<UpdateCheckResult> {
    log::info!("Checking for updates...");
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("Update check failed: {}", e);
            return CommandResponse::error(
                "UPDATE_CHECK_FAILED",
                &format!("更新检查器初始化失败: {}", e),
                None,
                true,
            );
        }
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            log::info!("No update available");
            return CommandResponse::success_with_data(UpdateCheckResult {
                available: false,
                version: None,
                notes: None,
                date: None,
            });
        }
        Err(e) => {
            log::warn!("Update check failed: {}", e);
            return CommandResponse::error(
                "UPDATE_CHECK_FAILED",
                &format!("检查更新失败: {}", e),
                None,
                true,
            );
        }
    };

    log::info!("Update available: version {}", update.version);
    CommandResponse::success_with_data(UpdateCheckResult {
        available: true,
        version: Some(update.version.clone()),
        notes: Some(update.body.clone().unwrap_or_default()),
        date: Some(update.date.map(|d| d.to_string()).unwrap_or_default()),
    })
}

/// Download and install the available update.
///
/// After download, the updater handles the installation and app restart.
/// Returns whether the process was initiated successfully.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> CommandResponse<UpdateInstallResult> {
    log::info!("Installing update...");
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("Update check failed: {}", e);
            return CommandResponse::error(
                "UPDATE_INSTALL_FAILED",
                &format!("更新检查器初始化失败: {}", e),
                None,
                true,
            );
        }
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return CommandResponse::error(
                "UPDATE_INSTALL_FAILED",
                "没有可用更新",
                None,
                false,
            );
        }
        Err(e) => {
            log::warn!("Update check failed: {}", e);
            return CommandResponse::error(
                "UPDATE_INSTALL_FAILED",
                &format!("检查更新失败: {}", e),
                None,
                true,
            );
        }
    };

    // No-op progress callbacks — we don't need to report download progress to the user
    // for the MVP. The update downloads silently in the background.
    let on_chunk = |downloaded: usize, total: Option<u64>| {
        log::debug!("Update download progress: {} / {:?}", downloaded, total);
    };
    let on_done = || {};

    match update.download_and_install(on_chunk, on_done).await {
        Ok(_) => {
            log::info!("Update installed, restarting");
            CommandResponse::success_with_data(UpdateInstallResult {
                success: true,
                restarted: true,
            })
        }
        Err(e) => {
            log::error!("Update install failed: {}", e);
            CommandResponse::error(
                "UPDATE_INSTALL_FAILED",
                &format!("更新安装失败: {}", e),
                None,
                true,
            )
        }
    }
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_check_result_shape() {
        let resp = CommandResponse::success_with_data(UpdateCheckResult {
            available: true,
            version: Some("0.1.3".into()),
            notes: Some("Bug fixes".into()),
            date: Some("2026-07-10".into()),
        });
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert!(data.available);
        assert_eq!(data.version.unwrap(), "0.1.3");
    }

    #[test]
    fn test_update_check_no_update_shape() {
        let resp = CommandResponse::success_with_data(UpdateCheckResult {
            available: false,
            version: None,
            notes: None,
            date: None,
        });
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert!(!data.available);
    }

    #[test]
    fn test_update_install_result_shape() {
        let resp = CommandResponse::success_with_data(UpdateInstallResult {
            success: true,
            restarted: true,
        });
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert!(data.success);
        assert!(data.restarted);
    }

    #[test]
    fn test_update_check_error_shape() {
        let resp: CommandResponse<UpdateCheckResult> = CommandResponse::error(
            "UPDATE_CHECK_FAILED",
            "检查更新失败",
            None,
            true,
        );
        assert!(!resp.success);
        let err = resp.error.unwrap();
        assert_eq!(err.code, "UPDATE_CHECK_FAILED");
        assert!(err.recoverable);
    }

    #[test]
    fn test_update_install_error_shape() {
        let resp: CommandResponse<UpdateInstallResult> = CommandResponse::error(
            "UPDATE_INSTALL_FAILED",
            "没有可用更新",
            None,
            false,
        );
        assert!(!resp.success);
        let err = resp.error.unwrap();
        assert_eq!(err.code, "UPDATE_INSTALL_FAILED");
        assert!(!err.recoverable);
    }
}