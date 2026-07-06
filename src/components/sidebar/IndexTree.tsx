import { ChevronRight, ChevronDown, File, FileText } from "lucide-react";
import { useCallback } from "react";
import type { IndexTreeNode } from "../../types";

interface IndexTreeProps {
  nodes: IndexTreeNode[];
  onOpenDocument: (relativePath: string) => void;
  activePath: string | null;
  /** Set of node IDs for directories that should be expanded. */
  expandedIds: Set<string>;
  /** Called when a directory is toggled (expand/collapse). */
  onToggleExpand: (nodeId: string) => void;
}

/**
 * IndexTree — Recursively renders a tree of IndexTreeNode items.
 *
 * Directories are collapsible (click toggles expand/collapse).
 * Expand state is managed externally via `expandedIds` / `onToggleExpand`
 * so it survives index-tree re-renders (e.g. after watcher-triggered refresh).
 */
function IndexTree({ nodes, onOpenDocument, activePath, expandedIds, onToggleExpand }: IndexTreeProps) {
  return (
    <div className="index-tree">
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          onOpenDocument={onOpenDocument}
          activePath={activePath}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </div>
  );
}

// ── TreeNode ─────────────────────────────────────────────────────

interface TreeNodeProps {
  node: IndexTreeNode;
  onOpenDocument: (relativePath: string) => void;
  activePath: string | null;
  expandedIds: Set<string>;
  onToggleExpand: (nodeId: string) => void;
}

function TreeNode({
  node,
  onOpenDocument,
  activePath,
  expandedIds,
  onToggleExpand,
}: TreeNodeProps) {
  const isDirectory = node.type === "directory";
  const hasChildren =
    isDirectory && node.children && node.children.length > 0;

  const isExpanded = isDirectory && expandedIds.has(node.id);

  const isActive =
    !isDirectory && node.entry?.relativePath === activePath;

  const handleToggle = useCallback(() => {
    if (isDirectory) {
      onToggleExpand(node.id);
    }
  }, [isDirectory, node.id, onToggleExpand]);

  const handleFileClick = useCallback(() => {
    if (!isDirectory && node.entry) {
      onOpenDocument(node.entry.relativePath);
    }
  }, [isDirectory, node.entry, onOpenDocument]);

  return (
    <div className="tree-node">
      {/* ── Node row ─────────────────────────────────────────── */}
      <div
        className={`tree-node-row ${
          isDirectory ? "tree-node-row--dir" : "tree-node-row--file"
        } ${isActive ? "tree-node-row--active" : ""}`}
        onClick={isDirectory ? handleToggle : handleFileClick}
        role={isDirectory ? "treeitem" : "button"}
        tabIndex={0}
        title={
          isDirectory
            ? isExpanded
              ? "折叠目录"
              : "展开目录"
            : node.entry?.relativePath
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isDirectory) handleToggle();
            else handleFileClick();
          }
        }}
      >
        {/* Expand/collapse icon for directories */}
        <span className="tree-node-icon tree-node-icon--toggle">
          {isDirectory ? (
            hasChildren ? (
              isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )
            ) : (
              <span className="tree-node-icon--spacer" />
            )
          ) : (
            <span className="tree-node-icon--spacer" />
          )}
        </span>

        {/* File/directory icon */}
        <span className="tree-node-icon tree-node-icon--type">
          {isDirectory ? (
            // Use a small folder indicator in the icon area
            <span />
          ) : isActive ? (
            <FileText size={14} />
          ) : (
            <File size={14} />
          )}
        </span>

        {/* Name */}
        <span
          className={`tree-node-label ${isActive ? "tree-node-label--active" : ""}`}
        >
          {node.name}
        </span>
      </div>

      {/* ── Children (if expanded) ───────────────────────────── */}
      {isDirectory && isExpanded && hasChildren && (
        <div className="tree-node-children">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              onOpenDocument={onOpenDocument}
              activePath={activePath}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default IndexTree;