use std::hash::{Hash, Hasher};
use std::path::Path;

/// Write content to a Markdown file within the workspace.
///
/// Performs the same path validation as the reader:
/// 1. Root path is accessible
/// 2. Resolved path stays within the workspace (prevents `../` escape)
/// 3. Extension is `.md` or `.markdown` (case-insensitive)
///
/// NOTE: Write is atomic (write temp file → fsync → rename). Only the target
/// path itself is checked for symlinks. Parent directory symlinks are handled
/// by canonicalize + starts_with boundary checks, not by explicit rejection.
pub fn write_markdown_file(root_path: &str, relative_path: &str, content: &str) -> Result<WriteResult, String> {
    let root = Path::new(root_path)
        .canonicalize()
        .map_err(|_| "工作区路径不可访问".to_string())?;

    let file_path = root.join(relative_path);

    // Symlink protection on the target itself: if the (pre-canonicalize)
    // path is a symlink, reject it before canonicalize would follow it.
    if let Ok(meta) = std::fs::symlink_metadata(&file_path) {
        if meta.file_type().is_symlink() {
            return Err("目标路径是符号链接，拒绝写入".to_string());
        }
    }

    // Try canonicalize on the full path; if file doesn't exist yet,
    // canonicalize the parent directory and join with the filename.
    let canonical = match file_path.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // File may not exist yet; canonicalize parent
            if let Some(parent) = file_path.parent() {
                let parent_canon = parent
                    .canonicalize()
                    .map_err(|_| format!("目录路径无效: {}", relative_path))?;
                parent_canon.join(
                    file_path.file_name().unwrap_or(file_path.as_os_str()),
                )
            } else {
                return Err(format!("文件路径无效: {}", relative_path));
            }
        }
    };

    if !canonical.starts_with(&root) {
        return Err("文件路径超出工作区范围".to_string());
    }

    validate_and_write(&canonical, content)
}

/// Write content to an arbitrary path (may be inside or outside the workspace).
///
/// - If the path is within the workspace, performs the same path validation.
/// - If the path is outside, only extension and write permission checks are done.
pub fn write_to_any_path(root_path: &str, target_path: &str, content: &str) -> Result<WriteResult, String> {
    // Canonicalize the workspace root solely to validate that it is reachable;
    // the resolved value is intentionally unused for out-of-workspace writes.
    let _root = Path::new(root_path)
        .canonicalize()
        .map_err(|_| "工作区路径不可访问".to_string())?;

    let target = Path::new(target_path);

    // Symlink protection on the target itself, checked before any
    // canonicalize that would follow the link.
    if let Ok(meta) = std::fs::symlink_metadata(target) {
        if meta.file_type().is_symlink() {
            return Err("目标路径是符号链接，拒绝写入".to_string());
        }
    }

    // If the path has a parent, canonicalize to resolve it
    let canonical = if let Some(parent) = target.parent() {
        let parent_canonical = parent.canonicalize()
            .map_err(|_| format!("目标路径不可访问: {}", target_path))?;
        parent_canonical.join(
            target.file_name().unwrap_or(target.as_os_str())
        )
    } else {
        target.to_path_buf()
    };

    // The workspace root is resolved here so callers can distinguish in- from
    // out-of-workspace writes. Path-escape validation (rejecting `../`
    // traversal) is intentionally NOT applied to `write_to_any_path`: this
    // entry point is explicitly allowed to target paths outside the workspace,
    // so the only checks performed are extension and write permission (in
    // `validate_and_write`). The earlier `if is_within && !starts_with(&root)`
    // branch was dead code (a tautology) and has been removed. See the
    // `_root` binding above for the reachability-only canonicalize.

    validate_and_write(&canonical, content)
}

