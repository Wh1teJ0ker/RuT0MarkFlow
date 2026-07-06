import { FolderOpen, ArrowLeftRight, Loader2, Save, SaveAll, FilePlus2, Sun, Moon, X } from "lucide-react";
import type { ViewMode, WorkspaceState } from "../../types";

interface ToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSelectWorkspace: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onNewDocument: () => void;
  onCloseDocument: () => void;
  hasWorkspace: boolean;
  hasDocument: boolean;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isNew: boolean;
  workspaceState: WorkspaceState;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

function Toolbar({
  viewMode,
  onViewModeChange,
  onSelectWorkspace,
  onSave,
  onSaveAs,
  onNewDocument,
  onCloseDocument,
  hasWorkspace: _hasWorkspace,
  hasDocument,
  isDirty,
  isLoading,
  isSaving,
  isNew,
  workspaceState,
  theme,
  onToggleTheme,
}: ToolbarProps) {
  const otherMode: ViewMode =
    viewMode === "immersive-preview" ? "split-editor" : "immersive-preview";

  const currentModeLabel =
    viewMode === "immersive-preview" ? "沉浸预览" : "双栏编辑";

  const modeLabel =
    viewMode === "immersive-preview" ? "双栏编辑" : "无感预览";

  // Unified button disabled rules
  const wsReady = workspaceState === "ready";
  const canNew = wsReady && !isLoading;
  const canSave = (isDirty || isNew) && hasDocument && !isSaving;
  const canSaveAs = hasDocument && !isSaving;
  const canToggleMode = wsReady;

  return (
    <div className="toolbar-inner">
      {/* Left group */}
      <div className="toolbar-group toolbar-group--left">
        <button
          className="toolbar-btn"
          onClick={onSelectWorkspace}
          disabled={isLoading}
          title="选择工作区文件夹"
        >
          {isLoading ? (
            <Loader2 size={16} className="icon-spin" />
          ) : (
            <FolderOpen size={16} />
          )}
          打开工作区
        </button>
        <span className="toolbar-separator" />
        <button
          className="toolbar-btn"
          disabled={!canNew}
          onClick={onNewDocument}
          title="新建文档 (Cmd/Ctrl+N)"
        >
          <FilePlus2 size={16} />
          新建
        </button>
        <span className="toolbar-separator" />
        <span className="toolbar-current-mode">{currentModeLabel}</span>
        <button
          className="toolbar-btn"
          disabled={!canToggleMode}
          onClick={() => onViewModeChange(otherMode)}
          title={`切换至${modeLabel}模式`}
        >
          <ArrowLeftRight size={16} />
          {modeLabel}
        </button>
      </div>

      {/* Center group */}
      <div className="toolbar-group toolbar-group--center">
        <button
          className="toolbar-btn"
          disabled={!hasDocument}
          onClick={onCloseDocument}
          title="关闭当前文档 (Cmd/Ctrl+W)"
        >
          <X size={16} />
          关闭
        </button>
        <span className="toolbar-separator" />
        <button
          className="toolbar-btn toolbar-btn--save"
          disabled={!canSave}
          onClick={onSave}
          title={isNew ? "首次保存 — 将选择路径" : "保存 (Cmd/Ctrl+S)"}
        >
          {isSaving ? (
            <Loader2 size={16} className="icon-spin" />
          ) : (
            <Save size={16} />
          )}
          {isNew ? "首次保存" : "保存"}
        </button>
        <button
          className="toolbar-btn"
          disabled={!canSaveAs}
          onClick={onSaveAs}
          title="另存为 (Cmd/Ctrl+Shift+S)"
        >
          <SaveAll size={16} />
          另存为
        </button>
      </div>

      {/* Right group */}
      <div className="toolbar-group toolbar-group--right">
        <button
          className="toolbar-btn"
          onClick={onToggleTheme}
          title={theme === "light" ? "切换至深色模式" : "切换至浅色模式"}
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        <span className="toolbar-separator" />
        {isDirty && hasDocument && (
          <span className="toolbar-badge toolbar-badge--unsaved">
            未保存
          </span>
        )}
      </div>
    </div>
  );
}

export default Toolbar;