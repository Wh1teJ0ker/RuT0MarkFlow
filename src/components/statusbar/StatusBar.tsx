import { Folder, File, Monitor, Save, AlertTriangle, RefreshCw, AlertCircle, RotateCcw, Layers3 } from "lucide-react";
import type {
  DocumentStatusDescriptor,
  WorkspaceInfo,
  WorkspaceState,
  ViewMode,
} from "../../types";

interface StatusBarProps {
  message: string;
  workspace: WorkspaceInfo | null;
  workspaceState: WorkspaceState;
  fileCount: number;
  docStatus: DocumentStatusDescriptor;
  renderErrorCount?: number;
  viewMode: ViewMode;
  documentTitle: string | null;
  versionSummary?: string;
  versionDetails?: string;
  onRetrySave?: () => void;
}

function StatusBar({
  message,
  workspace,
  workspaceState,
  fileCount,
  docStatus,
  renderErrorCount = 0,
  viewMode,
  documentTitle,
  versionSummary,
  versionDetails,
  onRetrySave,
}: StatusBarProps) {
  const isError = workspaceState === "error";

  const viewModeLabel = viewMode === "immersive-preview" ? "沉浸预览" : "双栏编辑";
  const indexLabel = workspaceState === "loading" ? "扫描中…" :
    workspaceState === "ready" ? `${fileCount} 文件` :
    workspaceState === "error" ? "错误" : "未选择";
  const docStatusClassName = [
    "statusbar-doc-status",
    docStatus.tone === "error" ? "statusbar-doc-status--error" : "",
    docStatus.tone === "dirty" ? "statusbar-doc-status--dirty" : "",
    docStatus.tone === "saving" ? "statusbar-doc-status--saving" : "",
    docStatus.retryable && onRetrySave ? "statusbar-doc-status--clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="statusbar-inner">
      {/* ── Left: message ─────────────────────────────────────── */}
      <span className="statusbar-message">
        {isError && <AlertCircle size={12} className="statusbar-icon statusbar-icon--error" />}
        {message}
      </span>

      {/* ── Render errors ──────────────────────────────────────── */}
      {renderErrorCount > 0 && (
        <span className="statusbar-render-errors" title={`${renderErrorCount} 个渲染错误`}>
          <AlertTriangle size={11} />
          {renderErrorCount} 错误
        </span>
      )}

      {/* ── Document title ─────────────────────────────────────── */}
      <span className="statusbar-segment" title={documentTitle ?? undefined}>
        <File size={11} className="statusbar-segment-icon" />
        {documentTitle || "无文档"}
      </span>

      {/* ── Save state ─────────────────────────────────────────── */}
      {docStatus.label && (
        <span
          className={docStatusClassName}
          onClick={docStatus.retryable ? onRetrySave : undefined}
          role={docStatus.retryable && onRetrySave ? "button" : undefined}
          title={docStatus.retryable && docStatus.retryLabel ? `点击${docStatus.retryLabel}` : undefined}
        >
          <Save size={11} />
          {docStatus.label}
          {docStatus.retryable && onRetrySave && (
            <RotateCcw size={12} className="statusbar-retry-icon" />
          )}
        </span>
      )}

      {/* ── Spacer ─────────────────────────────────────────────── */}
      <span className="statusbar-spacer" />

      {/* ── Index state ────────────────────────────────────────── */}
      <span className="statusbar-segment" title="索引状态">
        <RefreshCw size={11} className={`statusbar-segment-icon ${workspaceState === "loading" ? "icon-spin" : ""}`} />
        {indexLabel}
      </span>

      {/* ── View mode ──────────────────────────────────────────── */}
      <span className="statusbar-segment" title="当前模式">
        <Monitor size={11} className="statusbar-segment-icon" />
        {viewModeLabel}
      </span>

      {/* ── Versions ───────────────────────────────────────────── */}
      {versionSummary && (
        <span className="statusbar-segment statusbar-version" title={versionDetails ?? versionSummary}>
          <Layers3 size={11} className="statusbar-segment-icon" />
          {versionSummary}
        </span>
      )}

      {/* ── Workspace ──────────────────────────────────────────── */}
      {workspace && workspaceState === "ready" && (
        <span className="statusbar-info" title={workspace.rootPath}>
          <Folder size={12} className="statusbar-icon" />
          {workspace.displayName}
        </span>
      )}
    </div>
  );
}

export default StatusBar;