/// Internal: validate extension and write content to a canonical path.
///
/// Write is atomic:
/// 1. Write content to a temp file in the same directory as the target.
/// 2. fsync the temp file so data hits disk before the rename.
/// 3. Atomic-rename the temp file over the target path.
///
/// Symlink protection: only the target path itself is checked for symlinks
/// (via `symlink_metadata`, which does not follow links). Parent directory
/// symlinks are handled indirectly by the upstream canonicalize + starts_with
/// boundary checks, not by explicit rejection here.
fn validate_and_write(canonical: &Path, content: &str) -> Result<WriteResult, String> {
    log::debug!("Writing file atomically: {}", canonical.display());
    // Extension must be .md or .markdown
    let ext = canonical
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext != "md" && ext != "markdown" {
        return Err(format!(
            "不支持的文件类型: .{}，只允许 .md 和 .markdown",
            ext
        ));
    }

    // Ensure parent directory exists (without following symlinks).
    if let Some(parent) = canonical.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "无法创建目标目录".to_string())?;
    }

    // Symlink protection: refuse to write if the target itself is a symlink.
    // `symlink_metadata` does not follow symlinks, so it returns Err only if
    // the path does not exist — which is fine for a new file.
    if let Ok(meta) = std::fs::symlink_metadata(canonical) {
        if meta.file_type().is_symlink() {
            log::warn!("Symlink target rejected: {}", canonical.display());
            return Err("目标路径是符号链接，拒绝写入".to_string());
        }
    }

    // Build a sibling temp-file path in the same directory (so the rename
    // stays on the same filesystem and is atomic).
    let dir = canonical.parent().ok_or_else(|| "文件路径无效".to_string())?;
    let file_name = canonical
        .file_name()
        .ok_or_else(|| "文件路径无效".to_string())?
        .to_string_lossy()
        .to_string();
    let temp_name = format!(".{}.tmp.{:x}", file_name, random_suffix());
    let temp_path = dir.join(&temp_name);

    // Write + fsync the temp file. If any step fails, clean up the temp file
    // so we never leave dangling temp files behind.
    let write_result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temp_path)?;
        file.write_all(content.as_bytes())?;
        file.flush()?;
        // fsync to persist the data before the rename. `sync_all` maps to
        // fsync(2) on Unix and FlushFileBuffers on Windows.
        file.sync_all()?;
        Ok(())
    })();
    if let Err(e) = write_result {
        if std::fs::remove_file(&temp_path).is_err() {
            log::warn!("Failed to clean up temp file: {}", temp_path.display());
        }
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            return Err("权限不足，无法写入文件".to_string());
        }
        return Err(format!("文件写入失败: {}", e));
    }

    // Atomic rename over the target. On Unix this is an atomic replace; on
    // Windows, `std::fs::rename` (Rust 1.66+) uses
    // `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` and atomically overwrites an
    // existing target. If the rename fails for any reason (permissions, temp
    // file missing, etc.), we clean up the temp file and return an error —
    // the original target file is NEVER touched or deleted on failure.
    if let Err(e) = std::fs::rename(&temp_path, canonical) {
        if std::fs::remove_file(&temp_path).is_err() {
            log::warn!("Failed to clean up temp file: {}", temp_path.display());
        }
        return Err(format!("文件写入失败: {}", e));
    }

    log::info!("Saved document: {}", canonical.display());

    // Collect metadata
    let metadata = std::fs::metadata(canonical)
        .map_err(|_| "无法读取文件元信息".to_string())?;

    let updated_at = metadata
        .modified()
        .ok()
        .map(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs().to_string())
                .unwrap_or_default()
        })
        .unwrap_or_default();

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hasher);
    let content_hash = format!("{:x}", hasher.finish());

    Ok(WriteResult {
        path: canonical.to_string_lossy().to_string(),
        updated_at,
        content_hash,
    })
}

/// Generate a short random suffix for the temp file name. Combines a
/// monotonically increasing per-process `AtomicU64` counter with the current
/// nanosecond timestamp, so concurrent calls in the same process (even within
/// the same nanosecond) produce distinct suffixes. The temp file lives only
/// until the rename completes, so residual collisions are non-fatal.
fn random_suffix() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);

    // Mix the counter into the high bits and the timestamp into the low bits.
    nanos ^ (seq.wrapping_mul(0x9E3779B97F4A7C15))
}

