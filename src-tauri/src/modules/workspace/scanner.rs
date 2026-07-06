use std::path::Path;

/// Directories whose contents will **not** be scanned.
///
/// These are common build/dependency/cache directories that never contain
/// user-authored Markdown documents. The list follows `.gitignore` common
/// conventions and is intentionally conservative.
pub const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".cache",
    "vendor",
    "__pycache__",
    ".next",
    ".nuxt",
    ".parcel-cache",
    "coverage",
];

/// Returns `true` if `name` is a directory that should be skipped during scanning.
pub fn is_skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name)
}

/// Recursively scan a directory for `.md` and `.markdown` files.
///
/// Returns a vector of `(absolute_path, relative_path)` pairs.
/// - Skips entries that are not readable (e.g. permission denied).
/// - Does not follow symlinks to avoid cycles.
/// - Does not scan hidden directories (names starting with `.`).
/// - Does not scan common dependency/artifact directories (node_modules, target, etc.).
/// - Does not panic on any filesystem error.
pub fn scan_markdown_files(root: &Path) -> Vec<(std::path::PathBuf, std::path::PathBuf)> {
    let mut files = Vec::new();
    if !root.is_dir() {
        return files;
    }
    scan_dir(root, root, &mut files);
    files
}

fn scan_dir(root: &Path, dir: &Path, files: &mut Vec<(std::path::PathBuf, std::path::PathBuf)>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return, // skip unreadable directories
    };

    for entry in entries.flatten() {
        let path = entry.path();

        // Skip symlinks to avoid cycles
        if path.is_symlink() {
            continue;
        }

        if path.is_dir() {
            if let Some(name) = path.file_name() {
                let name_str = name.to_string_lossy();
                // Skip hidden directories (names starting with '.')
                if name_str.starts_with('.') {
                    continue;
                }
                // Skip common dependency/artifact directories
                if is_skip_dir(&name_str) {
                    continue;
                }
            }
            scan_dir(root, &path, files);
        } else if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext = ext.to_string_lossy().to_lowercase();
                if ext == "md" || ext == "markdown" {
                    let relative = path
                        .strip_prefix(root)
                        .unwrap_or(&path)
                        .to_path_buf();
                    files.push((path, relative));
                }
            }
        }
    }
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn setup_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rut0markflow_test_{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ── Skip-dir tests ───────────────────────────────────────────

    #[test]
    fn test_skip_node_modules() {
        let dir = setup_test_dir("skip_node_modules");
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("node_modules/foo.md"), "").unwrap();
        fs::write(dir.join("readme.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 1);
        assert!(files[0].1.to_string_lossy().ends_with("readme.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_skip_target() {
        let dir = setup_test_dir("skip_target");
        fs::create_dir_all(dir.join("target")).unwrap();
        fs::write(dir.join("target/doc.md"), "").unwrap();
        fs::write(dir.join("guide.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 1);
        assert!(files[0].1.to_string_lossy().ends_with("guide.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_skip_dist() {
        let dir = setup_test_dir("skip_dist");
        fs::create_dir_all(dir.join("dist")).unwrap();
        fs::write(dir.join("dist/index.md"), "").unwrap();
        fs::write(dir.join("README.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 1);
        assert!(files[0].1.to_string_lossy().ends_with("README.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_skip_build_and_out() {
        let dir = setup_test_dir("skip_build_out");
        fs::create_dir_all(dir.join("build")).unwrap();
        fs::create_dir_all(dir.join("out")).unwrap();
        fs::write(dir.join("build/artifacts.md"), "").unwrap();
        fs::write(dir.join("out/logs.md"), "").unwrap();
        fs::write(dir.join("docs.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 1);
        assert!(files[0].1.to_string_lossy().ends_with("docs.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_skip_cache() {
        let dir = setup_test_dir("skip_cache");
        fs::create_dir_all(dir.join(".cache")).unwrap();
        fs::write(dir.join(".cache/cached.md"), "").unwrap();
        fs::write(dir.join("actual.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 1);
        assert!(files[0].1.to_string_lossy().ends_with("actual.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_skip_vendor_and_pycache() {
        let dir = setup_test_dir("skip_vendor_pycache");
        fs::create_dir_all(dir.join("vendor")).unwrap();
        fs::create_dir_all(dir.join("__pycache__")).unwrap();
        fs::write(dir.join("vendor/lib.md"), "").unwrap();
        fs::write(dir.join("__pycache__/compiled.md"), "").unwrap();
        fs::write(dir.join("source.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 1);
        assert!(files[0].1.to_string_lossy().ends_with("source.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_normal_subdirs_not_skipped() {
        let dir = setup_test_dir("normal_subdirs");
        fs::create_dir_all(dir.join("docs")).unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("docs/guide.md"), "").unwrap();
        fs::write(dir.join("src/index.md"), "").unwrap();
        fs::write(dir.join("root.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_skip_dir_name_not_path_contains() {
        // Ensure we only skip directories whose **name** matches,
        // not paths that merely *contain* the substring.
        let dir = setup_test_dir("skip_name_only");
        fs::create_dir_all(dir.join("mynode_modules_are_ok")).unwrap();
        fs::write(dir.join("mynode_modules_are_ok/doc.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    // ── Existing tests (unchanged) ───────────────────────────────

    #[test]
    fn test_empty_directory() {
        let dir = setup_test_dir("empty");
        let files = scan_markdown_files(&dir);
        assert!(files.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_only_md_files() {
        let dir = setup_test_dir("only_md");
        fs::write(dir.join("a.md"), "").unwrap();
        fs::write(dir.join("b.md"), "").unwrap();
        fs::write(dir.join("c.markdown"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_filter_non_md() {
        let dir = setup_test_dir("filter");
        fs::write(dir.join("readme.md"), "").unwrap();
        fs::write(dir.join("notes.txt"), "").unwrap();
        fs::write(dir.join("image.png"), "").unwrap();
        fs::write(dir.join("script.js"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 1);
        assert!(files[0].1.to_string_lossy().ends_with("readme.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_nested_directories() {
        let dir = setup_test_dir("nested");
        fs::create_dir_all(dir.join("sub1")).unwrap();
        fs::create_dir_all(dir.join("sub1/sub2")).unwrap();
        fs::write(dir.join("root.md"), "").unwrap();
        fs::write(dir.join("sub1/a.md"), "").unwrap();
        fs::write(dir.join("sub1/sub2/b.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 3);

        let rels: Vec<String> = files.iter().map(|(_, r)| r.to_string_lossy().to_string()).collect();
        assert!(rels.contains(&"root.md".to_string()));
        assert!(rels.contains(&"sub1/a.md".to_string()));
        assert!(rels.contains(&"sub1/sub2/b.md".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_skip_hidden_dirs() {
        let dir = setup_test_dir("hidden");
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join(".hidden/doc.md"), "").unwrap();
        fs::write(dir.join("visible.md"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 1);
        assert!(files[0].1.to_string_lossy().ends_with("visible.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_non_existent_path() {
        let p = PathBuf::from("/tmp/rut0markflow_test_nonexistent_xyz123");
        let files = scan_markdown_files(&p);
        assert!(files.is_empty());
    }

    #[test]
    fn test_case_insensitive_extension() {
        let dir = setup_test_dir("case_ext");
        fs::write(dir.join("lower.md"), "").unwrap();
        fs::write(dir.join("UPPER.MD"), "").unwrap();
        fs::write(dir.join("Mixed.Markdown"), "").unwrap();

        let files = scan_markdown_files(&dir);
        assert_eq!(files.len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_is_skip_dir_known() {
        assert!(is_skip_dir("node_modules"));
        assert!(is_skip_dir("target"));
        assert!(is_skip_dir("dist"));
        assert!(is_skip_dir("__pycache__"));
    }

    #[test]
    fn test_is_skip_dir_unknown_not_skipped() {
        assert!(!is_skip_dir("mynode_modules"));
        assert!(!is_skip_dir("src"));
        assert!(!is_skip_dir("docs"));
        assert!(!is_skip_dir("my_target"));
    }
}