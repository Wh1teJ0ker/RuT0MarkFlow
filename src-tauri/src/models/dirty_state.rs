use std::sync::Mutex;

/// Thread-safe dirty flag shared between Tauri commands and the window event handler.
///
/// The front-end synchronises `document.isDirty` to this flag via the
/// `set_document_dirty` command. The `on_window_event` handler reads it to
/// decide whether to `prevent_close()`.
pub struct DocumentDirtyState(pub Mutex<bool>);

impl DocumentDirtyState {
    /// Create a new dirty state, initialised to `false` (clean).
    pub fn new() -> Self {
        Self(Mutex::new(false))
    }
}

impl Default for DocumentDirtyState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_is_clean() {
        let state = DocumentDirtyState::new();
        assert!(!*state.0.lock().unwrap());
    }

    #[test]
    fn test_set_dirty() {
        let state = DocumentDirtyState::new();
        {
            let mut guard = state.0.lock().unwrap();
            *guard = true;
        }
        assert!(*state.0.lock().unwrap());
    }

    #[test]
    fn test_set_clean_after_dirty() {
        let state = DocumentDirtyState::new();
        {
            let mut guard = state.0.lock().unwrap();
            *guard = true;
        }
        {
            let mut guard = state.0.lock().unwrap();
            *guard = false;
        }
        assert!(!*state.0.lock().unwrap());
    }

    #[test]
    fn test_default_is_clean() {
        let state = DocumentDirtyState::default();
        assert!(!*state.0.lock().unwrap());
    }

    #[test]
    fn test_prevent_close_condition() {
        // Simulates the conditional logic used in lib.rs on_window_event:
        //   if is_dirty { prevent_close(); emit(); }
        //   else { /* window closes normally */ }
        let state = DocumentDirtyState::new();

        // Clean → should NOT prevent_close
        let is_dirty_clean = *state.0.lock().unwrap();
        assert!(!is_dirty_clean, "clean document should not trigger prevent_close");

        // Make dirty → should prevent_close
        {
            let mut guard = state.0.lock().unwrap();
            *guard = true;
        }
        let is_dirty_dirty = *state.0.lock().unwrap();
        assert!(is_dirty_dirty, "dirty document should trigger prevent_close");
    }
}