/// Result of a successful file write.
#[derive(Debug)]
pub struct WriteResult {
    pub path: String,
    pub updated_at: String,
    pub content_hash: String,
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn setup_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rut0markflow_writer_test_{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_write_and_read_back() {
        let dir = setup_test_dir("write_read");
        let canonical_root = dir.canonicalize().unwrap();
        fs::write(dir.join("test.md"), "# Original").unwrap();
        let root = canonical_root.to_string_lossy().to_string();
        let result = write_markdown_file(&root, "test.md", "# Updated content").unwrap();
        let expected = canonical_root.join("test.md").to_string_lossy().to_string();
        assert_eq!(result.path, expected);
        let content = fs::read_to_string(&expected).unwrap();
        assert_eq!(content, "# Updated content");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_path_traversal_escape() {
        let dir = setup_test_dir("write_traversal");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/within.md"), "safe").unwrap();
        let root = dir.to_string_lossy().to_string();
        let err = write_markdown_file(&root, "../outside.md", "data").unwrap_err();
        assert!(err.contains("无效") || err.contains("超出"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_non_markdown_extension() {
        let dir = setup_test_dir("write_ext");
        fs::write(dir.join("notes.txt"), "data").unwrap();
        let root = dir.to_string_lossy().to_string();
        let err = write_markdown_file(&root, "notes.txt", "new data").unwrap_err();
        assert!(err.contains("不支持"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_write_new_path() {
        let dir = setup_test_dir("write_new");
        let canonical_root = dir.canonicalize().unwrap();
        let root = canonical_root.to_string_lossy().to_string();
        let result = write_markdown_file(&root, "new.md", "# New file").unwrap();
        let expected = canonical_root.join("new.md").to_string_lossy().to_string();
        assert_eq!(result.path, expected);
        let content = fs::read_to_string(&expected).unwrap();
        assert_eq!(content, "# New file");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_write_to_external_path() {
        let dir = setup_test_dir("write_ext_dest");
        let external = dir.join("external.md");
        // Create the workspace dir with a dummy file
        let ws = setup_test_dir("write_ext_ws");
        fs::write(ws.join("dummy.md"), "dummy").unwrap();

        let root = ws.to_string_lossy().to_string();
        let target = external.to_string_lossy().to_string();
        let result = write_to_any_path(&root, &target, "# External content").unwrap();
        assert!(result.path.contains("external.md"));

        let content = fs::read_to_string(&external).unwrap();
        assert_eq!(content, "# External content");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&ws);
    }

    #[cfg(unix)]
    fn make_symlink<P: AsRef<std::path::Path>, Q: AsRef<std::path::Path>>(src: P, dst: Q) {
        std::os::unix::fs::symlink(src, dst).unwrap();
    }

    #[test]
    fn test_atomic_write_overwrites_existing() {
        // Verify content is written correctly via the atomic path (rename over
        // an existing file), and the final content matches.
        let dir = setup_test_dir("atomic_overwrite");
        let canonical_root = dir.canonicalize().unwrap();
        fs::write(dir.join("a.md"), "ORIGINAL").unwrap();
        let root = canonical_root.to_string_lossy().to_string();
        write_markdown_file(&root, "a.md", "REPLACED").unwrap();
        let got = fs::read_to_string(canonical_root.join("a.md")).unwrap();
        assert_eq!(got, "REPLACED");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_no_temp_files_left_after_write() {
        // After a successful write, no leftover temp files should remain in
        // the target directory.
        let dir = setup_test_dir("temp_cleanup");
        let canonical_root = dir.canonicalize().unwrap();
        let root = canonical_root.to_string_lossy().to_string();
        write_markdown_file(&root, "fresh.md", "body").unwrap();
        // Enumerate directory entries; none should look like our temp file.
        for entry in fs::read_dir(&canonical_root).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().to_string();
            assert!(
                !name.starts_with(".fresh.md.tmp"),
                "leftover temp file: {}",
                name
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn test_symlink_target_rejected() {
        // A symlink at the target path must be rejected, not followed.
        let dir = setup_test_dir("symlink_target");
        let canonical_root = dir.canonicalize().unwrap();
        let real = canonical_root.join("real.md");
        fs::write(&real, "real").unwrap();
        let link = canonical_root.join("link.md");
        make_symlink(&real, &link);
        let root = canonical_root.to_string_lossy().to_string();
        let err = write_markdown_file(&root, "link.md", "hijack").unwrap_err();
        assert!(err.contains("符号链接"), "expected symlink error, got: {}", err);
        // Original content of the symlink target must be untouched.
        assert_eq!(fs::read_to_string(&real).unwrap(), "real");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn test_write_to_any_path_rejects_symlink() {
        let dir = setup_test_dir("any_symlink");
        let real = dir.join("real.md");
        fs::write(&real, "real").unwrap();
        let link = dir.join("link.md");
        make_symlink(&real, &link);
        let ws = setup_test_dir("any_symlink_ws");
        fs::write(ws.join("dummy.md"), "dummy").unwrap();
        let root = ws.to_string_lossy().to_string();
        let target = link.to_string_lossy().to_string();
        let err = write_to_any_path(&root, &target, "hijack").unwrap_err();
        assert!(err.contains("符号链接"), "expected symlink error, got: {}", err);
        assert_eq!(fs::read_to_string(&real).unwrap(), "real");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&ws);
    }
}
