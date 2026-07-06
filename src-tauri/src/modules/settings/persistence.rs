use crate::models::settings::AppSettings;
use std::path::Path;

/// File name for the persisted settings.
const SETTINGS_FILE: &str = "settings.json";

/// Load settings from disk. Returns `AppSettings::default()` on any error.
///
/// This is intentionally permissive: missing file, corrupt JSON, or IO error
/// all produce a default settings object so the app never blocks on startup.
pub fn load_settings(app_data_dir: &Path) -> AppSettings {
    let path = app_data_dir.join(SETTINGS_FILE);

    if !path.exists() {
        return AppSettings::default();
    }

    match std::fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<AppSettings>(&content) {
            Ok(s) => s,
            Err(_) => {
                // Corrupt file — reset to defaults
                let _ = std::fs::remove_file(&path);
                AppSettings::default()
            }
        },
        Err(_) => AppSettings::default(),
    }
}

/// Save settings to disk. Silently ignores errors so the caller's main flow
/// (workspace switch, document open, mode change) is never blocked by a
/// write failure.
pub fn save_settings(app_data_dir: &Path, settings: &AppSettings) {
    // Ensure directory exists
    if !app_data_dir.exists() && std::fs::create_dir_all(app_data_dir).is_err() {
            return; // Can't create dir, skip save
    }

    let path = app_data_dir.join(SETTINGS_FILE);

    match serde_json::to_string_pretty(settings) {
        Ok(json) => {
            let _ = std::fs::write(&path, json);
        }
        Err(_) => {
            // Serialization failure — skip save
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn tmp_dir() -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("rut0markflow_settings_test_{}_{}", std::process::id(), n))
    }

    fn cleanup(dir: &PathBuf) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_load_defaults_when_file_missing() {
        let dir = tmp_dir();
        cleanup(&dir);
        let settings = load_settings(&dir);
        assert!(settings.recent_workspace_path.is_none());
        assert!(settings.recent_document_path.is_none());
        assert_eq!(settings.view_mode, "split-editor");
        assert_eq!(settings.theme, "light");
        cleanup(&dir);
    }

    #[test]
    fn test_round_trip() {
        let dir = tmp_dir();
        fs::create_dir_all(&dir).unwrap();

        let s = AppSettings {
            recent_workspace_path: Some("/ws".into()),
            recent_document_path: Some("doc.md".into()),
            view_mode: "immersive-preview".into(),
            theme: "dark".into(),
        };
        save_settings(&dir, &s);

        let loaded = load_settings(&dir);
        assert_eq!(loaded.recent_workspace_path, Some("/ws".into()));
        assert_eq!(loaded.recent_document_path, Some("doc.md".into()));
        assert_eq!(loaded.view_mode, "immersive-preview");
        assert_eq!(loaded.theme, "dark");
        cleanup(&dir);
    }

    #[test]
    fn test_corrupt_file_returns_defaults() {
        let dir = tmp_dir();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(SETTINGS_FILE), "{ invalid json }").unwrap();

        let settings = load_settings(&dir);
        assert!(settings.recent_workspace_path.is_none());
        assert_eq!(settings.view_mode, "split-editor");
        assert_eq!(settings.theme, "light");
        // Corrupt file should be removed
        assert!(!dir.join(SETTINGS_FILE).exists());
        cleanup(&dir);
    }

    #[test]
    fn test_partial_json_uses_defaults_for_missing_fields() {
        let dir = tmp_dir();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(SETTINGS_FILE), r#"{"viewMode":"immersive-preview"}"#).unwrap();

        let settings = load_settings(&dir);
        assert!(settings.recent_workspace_path.is_none());
        assert_eq!(settings.view_mode, "immersive-preview");
        assert_eq!(settings.theme, "light");
        cleanup(&dir);
    }

    #[test]
    fn test_save_failure_does_not_panic() {
        let dir = PathBuf::from("/dev/null/nonexistent");
        let s = AppSettings::default();
        save_settings(&dir, &s);
        // Should not panic
    }

    #[test]
    fn test_theme_field_defaults_to_light_when_missing() {
        let dir = tmp_dir();
        fs::create_dir_all(&dir).unwrap();
        // JSON without "theme" field
        fs::write(dir.join(SETTINGS_FILE), r#"{"viewMode":"split-editor"}"#).unwrap();

        let settings = load_settings(&dir);
        assert_eq!(settings.theme, "light");
        cleanup(&dir);
    }
}