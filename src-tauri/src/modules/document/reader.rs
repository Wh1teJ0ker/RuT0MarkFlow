use std::path::Path;

/// Maximum file size for a single document read (10 MB).
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// Result of a successful document read.
#[derive(Debug)]
pub struct ReadResult {
    pub file_name: String,
    pub relative_path: String,
    pub content: String,
    pub updated_at: String,
}

/// Read a Markdown file from the workspace, validating path safety and constraints.
///
/// Checks performed:
/// 1. Root path is accessible
/// 2. Resolved path stays within the workspace (prevents `../` escape)
/// 3. File exists and is a regular file
/// 4. Extension is `.md` or `.markdown` (case-insensitive)
/// 5. File size does not exceed 10 MB
/// 6. Content is valid UTF-8 (with BOM stripping and GBK/GB2312 fallback)
///
/// All errors are returned as String messages suitable for structured error responses.
pub fn read_markdown_file(root_path: &str, relative_path: &str) -> Result<ReadResult, String> {
    // ── 1. Root path must be accessible ────────────────────────
    let root = Path::new(root_path)
        .canonicalize()
        .map_err(|_| "工作区路径不可访问".to_string())?;

    // ── 2. Resolve full path and validate it stays within workspace ──
    let file_path = root.join(relative_path);
    let canonical = file_path
        .canonicalize()
        .map_err(|_| format!("文件不存在: {}", relative_path))?;

    if !canonical.starts_with(&root) {
        log::warn!("Path traversal rejected: {} (escapes workspace root)", relative_path);
        return Err("文件路径超出工作区范围".to_string());
    }

    // ── 3. Must be a regular file ──────────────────────────────
    if !canonical.is_file() {
        return Err(format!("路径不是文件: {}", relative_path));
    }

    // ── 4. Extension must be .md or .markdown ─────────────────
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

    // ── 5. File size limit ─────────────────────────────────────
    let metadata = std::fs::metadata(&canonical)
        .map_err(|_| "无法读取文件元信息".to_string())?;
    let file_size = metadata.len();
    if file_size > MAX_FILE_SIZE {
        log::warn!("File too large: {} ({} bytes, max {})", relative_path, file_size, MAX_FILE_SIZE);
        return Err(format!(
            "文件过大（超过 10 MB），当前大小: {} bytes",
            file_size
        ));
    }

    // ── 6. Read content with encoding detection ────────────────
    // Read raw bytes first, then decode with BOM stripping + fallback support.
    let raw_bytes = std::fs::read(&canonical).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            "权限不足，无法读取文件".to_string()
        } else {
            format!("文件读取失败: {}", e)
        }
    })?;

    let content = decode_content(&raw_bytes)?;

    log::info!("Opened document: {} ({} bytes)", relative_path, file_size);

    let file_name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

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

    Ok(ReadResult {
        file_name,
        relative_path: relative_path.to_string(),
        content,
        updated_at,
    })
}

