use std::sync::Mutex;

pub mod commands;
pub mod models;
pub mod modules;

use commands::{document, health, state, updater, workspace};
use modules::workspace::watcher::WatcherState;
use tauri::Emitter;

/// Application entry point.
///
/// Registers all Tauri plugins and commands, then launches the application window.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(WatcherState::new()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("app://close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            health::health_check,
            health::version_info,
            workspace::select_workspace,
            workspace::load_workspace,
            workspace::refresh_workspace_index,
            workspace::start_workspace_watcher,
            workspace::stop_workspace_watcher,
            document::open_document,
            document::save_document,
            document::save_document_as,
            document::pick_save_path,
            state::load_app_settings,
            state::save_app_settings,
            updater::check_for_updates,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
