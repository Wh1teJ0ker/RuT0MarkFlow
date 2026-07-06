use rut0markflow_lib::models::workspace::{IndexEntry, IndexTreeNode};
use rut0markflow_lib::modules::workspace::{indexer, scanner};
use std::path::PathBuf;
use std::time::Instant;

/// Integration benchmark for 1000+ Markdown file workspace scanning + indexing.
///
/// Run with:
///   cargo test pressure_bench -- --nocapture --test-threads=1
///
/// Set env PRESSURE_FILE_COUNT to override the number of files (default 1000).
/// Set env PRESSURE_KEEP=1 to keep the temp directory for inspection after test.
/// Set env PRESSURE_ROOT to benchmark an already-generated workspace.
const DEFAULT_FILE_COUNT: u64 = 1000;

fn normalize_sep(p: &str) -> String {
    p.replace('\\', "/")
}

/// Generate a flat workspace with `count` Markdown files in a temp directory.
/// Files are distributed across subdirectories to simulate real usage.
fn generate_workspace(count: u64) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("rut0markflow_pressure_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    // Create subdirectories for distribution
    let subdirs = [
        "docs",
        "docs/guides",
        "docs/api",
        "docs/tutorials",
        "notes",
        "notes/meetings",
        "notes/ideas",
        "reports",
        "reports/2024",
        "reports/2025",
        "wiki",
        "wiki/engineering",
        "wiki/design",
        "wiki/operations",
    ];

    for sub in &subdirs {
        std::fs::create_dir_all(dir.join(sub)).unwrap();
    }

    let all_locations: Vec<&str> = std::iter::once("")
        .chain(subdirs.iter().copied())
        .collect();

    for i in 0..count {
        let loc = all_locations[i as usize % all_locations.len()];
        let file_name = format!("doc_{:04}.md", i);
        let file_path = if loc.is_empty() {
            dir.join(&file_name)
        } else {
            dir.join(loc).join(&file_name)
        };
        // Write realistic content
        let content = format!(
            "# Document {}\n\nThis is a generated Markdown file for pressure testing.\n\n## Section 1\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n- Item {}\n- Item {}\n- Item {}\n\n## Section 2\n\nSee [link](../docs/guides/doc_{:04}.md) for more details.\n\n```rust\nfn hello() -> &'static str {{\n    \"Hello, world!\"\n}}\n```\n\n> This is a blockquote.\n\n| Col A | Col B |\n|-------|-------|\n| Value | Value |\n",
            i, i, i + 1, i + 2, (i + 1) % count
        );
        std::fs::write(&file_path, &content).unwrap();
    }

    eprintln!("[pressure_bench] Generated {} files in {:?}", count, dir);
    dir
}

#[test]
fn pressure_bench_scan_and_index() {
    let file_count_str = std::env::var("PRESSURE_FILE_COUNT").ok();
    let file_count: u64 = file_count_str
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_FILE_COUNT);

    assert!(file_count >= 100, "PRESSURE_FILE_COUNT should be >= 100 for meaningful benchmarks");

    let pressure_root = std::env::var("PRESSURE_ROOT").ok();
    let (dir, owns_dir) = if let Some(root) = pressure_root {
        (PathBuf::from(root), false)
    } else {
        (generate_workspace(file_count), true)
    };

    let keep = std::env::var("PRESSURE_KEEP").is_ok();

    // ── Phase 1: Scan ────────────────────────────────────────────
    let scan_start = Instant::now();
    let scanned = scanner::scan_markdown_files(&dir);
    let scan_duration = scan_start.elapsed();

    let actual_count = scanned.len() as u64;
    assert_eq!(
        actual_count, file_count,
        "Expected {} files, found {}",
        file_count, actual_count
    );

    // ── Phase 2: Build index tree ────────────────────────────────
    let entries: Vec<IndexEntry> = scanned
        .into_iter()
        .map(|(abs, rel)| {
            let name = abs
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let parent = rel
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = abs
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_else(|| "md".to_string());
            let (updated_at, size) = match abs.metadata() {
                Ok(meta) => (
                    meta.modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs().to_string()),
                    Some(meta.len()),
                ),
                Err(_) => (None, None),
            };
            let id = rel.to_string_lossy().to_string().replace('\\', "/");
            IndexEntry {
                id,
                name,
                absolute_path: abs.to_string_lossy().to_string(),
                relative_path: normalize_sep(&rel.to_string_lossy()),
                parent_relative_path: normalize_sep(&parent),
                extension: ext,
                updated_at,
                size,
            }
        })
        .collect();

    let index_start = Instant::now();
    let tree = indexer::build_index_tree(&entries);
    let index_duration = index_start.elapsed();

    // ── Phase 3: Verify tree structure ───────────────────────────
    let total_nodes = count_nodes(&tree);
    assert!(total_nodes >= file_count, "Tree should contain at least as many nodes as files");

    // ── Output results ───────────────────────────────────────────
    println!("\n=== Pressure Benchmark Results ===");
    println!("file_count: {}", actual_count);
    println!("scan_duration_ms: {:.2}", scan_duration.as_secs_f64() * 1000.0);
    println!("scan_duration_ns: {}", scan_duration.as_nanos());
    println!("index_duration_ms: {:.2}", index_duration.as_secs_f64() * 1000.0);
    println!("index_duration_ns: {}", index_duration.as_nanos());
    println!("total_duration_ms: {:.2}", (scan_duration + index_duration).as_secs_f64() * 1000.0);
    println!("tree_nodes: {}", total_nodes);
    println!("files_per_sec: {:.0}", actual_count as f64 / scan_duration.as_secs_f64());
    println!("conclusion: 扫描 + 索引构建完成，未崩溃");
    println!("keys: {}", tree.len());
    println!();

    // Determine quality tier
    let total_ms = (scan_duration + index_duration).as_secs_f64() * 1000.0;
    if total_ms < 500.0 {
        println!("quality: excellent (< 500ms for {} files)", actual_count);
    } else if total_ms < 2000.0 {
        println!("quality: acceptable (< 2s for {} files)", actual_count);
    } else if total_ms < 5000.0 {
        println!("quality: moderate (< 5s for {} files)", actual_count);
    } else {
        println!("quality: slow (>= 5s for {} files — consider optimization)", actual_count);
    }

    let file_size_mb = estimate_dir_size(&dir) as f64 / 1_048_576.0;
    println!("workspace_size_mb: {:.2}", file_size_mb);
    println!("=== End Pressure Benchmark ===\n");

    // Cleanup
    if !keep && owns_dir {
        let _ = std::fs::remove_dir_all(&dir);
        eprintln!("[pressure_bench] Cleaned up {:?}", dir);
    } else if keep && owns_dir {
        eprintln!("[pressure_bench] Keeping {:?} (PRESSURE_KEEP=1)", dir);
    } else {
        eprintln!("[pressure_bench] External workspace preserved {:?}", dir);
    }

    // Assert performance is acceptable (not hanging)
    assert!(
        total_ms < 30_000.0,
        "Scan + index took {:.0}ms — unexpectedly slow",
        total_ms
    );
}

fn count_nodes(nodes: &[IndexTreeNode]) -> u64 {
    let mut count = 0u64;
    for node in nodes {
        count += 1;
        if let Some(ref children) = node.children {
            count += count_nodes(children);
        }
    }
    count
}

fn estimate_dir_size(dir: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(meta) = path.metadata() {
                    total += meta.len();
                }
            } else if path.is_dir() {
                total += estimate_dir_size(&path);
            }
        }
    }
    total
}