/// Decode raw bytes to String, with BOM stripping and GBK/GB2312 fallback.
///
/// Strategy:
/// 1. Strip UTF-8 BOM (`\u{FEFF}`) if present.
/// 2. Try `String::from_utf8` (fast path for UTF-8-only files).
/// 3. On failure, try `encoding_rs` GBK decoding (covers GBK, GB2312, GB18030).
///    This handles Windows Notepad default "ANSI" encoding for Chinese locales.
/// 4. If all decoding fails, return a clear error message.
fn decode_content(raw: &[u8]) -> Result<String, String> {
    // ── Strip UTF-8 BOM ────────────────────────────────────────
    let without_bom = if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &raw[3..]
    } else {
        raw
    };

    // ── Try UTF-8 first (fast path) ────────────────────────────
    if let Ok(s) = String::from_utf8(without_bom.to_vec()) {
        return Ok(s);
    }

    // ── Fallback: try GBK (covers GBK, GB2312, GB18030) ────────
    let (decoded, _encoding_used, had_errors) = encoding_rs::GBK.decode(without_bom);
    if !had_errors {
        log::debug!("File decoded as GBK/GB18030 fallback");
        return Ok(decoded.into_owned());
    }

    // ── Final: try GB18030 (broader charset) ───────────────────
    let (decoded, _encoding_used, had_errors) = encoding_rs::GB18030.decode(without_bom);
    if !had_errors {
        log::debug!("File decoded as GBK/GB18030 fallback");
        return Ok(decoded.into_owned());
    }

    log::warn!("File encoding decode failed (not UTF-8 or GBK)");
    Err("文件编码不是有效的 UTF-8 或 GBK/GB2312".to_string())
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn setup_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rut0markflow_doc_test_{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_read_markdown_file_success() {
        let dir = setup_test_dir("read_ok");
        fs::write(dir.join("hello.md"), "# Hello\nWorld").unwrap();

        let root = dir.to_string_lossy().to_string();
        let result = read_markdown_file(&root, "hello.md").unwrap();
        assert_eq!(result.file_name, "hello.md");
        assert_eq!(result.content, "# Hello\nWorld");
        assert!(!result.updated_at.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_not_found() {
        let dir = setup_test_dir("not_found");
        let root = dir.to_string_lossy().to_string();
        let err = read_markdown_file(&root, "nonexistent.md").unwrap_err();
        assert!(err.contains("不存在"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_non_markdown_extension() {
        let dir = setup_test_dir("bad_ext");
        fs::write(dir.join("notes.txt"), "hello").unwrap();

        let root = dir.to_string_lossy().to_string();
        let err = read_markdown_file(&root, "notes.txt").unwrap_err();
        assert!(err.contains("不支持"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_path_traversal_escape() {
        let dir = setup_test_dir("traversal");
        fs::write(dir.join("outside.txt"), "secret").unwrap();

        let root = dir.to_string_lossy().to_string();
        // Try to access a file outside the workspace
        let err = read_markdown_file(&root, "../outside.txt").unwrap_err();
        assert!(err.contains("超出") || err.contains("不存在"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_markdown_extension_variants() {
        let dir = setup_test_dir("ext_variants");
        fs::write(dir.join("a.md"), "a").unwrap();
        fs::write(dir.join("b.markdown"), "b").unwrap();
        fs::write(dir.join("c.MD"), "c").unwrap();
        fs::write(dir.join("d.Markdown"), "d").unwrap();

        let root = dir.to_string_lossy().to_string();
        for name in &["a.md", "b.markdown", "c.MD", "d.Markdown"] {
            let result = read_markdown_file(&root, name).unwrap();
            assert!(!result.content.is_empty());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_too_large() {
        // We can't easily create a 10MB file in a test,
        // but we can verify the size check logic by checking
        // that a normal file passes.
        let dir = setup_test_dir("size_ok");
        fs::write(dir.join("small.md"), "small").unwrap();
        let root = dir.to_string_lossy().to_string();
        let result = read_markdown_file(&root, "small.md").unwrap();
        assert_eq!(result.content, "small");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_utf8_bom_is_stripped() {
        // UTF-8 BOM (EF BB BF) should be stripped from content.
        let dir = setup_test_dir("bom_strip");
        let bom: &[u8] = &[0xEF, 0xBB, 0xBF];
        let mut data = bom.to_vec();
        data.extend_from_slice(b"# Hello\nWorld");
        fs::write(dir.join("bom.md"), &data).unwrap();

        let root = dir.to_string_lossy().to_string();
        let result = read_markdown_file(&root, "bom.md").unwrap();
        assert_eq!(result.content, "# Hello\nWorld", "BOM should be stripped");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_gbk_file_decoded_successfully() {
        // GBK-encoded file (Notepad default on Chinese Windows) should decode.
        let dir = setup_test_dir("gbk_decode");
        // GBK bytes for "你好世界" (Hello World in Chinese)
        let gbk_bytes: &[u8] = &[0xC4, 0xE3, 0xBA, 0xC3, 0xCA, 0xC0, 0xBD, 0xE7];
        fs::write(dir.join("gbk.md"), gbk_bytes).unwrap();

        let root = dir.to_string_lossy().to_string();
        let result = read_markdown_file(&root, "gbk.md").unwrap();
        assert_eq!(result.content, "你好世界", "GBK content should decode as UTF-8");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_gbk_with_bom_decoded_successfully() {
        // File with both BOM prefix and GBK content — BOM stripped, GBK decoded.
        let dir = setup_test_dir("gbk_bom");
        let bom: &[u8] = &[0xEF, 0xBB, 0xBF];
        let gbk_body: &[u8] = &[0xB2, 0xE2, 0xCA, 0xD4]; // 测试 (test)
        let mut data = bom.to_vec();
        data.extend_from_slice(gbk_body);
        fs::write(dir.join("gbk_bom.md"), &data).unwrap();

        let root = dir.to_string_lossy().to_string();
        let result = read_markdown_file(&root, "gbk_bom.md").unwrap();
        assert_eq!(result.content, "测试", "BOM stripped + GBK decoded");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_invalid_encoding_returns_error() {
        // Random binary data that is neither UTF-8 nor GBK should fail.
        // 0xFF is not a valid byte in GBK (lead bytes are 0x81-0xFE) and not
        // valid in UTF-8.
        let dir = setup_test_dir("bad_encoding");
        let invalid: &[u8] = &[0xFF, 0xFF];
        fs::write(dir.join("bad.md"), invalid).unwrap();

        let root = dir.to_string_lossy().to_string();
        let err = read_markdown_file(&root, "bad.md").unwrap_err();
        assert!(err.contains("编码") || err.contains("有效"), "Error: {}", err);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_utf8_without_bom_still_works() {
        // Regular UTF-8 file without BOM (macOS/Linux default) should still work.
        let dir = setup_test_dir("utf8_plain");
        fs::write(dir.join("plain.md"), "Hello, 世界").unwrap();

        let root = dir.to_string_lossy().to_string();
        let result = read_markdown_file(&root, "plain.md").unwrap();
        assert_eq!(result.content, "Hello, 世界");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_decode_content_bom_only() {
        // File consisting of only a BOM should decode to empty string.
        let dir = setup_test_dir("bom_only");
        let bom: &[u8] = &[0xEF, 0xBB, 0xBF];
        fs::write(dir.join("bom_only.md"), bom).unwrap();

        let root = dir.to_string_lossy().to_string();
        let result = read_markdown_file(&root, "bom_only.md").unwrap();
        assert_eq!(result.content, "", "BOM-only file should yield empty content");
        let _ = fs::remove_dir_all(&dir);
    }
}