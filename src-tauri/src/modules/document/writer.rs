use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::Path;

/// Write content to a Markdown file within the workspace.
///
/// Performs the same path validation as the reader:
/// 1. Root path is accessible
/// 2. Resolved path stays within the workspace (prevents `../` escape)
/// 3. Extension is `.md` or `.markdown` (case-insensitive)
///
/// NOTE: Write is direct (not atomic write-then-rename) for MVP simplicity.
pub fn write_markdown_file(root_path: &str, relative_path: &str, content: &str) -> Result<WriteResult, String> {
    let root = Path::new(root_path)
        .canonicalize()
        .map_err(|_| "工作区路径不可访问".to_string())?;

    let file_path = root.join(relative_path);

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
    let root = Path::new(root_path)
        .canonicalize()
        .map_err(|_| "工作区路径不可访问".to_string())?;

    let target = Path::new(target_path);

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

    // Check if within workspace
    let is_within = canonical.starts_with(&root);

    // If within workspace, validate with the single starts_with check
    if is_within && !canonical.starts_with(&root) {
        return Err("文件路径超出工作区范围".to_string());
    }

    validate_and_write(&canonical, content)
}

/// Internal: validate extension and write content to a canonical path.
fn validate_and_write(canonical: &Path, content: &str) -> Result<WriteResult, String> {
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

    // Ensure parent directory exists
    if let Some(parent) = canonical.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "无法创建目标目录".to_string())?;
    }

    // Write file
    let mut file = std::fs::File::create(canonical)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                "权限不足，无法写入文件".to_string()
            } else {
                format!("文件写入失败: {}", e)
            }
        })?;

    file.write_all(content.as_bytes())
        .map_err(|e| format!("文件写入失败: {}", e))?;

    file.flush()
        .map_err(|e| format!("文件写入失败: {}", e))?;

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
}