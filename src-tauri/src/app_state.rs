use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

/// Holds the user-authorised workspace root path.
///
/// The front-end never supplies `root_path` to file-operation commands.
/// Instead, `select_workspace` / `load_workspace` canonicalise the chosen
/// path and store it here. All subsequent file operations
/// (`open_document`, `save_document`, `save_document_as`, `pick_save_path`,
/// `refresh_workspace_index`) read the root from this state, so a
/// compromised webview cannot forge a `root_path` to access arbitrary
/// directories outside the authorised workspace.
///
/// The stored path is always canonicalised (symlinks resolved, `..`
/// collapsed) at the moment of authorisation. Reader/writer modules still
/// canonicalise again at I/O time for defence-in-depth.
pub struct AppState {
    /// Canonical, user-authorised workspace root. `None` until the user
    /// selects/loads a workspace.
    pub authorized_workspace: Mutex<Option<PathBuf>>,

    /// Pending one-time save-as token. `pick_save_path` issues a token and
    /// stores the picker-chosen target path here; `save_document_as` consumes
    /// the token and reads the path back. The front-end therefore can only
    /// write to a path that the native picker actually chose, and a token is
    /// single-use: once consumed, it is no longer valid.
    pending_save_token: Mutex<Option<PendingSaveToken>>,
}

/// Entry stored in `pending_save_token`: a token string bound to the path the
/// user selected in the native save-as dialog, plus the time it was issued so
/// stale entries can be pruned.
struct PendingSaveToken {
    token: String,
    target_path: String,
    issued_at: Instant,
}

/// A token issued by `pick_save_path` is considered expired after this
/// duration, so a token left unconsumed (e.g. the user cancelled save-as
/// after picking a path) cannot be reused much later.
const SAVE_TOKEN_TTL_SECS: u64 = 10 * 60;

impl AppState {
    /// Create a new AppState with no authorised workspace.
    pub fn new() -> Self {
        Self {
            authorized_workspace: Mutex::new(None),
            pending_save_token: Mutex::new(None),
        }
    }

    /// Canonicalise and store the given path as the authorised workspace root.
    ///
    /// Returns the canonicalised path on success, or an error string if the
    /// path cannot be canonicalised (e.g. does not exist).
    pub fn authorize(&self, root_path: &str) -> Result<PathBuf, String> {
        let canonical = std::path::Path::new(root_path)
            .canonicalize()
            .map_err(|_| {
                log::warn!("Workspace authorization failed: {}", root_path);
                format!("工作区路径不可访问: {}", root_path)
            })?;
        let mut guard = self
            .authorized_workspace
            .lock()
            .map_err(|_| "授权状态锁异常".to_string())?;
        *guard = Some(canonical.clone());
        log::info!("Workspace authorized: {}", canonical.display());
        Ok(canonical)
    }

    /// Clear the authorised workspace (e.g. when switching workspaces).
    #[allow(dead_code)]
    pub fn clear(&self) -> Result<(), String> {
        let mut guard = self
            .authorized_workspace
            .lock()
            .map_err(|_| "授权状态锁异常".to_string())?;
        *guard = None;
        Ok(())
    }

