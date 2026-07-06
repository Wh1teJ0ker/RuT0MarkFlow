import { Folder, FolderOpen, AlertCircle, Loader2, FileText, ArrowDownAZ } from "lucide-react";
import { useState, useCallback } from "react";
import IndexTree from "./IndexTree";
import type { WorkspaceInfo, WorkspaceState, AppErrorPayload, IndexTreeNode } from "../../types";

interface SidebarProps {
  workspace: WorkspaceInfo | null;
  workspaceState: WorkspaceState;
  workspaceError: AppErrorPayload | null;
  fileCount: number;
  indexTree: IndexTreeNode[];
  onOpenDocument: (relativePath: string) => void;
  activeDocumentRelativePath: string | null;
  onSelectWorkspace: () => void;
}

/**
 * Sidebar — Workspace index / file tree area.
 *
 * Manages directory expand state externally from IndexTree so that
 * watcher-triggered index-tree replacements don't collapse expanded directories.
 *
 * States:
 *   idle    → placeholder prompt to open a workspace
 *   loading → spinner while scanning
 *   ready   → workspace name + IndexTree
 *   error   → error message
 */
function Sidebar({
  workspace,
  workspaceState,
  workspaceError,
  fileCount,
  indexTree,
  onOpenDocument,
  activeDocumentRelativePath,
  onSelectWorkspace,
}: SidebarProps) {
  // Track expanded directory IDs as a Set<string> so the state survives
  // indexTree reference changes (watcher refresh re-creates the tree).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleToggleExpand = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // ── idle: no workspace ──────────────────────────────────────
  if (workspaceState === "idle") {
    return (
      <div className="sidebar-placeholder">
        <FolderOpen size={32} className="sidebar-placeholder-icon" />
        <p className="sidebar-placeholder-text">尚未打开工作区</p>
        <p className="sidebar-placeholder-hint">
          点击顶部工具栏「打开工作区」开始
        </p>
      </div>
    );
  }

  // ── loading: scanning in progress ───────────────────────────
  if (workspaceState === "loading") {
    return (
      <div className="sidebar-loading">
        <Loader2 size={24} className="icon-spin" />
        <p className="sidebar-placeholder-text">正在扫描工作区…</p>
      </div>
    );
  }

  // ── error: workspace load failed ────────────────────────────
  if (workspaceState === "error") {
    return (
      <div className="sidebar-placeholder">
        <AlertCircle size={32} className="sidebar-placeholder-icon" />
        <p className="sidebar-placeholder-text">工作区加载失败</p>
        <p className="sidebar-placeholder-hint">
          {workspaceError?.message || "未知错误"}
        </p>
        <button className="sidebar-retry-btn" onClick={onSelectWorkspace}>
          重新选择工作区
        </button>
      </div>
    );
  }

  // ── ready: workspace loaded ─────────────────────────────────
  if (!workspace) {
    return null;
  }

  return (
    <div className="sidebar-loaded">
      <div className="sidebar-header">
        <Folder size={14} className="sidebar-header-icon" />
        <span className="sidebar-workspace-name">{workspace.displayName}</span>
      </div>
      <div className="sidebar-summary">
        <FileText size={14} className="sidebar-summary-icon" />
        <span className="sidebar-summary-count">{fileCount} 个 Markdown 文件</span>
        <span className="sidebar-sort-hint" title="当前排序：目录优先 + 字母序">
          <ArrowDownAZ size={11} /> 目录·字母序
        </span>
      </div>
      {/* Index tree */}
      <div className="sidebar-tree-container">
        <IndexTree
          nodes={indexTree}
          onOpenDocument={onOpenDocument}
          activePath={activeDocumentRelativePath}
          expandedIds={expandedIds}
          onToggleExpand={handleToggleExpand}
        />
        {indexTree.length === 0 && (
          <div className="sidebar-tree-empty">
            工作区中未找到 .md / .markdown 文件
          </div>
        )}
      </div>
    </div>
  );
}

export default Sidebar;