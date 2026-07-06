use crate::models::response::CommandResponse;
use crate::models::settings::AppSettings;
use crate::modules::settings::persistence;
use tauri::Manager;

/// Load persisted app settings from disk.
///
/// Returns default settings if the file doesn't exist or is corrupt.
/// The app must never block startup on settings read failure.
#[tauri::command]
pub fn load_app_settings(app: tauri::AppHandle) -> CommandResponse<AppSettings> {
    let app_dir = app.path().app_data_dir();
    match app_dir {
        Ok(dir) => {
            let settings = persistence::load_settings(&dir);
            CommandResponse::success_with_data(settings)
        }
        Err(_) => {
            // Can't resolve app data dir — return defaults
            CommandResponse::success_with_data(AppSettings::default())
        }
    }
}

/// Save app settings to disk.
///
/// Silently ignores write failures so the main flow is never blocked.
#[tauri::command]
pub fn save_app_settings(app: tauri::AppHandle, settings: AppSettings) -> CommandResponse<()> {
    let app_dir = app.path().app_data_dir();
    match app_dir {
        Ok(dir) => {
            persistence::save_settings(&dir, &settings);
            CommandResponse::success_with_data(())
        }
        Err(_) => {
            CommandResponse::success_with_data(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_settings_shape() {
        let resp: CommandResponse<AppSettings> =
            CommandResponse::success_with_data(AppSettings::default());
        assert!(resp.success);
        let data = resp.data.unwrap();
        assert_eq!(data.view_mode, "split-editor");
    }

    #[test]
    fn test_error_response_shape() {
        let resp: CommandResponse<()> = CommandResponse::error(
            "SETTINGS_SAVE_FAILED",
            "无法保存设置",
            None,
            true,
        );
        assert!(!resp.success);
        assert!(resp.error.is_some());
    }
}