    /// Read the authorised workspace root as a string.
    ///
    /// Returns an `Err` with a message if no workspace is authorised.
    pub fn require_root(&self) -> Result<String, String> {
        let guard = self
            .authorized_workspace
            .lock()
            .map_err(|_| "授权状态锁异常".to_string())?;
        guard
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "未授权工作区，请先选择或加载工作区".to_string())
    }

    /// Issue a one-time save-as token bound to the given target path and
    /// return the token string. Any previously issued pending token is
    /// overwritten, so only the most recent `pick_save_path` result is
    /// redeemable.
    ///
    /// The token is a 32-char hex string produced by `generate_token_hex`,
    /// which seeds a xorshift64 PRNG from nanosecond wall-clock time, the
    /// process id and a per-process atomic counter. It is NOT backed by a
    /// platform CSPRNG. Its unguessability relies on the threat-model
    /// assumption that a compromised webview cannot observe this process's
    /// memory (where the seed sources and counter live); the token only needs
    /// to be unpredictable enough that a sandboxed webview cannot forge a
    /// `target_path` it never picked via the native dialog.
    pub fn issue_save_token(&self, target_path: &str) -> Result<String, String> {
        let token = generate_token_hex();
        let mut guard = self
            .pending_save_token
            .lock()
            .map_err(|_| "授权状态锁异常".to_string())?;
        *guard = Some(PendingSaveToken {
            token: token.clone(),
            target_path: target_path.to_string(),
            issued_at: Instant::now(),
        });
        log::debug!("Save token issued for: {}", target_path);
        Ok(token)
    }

    /// Consume a one-time save-as token, returning the bound target path on
    /// success. On success the pending slot is cleared, so the token cannot
    /// be reused. Returns `Err` if the slot is empty, the token does not
    /// match, or the token has expired (older than `SAVE_TOKEN_TTL_SECS`).
    pub fn consume_save_token(&self, token: &str) -> Result<String, String> {
        let mut guard = self
            .pending_save_token
            .lock()
            .map_err(|_| "授权状态锁异常".to_string())?;
        match guard.take() {
            Some(entry) if entry.token == token => {
                if entry.issued_at.elapsed().as_secs() > SAVE_TOKEN_TTL_SECS {
                    log::warn!("Save token expired");
                    return Err("保存令牌已过期，请重新选择保存路径".to_string());
                }
                Ok(entry.target_path)
            }
            Some(_) => {
                log::warn!("Save token mismatch");
                Err("保存令牌无效或已被替换".to_string())
            }
            None => Err("没有待使用的保存令牌，请先选择保存路径".to_string()),
        }
    }
}

