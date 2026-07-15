use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use notify::{Event, EventKind, RecursiveMode, Watcher as NotifyWatcher};
use tauri::Emitter;

/// Debounce timeout: wait this long after the last file-system event before
/// emitting a rebuild notification to the frontend.
const DEBOUNCE_MS: u64 = 300;

/// Tauri event name emitted when the index needs refreshing.
pub const INDEX_CHANGED_EVENT: &str = "workspace://index-changed";

/// Payload sent with the index-changed event.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexChangedPayload {
    pub root_path: String,
}

/// A running workspace watcher instance.
///
/// Dropping the struct stops the underlying notify watcher;
/// sending to `stop_tx` signals the debounce loop to exit.
pub struct WorkspaceWatcher {
    _notify_watcher: notify::RecommendedWatcher,
    stop_tx: mpsc::Sender<()>,
}

/// Global state held in tauri::State<Mutex<WatcherState>>.
pub struct WatcherState {
    pub watcher: Option<WorkspaceWatcher>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self { watcher: None }
    }
}

impl Default for WatcherState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start a file-system watcher on `root_path` with debounced rebuild signalling.
///
/// The watcher monitors the directory recursively for changes to `.md` /
/// `.markdown` files. After a 300 ms quiet period following the last relevant
/// event, it emits a `workspace://index-changed` event on the Tauri `AppHandle`.
/// The frontend is expected to call `refresh_workspace_index` in response.
///
/// Returns `Err` with a human-readable message on failure (permission, platform
/// limitation, etc.) — callers should treat this as non-fatal and degrade to
/// manual refresh only.
pub fn start_watcher(
    root_path: &str,
    app_handle: tauri::AppHandle,
) -> Result<WorkspaceWatcher, String> {
    let (event_tx, event_rx) = mpsc::channel::<notify::Result<Event>>();

    // ── Step 1: Create the notify watcher ─────────────────────────
    let mut notify = notify::recommended_watcher(move |res: notify::Result<Event>| {
        // Ignore send errors (receiver dropped = watcher stopping)
        let _ = event_tx.send(res);
    })
    .map_err(|e| {
        log::warn!("Watcher create failed: {}", e);
        format!("watcher 创建失败: {}", e)
    })?;

    // ── Step 2: Start watching the directory ──────────────────────
    let path = Path::new(root_path);
    if !path.is_dir() {
        return Err(format!("路径不是目录: {}", root_path));
    }

    NotifyWatcher::watch(&mut notify, path, RecursiveMode::Recursive)
        .map_err(|e| {
            log::warn!("Watcher watch failed: {}", e);
            format!("watcher 启动失败: {}", e)
        })?;

    // ── Step 3: Set up stop-signal channel ────────────────────────
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    // ── Step 4: Spawn the debounce loop thread ───────────────────
    let root_owned = root_path.to_string();
    let app_clone = app_handle.clone();

    std::thread::Builder::new()
        .name("watcher-debounce".into())
        .spawn(move || {
            debounce_loop(event_rx, stop_rx, &root_owned, app_clone);
        })
        .map_err(|e| {
            log::warn!("Watcher thread spawn failed: {}", e);
            format!("无法创建 watcher 线程: {}", e)
        })?;

    log::info!("Watcher started for: {}", root_path);

    Ok(WorkspaceWatcher {
        _notify_watcher: notify,
        stop_tx,
    })
}

