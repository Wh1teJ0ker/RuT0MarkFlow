use std::collections::{HashMap, HashSet};
use crate::models::workspace::{IndexEntry, IndexTreeNode};

/// Build a sorted `IndexTreeNode` tree from a flat list of `IndexEntry` items.
///
/// ## Path separator assumption
///
/// **IMPORTANT**: This function and its helper `build_children` assume that all
/// `parent_relative_path` and `relative_path` fields use forward slashes (`/`)
/// as the path separator. This is enforced by the `normalize_sep` call in
/// `commands/workspace.rs` (the `build_workspace_result` path) and
/// `commands/workspace.rs:run_scan`. Any new entry point that constructs
/// `IndexEntry` values with relative paths **must** also call `normalize_sep`
/// (or equivalent) to convert backslashes to forward slashes before passing
/// them to `build_index_tree`; otherwise the `split('/')` / `contains('/')` /
/// `rsplit('/')` calls in this file will fail to detect directory boundaries
/// on Windows.
///
/// Algorithm:
/// 1. Collect all unique directory paths from entries' `parent_relative_path`.
/// 2. Group entries by their parent directory.
/// 3. Recursively build tree: for each directory, collect its immediate
///    subdirectories and file entries, then recurse into subdirectories.
///
/// Ordering: directories before files, alphabetical within each group.
/// IDs: directories use `"dir:<relative_path>"`, files use the entry's own ID.
pub fn build_index_tree(entries: &[IndexEntry]) -> Vec<IndexTreeNode> {
    // ── Step 1: Collect all directory paths ─────────────────────
    let mut all_dir_paths: HashSet<String> = HashSet::new();
    for entry in entries {
        let parent = &entry.parent_relative_path;
        if !parent.is_empty() && parent != "." {
            let mut acc = String::new();
            for part in parent.split('/') {
                if !acc.is_empty() {
                    acc.push('/');
                }
                acc.push_str(part);
                all_dir_paths.insert(acc.clone());
            }
        }
    }

    // ── Step 2: Group entries by parent directory ──────────────
    let mut entries_by_parent: HashMap<String, Vec<IndexEntry>> = HashMap::new();
    for entry in entries {
        let key = if entry.parent_relative_path.is_empty()
            || entry.parent_relative_path == "."
        {
            String::new() // root level
        } else {
            entry.parent_relative_path.clone()
        };
        entries_by_parent.entry(key).or_default().push(entry.clone());
    }

    // ── Step 3: Build tree recursively from root ───────────────
    build_children("", &all_dir_paths, &entries_by_parent)
}

/// Recursively collect children (subdirectories + files) for `dir_path`.
fn build_children(
    dir_path: &str,
    all_dirs: &HashSet<String>,
    entries_by_parent: &HashMap<String, Vec<IndexEntry>>,
) -> Vec<IndexTreeNode> {
    let mut children: Vec<IndexTreeNode> = Vec::new();

    let prefix = if dir_path.is_empty() {
        String::new()
    } else {
        format!("{}/", dir_path)
    };

    // ── Immediate subdirectories (path starts with prefix, no further '/') ──
    let mut subdirs: Vec<&String> = all_dirs
        .iter()
        .filter(|d| {
            if let Some(rest) = d.strip_prefix(&prefix) {
                !rest.is_empty() && !rest.contains('/')
            } else {
                false
            }
        })
        .collect();
    subdirs.sort();

    for subdir in subdirs {
        let name = subdir.rsplit('/').next().unwrap_or(subdir.as_str());
        let id = format!("dir:{}", subdir);
        let sub_children = build_children(subdir, all_dirs, entries_by_parent);

        children.push(IndexTreeNode {
            id,
            name: name.to_string(),
            node_type: "directory".to_string(),
            relative_path: subdir.clone(),
            children: Some(sub_children),
            entry: None,
        });
    }

    // ── File entries that belong directly to this directory ─────
    if let Some(file_entries) = entries_by_parent.get(dir_path) {
        let mut file_nodes: Vec<IndexTreeNode> = file_entries
            .iter()
            .map(|entry| IndexTreeNode {
                id: entry.id.clone(),
                name: entry.name.clone(),
                node_type: "file".to_string(),
                relative_path: entry.relative_path.clone(),
                children: None,
                entry: Some(entry.clone()),
            })
            .collect();
        file_nodes.sort_by(|a, b| a.name.cmp(&b.name));
        children.extend(file_nodes);
    }

    children
}