/// Generate a 32-char hex token (16 bytes) seeded from nanosecond time, the
/// process id and a per-process atomic counter. This is unpredictable enough
/// that a sandboxed webview cannot guess it without observing the process
/// memory — which is the threat model here, since the token exists to stop a
/// compromised webview from forging a `target_path` it never picked via the
/// native dialog. No new crate dependency is added to keep the change scoped.
fn generate_token_hex() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let pid = std::process::id() as u64;

    // Mix the three entropy sources into one 64-bit seed.
    let mut seed = nanos ^ (seq.wrapping_mul(0x9E3779B97F4A7C15)) ^ (pid << 32);

    let mut bytes = [0u8; 16];
    for byte in bytes.iter_mut() {
        // xorshift64 advances the seed per byte.
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        *byte = (seed & 0xFF) as u8;
    }
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rut0markflow_appstate_test_{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_new_state_has_no_workspace() {
        let state = AppState::new();
        let guard = state.authorized_workspace.lock().unwrap();
        assert!(guard.is_none());
    }

    #[test]
    fn test_require_root_errors_when_unauthorized() {
        let state = AppState::new();
        let result = state.require_root();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("未授权"));
    }

    #[test]
    fn test_authorize_sets_canonical_path() {
        let dir = setup_test_dir("authorize_ok");
        let root_str = dir.to_string_lossy().to_string();

        // Even with a trailing "." the canonical form should be returned.
        let input_with_dot = format!("{}/.", root_str);
        let state = AppState::new();
        let canon = state.authorize(&input_with_dot).unwrap();

        // Canonical path should equal the dir's canonical form
        let expected = dir.canonicalize().unwrap();
        assert_eq!(canon, expected);

        // require_root returns the canonical string
        let root = state.require_root().unwrap();
        assert_eq!(root, expected.to_string_lossy().to_string());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_authorize_nonexistent_path_fails() {
        let state = AppState::new();
        let result = state.authorize("/tmp/rut0markflow_appstate_nonexistent_xyz789");
        assert!(result.is_err());
        // State remains unauthorized
        assert!(state.require_root().is_err());
    }

    /// Contract test for the dynamic asset-scope registration (T5).
    ///
    /// `register_asset_scope` in `commands/workspace.rs` feeds the path
    /// returned by `AppState::authorize` directly into
    /// `app.asset_protocol_scope().allow_directory(path, true)`. There is no
    /// additional transformation, so this test pins the contract: the value
    /// stored as the authorised root is exactly the value that gets registered
    /// with the Tauri asset protocol scope.
    ///
    /// The actual `Scope::allow_directory` call requires a running `AppHandle`
    /// (the `Scope` struct's constructor needs a `Manager` and its inner
    /// state is private), so it cannot be exercised in a pure unit test;
    /// that step is covered by manual / integration testing (see
    /// `docs/03-技术设计文档.md` §16.2 and the T5 REPORT).
    #[test]
    fn test_authorize_returns_path_for_asset_scope_registration() {
        let dir = setup_test_dir("asset_scope_contract");
        // Simulate a non-canonical input (trailing "."), as a picker might.
        let input = format!("{}/.", dir.to_string_lossy());
        let state = AppState::new();
        let registered_path = state.authorize(&input).unwrap();

        // The path stored in AppState and the path returned for scope
        // registration must be identical and canonical.
        assert_eq!(state.require_root().unwrap(), registered_path.to_string_lossy());
        // It must resolve to the real canonical directory, not the raw input.
        assert_ne!(registered_path.to_string_lossy(), input);
        assert!(registered_path.is_absolute());
        assert!(registered_path.exists(), "registered path must exist");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_authorize_overwrites_previous() {
        let dir_a = setup_test_dir("overwrite_a");
        let dir_b = setup_test_dir("overwrite_b");
        let state = AppState::new();

        let _ = state.authorize(&dir_a.to_string_lossy()).unwrap();
        assert_eq!(
            state.require_root().unwrap(),
            dir_a.canonicalize().unwrap().to_string_lossy().to_string()
        );

        let _ = state.authorize(&dir_b.to_string_lossy()).unwrap();
        assert_eq!(
            state.require_root().unwrap(),
            dir_b.canonicalize().unwrap().to_string_lossy().to_string()
        );

        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn test_clear_removes_authorization() {
        let dir = setup_test_dir("clear_ok");
        let state = AppState::new();
        let _ = state.authorize(&dir.to_string_lossy()).unwrap();
        assert!(state.require_root().is_ok());

        state.clear().unwrap();
        assert!(state.require_root().is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_issue_save_token_returns_bound_path_on_consume() {
        let state = AppState::new();
        let token = state.issue_save_token("/tmp/picked.md").unwrap();
        assert!(!token.is_empty());
        // Token is single-use: consuming it once returns the bound path.
        let target = state.consume_save_token(&token).unwrap();
        assert_eq!(target, "/tmp/picked.md");
        // A second consume with the same token must fail (token spent).
        let again = state.consume_save_token(&token);
        assert!(again.is_err());
    }

    #[test]
    fn test_consume_save_token_rejects_wrong_token() {
        let state = AppState::new();
        let _ = state.issue_save_token("/tmp/picked.md").unwrap();
        let err = state.consume_save_token("deadbeef").unwrap_err();
        assert!(err.contains("无效") || err.contains("替换"));
    }

    #[test]
    fn test_consume_save_token_rejects_when_empty() {
        let state = AppState::new();
        let err = state.consume_save_token("any").unwrap_err();
        assert!(err.contains("没有待使用"));
    }

    #[test]
    fn test_issue_save_token_overwrites_previous() {
        let state = AppState::new();
        let t1 = state.issue_save_token("/tmp/a.md").unwrap();
        let t2 = state.issue_save_token("/tmp/b.md").unwrap();
        // The newer token wins; the older one is no longer valid.
        assert_eq!(state.consume_save_token(&t2).unwrap(), "/tmp/b.md");
        let err = state.consume_save_token(&t1);
        assert!(err.is_err());
    }

    #[test]
    fn test_consume_save_token_rejects_expired() {
        let state = AppState::new();
        // Inject a token whose issued_at is already older than the TTL, so the
        // expiry branch in consume_save_token is exercised without having to
        // sleep for SAVE_TOKEN_TTL_SECS.
        let expired_issued_at = Instant::now() - std::time::Duration::from_secs(SAVE_TOKEN_TTL_SECS + 1);
        {
            let mut guard = state.pending_save_token.lock().unwrap();
            *guard = Some(PendingSaveToken {
                token: "expiredtesttoken".to_string(),
                target_path: "/tmp/expired.md".to_string(),
                issued_at: expired_issued_at,
            });
        }
        let err = state.consume_save_token("expiredtesttoken").unwrap_err();
        assert!(err.contains("过期"), "expected expiry error, got: {}", err);
        // An expired token must also be consumed (cleared), so a second
        // attempt reports "no pending token" rather than "expired".
        let err2 = state.consume_save_token("expiredtesttoken").unwrap_err();
        assert!(err2.contains("没有待使用"), "expected empty-slot error, got: {}", err2);
    }
}