/// Core debounce loop: receives file-system events, filters for `.md` /
/// `.markdown` relevance, and emits `workspace://index-changed` after
/// `DEBOUNCE_MS` of inactivity.
fn debounce_loop(
    event_rx: mpsc::Receiver<notify::Result<Event>>,
    stop_rx: mpsc::Receiver<()>,
    root_path: &str,
    app_handle: tauri::AppHandle,
) {
    let mut last_relevant: Option<Instant> = None;

    loop {
        // Check for stop signal every 100ms
        if let Ok(()) = stop_rx.try_recv() {
            return;
        }

        match event_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(event)) => {
                if is_relevant_event(&event) {
                    last_relevant = Some(Instant::now());
                }
            }
            Ok(Err(_)) => {
                // Individual notify errors (e.g. permission-denied on a file)
                // are non-fatal; keep watching.
                log::warn!("File watcher error (non-fatal, continuing)");
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // ── Check if we should emit a rebuild signal ─────
                if let Some(t) = last_relevant {
                    if t.elapsed() >= Duration::from_millis(DEBOUNCE_MS) {
                        last_relevant = None;

                        // Double-check workspace still exists
                        if !Path::new(root_path).is_dir() {
                            log::warn!("Workspace directory disappeared: {}", root_path);
                            continue;
                        }

                        let payload = IndexChangedPayload {
                            root_path: root_path.to_string(),
                        };
                        if let Err(e) = app_handle.emit(INDEX_CHANGED_EVENT, payload) {
                            log::error!("Failed to emit index-changed event for: {} ({})", root_path, e);
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Returns `true` if the event is relevant to our index (`.md` / `.markdown`
/// file creation, removal, or modification).
fn is_relevant_event(event: &notify::Event) -> bool {
    match event.kind {
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_) => {
            event.paths.iter().any(|p| {
                p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
                    .unwrap_or(false)
            })
        }
        _ => false,
    }
}

/// Stop the currently-running watcher (if any) held in the given state.
pub fn stop_watcher(state: &Mutex<WatcherState>) {
    if let Ok(mut guard) = state.lock() {
        if let Some(w) = guard.watcher.take() {
            // Signal the debounce loop to exit; dropping `w` stops notify.
            let _ = w.stop_tx.send(());
            log::info!("Watcher stopped");
        }
    } else {
        log::error!("WatcherState mutex poisoned in stop_watcher");
    }
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Pure-function test: verify that the debounce timeout constant is
    /// set to the expected value (300 ms).
    #[test]
    fn test_debounce_ms_constant() {
        assert_eq!(DEBOUNCE_MS, 300);
    }

    /// Pure-function test: verify the event name constant.
    #[test]
    fn test_event_name_constant() {
        assert_eq!(INDEX_CHANGED_EVENT, "workspace://index-changed");
    }

    /// Pure-function test: `is_relevant_event` returns true for
    /// Create events on `.md` files.
    #[test]
    fn test_is_relevant_md_create() {
        let event = Event {
            kind: EventKind::Create(notify::event::CreateKind::File),
            paths: vec![std::path::PathBuf::from("/ws/readme.md")],
            ..Default::default()
        };
        assert!(is_relevant_event(&event));
    }

    /// Pure-function test: `is_relevant_event` returns true for
    /// Remove events on `.markdown` files.
    #[test]
    fn test_is_relevant_markdown_remove() {
        let event = Event {
            kind: EventKind::Remove(notify::event::RemoveKind::File),
            paths: vec![std::path::PathBuf::from("/ws/doc.markdown")],
            ..Default::default()
        };
        assert!(is_relevant_event(&event));
    }

    /// Pure-function test: `is_relevant_event` returns false for
    /// non-Markdown files (e.g. `.txt`).
    #[test]
    fn test_not_relevant_non_md() {
        let event = Event {
            kind: EventKind::Create(notify::event::CreateKind::File),
            paths: vec![std::path::PathBuf::from("/ws/notes.txt")],
            ..Default::default()
        };
        assert!(!is_relevant_event(&event));
    }

    /// Pure-function test: `is_relevant_event` returns false for
    /// directory creation events (not a file we index).
    #[test]
    fn test_not_relevant_directory() {
        let event = Event {
            kind: EventKind::Create(notify::event::CreateKind::Folder),
            paths: vec![std::path::PathBuf::from("/ws/subdir")],
            ..Default::default()
        };
        // Directory creation doesn't directly affect the index (files inside
        // will generate separate Create events when they appear).
        assert!(!is_relevant_event(&event));
    }

    /// Pure-function test: `is_relevant_event` matches case-insensitive
    /// extension (.MD, .Markdown).
    #[test]
    fn test_is_relevant_case_insensitive() {
        let event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Data(notify::event::DataChange::Content)),
            paths: vec![std::path::PathBuf::from("/ws/README.MD")],
            ..Default::default()
        };
        assert!(is_relevant_event(&event));
    }

    /// Pure-function test: `IndexChangedPayload` serializes with camelCase.
    #[test]
    fn test_payload_serialization() {
        let payload = IndexChangedPayload {
            root_path: "/ws".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("rootPath"));
        assert!(!json.contains("root_path"));
    }
}