// ── Unit tests ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::workspace::IndexEntry;

    fn make_entry(rel: &str, parent: &str) -> IndexEntry {
        IndexEntry {
            id: rel.to_string(),
            name: rel.rsplit('/').next().unwrap_or(rel).to_string(),
            absolute_path: format!("/root/{}", rel),
            relative_path: rel.to_string(),
            parent_relative_path: parent.to_string(),
            extension: "md".to_string(),
            updated_at: None,
            size: None,
        }
    }

    #[test]
    fn test_empty_list() {
        let tree = build_index_tree(&[]);
        assert!(tree.is_empty());
    }

    #[test]
    fn test_flat_files_only() {
        let entries = vec![
            make_entry("a.md", ""),
            make_entry("b.md", ""),
            make_entry("c.md", "."),
        ];
        let tree = build_index_tree(&entries);
        assert_eq!(tree.len(), 3);
        // alphabetical order
        assert_eq!(tree[0].name, "a.md");
        assert_eq!(tree[1].name, "b.md");
        assert_eq!(tree[2].name, "c.md");
        // all should be files
        for node in &tree {
            assert_eq!(node.node_type, "file");
        }
    }

    #[test]
    fn test_single_nested() {
        let entries = vec![
            make_entry("sub/a.md", "sub"),
        ];
        let tree = build_index_tree(&entries);
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].node_type, "directory");
        assert_eq!(tree[0].name, "sub");
        let children = tree[0].children.as_ref().unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].name, "a.md");
        assert_eq!(children[0].node_type, "file");
    }

    #[test]
    fn test_multi_level_nested() {
        let entries = vec![
            make_entry("a.md", ""),
            make_entry("x/y/z.md", "x/y"),
            make_entry("x/y/a.md", "x/y"),
            make_entry("x/b.md", "x"),
        ];
        let tree = build_index_tree(&entries);
        assert_eq!(tree.len(), 2); // a.md + x/

        // Root: directory before file
        assert_eq!(tree[0].node_type, "directory");
        assert_eq!(tree[0].name, "x");
        assert_eq!(tree[1].name, "a.md");

        // x/ has b.md + y/
        let x_children = tree[0].children.as_ref().unwrap();
        assert_eq!(x_children.len(), 2);
        assert_eq!(x_children[0].node_type, "directory");
        assert_eq!(x_children[0].name, "y");
        assert_eq!(x_children[1].name, "b.md");

        // x/y/ has a.md + z.md
        let y_children = x_children[0].children.as_ref().unwrap();
        assert_eq!(y_children.len(), 2);
        assert_eq!(y_children[0].name, "a.md");
        assert_eq!(y_children[1].name, "z.md");
    }

    #[test]
    fn test_sorting_dirs_before_files() {
        let entries = vec![
            make_entry("alpha.md", ""),
            make_entry("beta.md", "zeta"),
            make_entry("gamma.md", "zeta"),
            make_entry("delta.md", ""),
        ];
        let tree = build_index_tree(&entries);
        // zeta/ dir should come before alpha.md and delta.md
        assert_eq!(tree[0].node_type, "directory");
        assert_eq!(tree[0].name, "zeta");
        assert_eq!(tree[1].name, "alpha.md");
        assert_eq!(tree[2].name, "delta.md");

        // Inside zeta/: beta.md, gamma.md (alphabetical)
        let zeta_children = tree[0].children.as_ref().unwrap();
        assert_eq!(zeta_children.len(), 2);
        assert_eq!(zeta_children[0].name, "beta.md");
        assert_eq!(zeta_children[1].name, "gamma.md");
    }

    #[test]
    fn test_empty_directory_not_lost() {
        // If a directory path appears as parent but has no files
        // directly in it, it should still appear (with empty children)
        // if subdirectories exist.
        let entries = vec![
            make_entry("top/mid/bottom.md", "top/mid"),
        ];
        let tree = build_index_tree(&entries);
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "top");

        let top_children = tree[0].children.as_ref().unwrap();
        assert_eq!(top_children.len(), 1);
        assert_eq!(top_children[0].name, "mid");

        let mid_children = top_children[0].children.as_ref().unwrap();
        assert_eq!(mid_children.len(), 1);
        assert_eq!(mid_children[0].name, "bottom.md");
    }

    #[test]
    fn test_sort_stability() {
        // Multiple calls with same data should yield same order
        let entries = vec![
            make_entry("z/a.md", "z"),
            make_entry("a/b.md", "a"),
            make_entry("m.md", ""),
        ];
        let tree1 = build_index_tree(&entries);
        let tree2 = build_index_tree(&entries);

        fn flatten_names(nodes: &[IndexTreeNode]) -> Vec<String> {
            let mut result = Vec::new();
            for node in nodes {
                result.push(node.name.clone());
                if let Some(ref children) = node.children {
                    result.extend(flatten_names(children));
                }
            }
            result
        }

        assert_eq!(flatten_names(&tree1), flatten_names(&tree2));
    }

    #[test]
    fn test_ids_are_stable() {
        let entries = vec![
            make_entry("a/b.md", "a"),
            make_entry("a/c.md", "a"),
        ];
        let tree1 = build_index_tree(&entries);
        let tree2 = build_index_tree(&entries);

        fn collect_ids(nodes: &[IndexTreeNode]) -> Vec<String> {
            let mut result = Vec::new();
            for node in nodes {
                result.push(node.id.clone());
                if let Some(ref children) = node.children {
                    result.extend(collect_ids(children));
                }
            }
            result
        }

        assert_eq!(collect_ids(&tree1), collect_ids(&tree2));
    }
}