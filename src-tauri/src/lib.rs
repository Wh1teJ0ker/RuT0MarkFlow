use std::sync::Mutex;

pub mod app_state;
pub mod commands;
pub mod models;
pub mod modules;

use app_state::AppState;
use commands::{document, health, state, updater, workspace};
use models::dirty_state::DocumentDirtyState;
use modules::workspace::watcher::WatcherState;
use tauri::Emitter;
use tauri::Manager;

/// Application entry point.
///
/// Registers all Tauri plugins and commands, then launches the application window.
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level_for("rut0markflow", if cfg!(debug_assertions) {
                    log::LevelFilter::Trace
                } else {
                    log::LevelFilter::Info
                })
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(WatcherState::new()))
        .manage(DocumentDirtyState::new())
        .manage(AppState::new())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let dirty_state = window.state::<DocumentDirtyState>();
                let is_dirty = match dirty_state.0.lock() {
                    Ok(guard) => *guard,
                    Err(poisoned) => {
                        log::error!("DocumentDirtyState mutex poisoned, recovering");
                        *poisoned.into_inner()
                    }
                };
                if is_dirty {
                    api.prevent_close();
                    if let Err(e) = window.emit("app://close-requested", ()) {
                        log::warn!("Failed to emit close-requested event: {}", e);
                    }
                }
                // If clean, do nothing — window closes normally.
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
            state::set_document_dirty,
            updater::check_for_updates,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("Failed to run tauri application: {}", e);
        });
}
