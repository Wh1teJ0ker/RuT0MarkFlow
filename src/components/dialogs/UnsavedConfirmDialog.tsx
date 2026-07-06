import { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, Save, X, LogOut } from "lucide-react";
import type { DialogAction } from "../../types";

interface UnsavedConfirmDialogProps {
  open: boolean;
  onAction: (action: DialogAction) => void;
}

/**
 * UnsavedConfirmDialog — Modal dialog for unsaved changes.
 *
 * Three options:
 *  - "Save & Continue": saves then proceeds
 *  - "Don't Save & Continue": discards changes and proceeds
 *  - "Cancel": keeps current state, does nothing
 *
 * Keyboard: Enter → save, Esc → cancel.
 * Focus is trapped inside the dialog when open.
 */
function UnsavedConfirmDialog({ open, onAction }: UnsavedConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the dialog on open
  useEffect(() => {
    if (open && dialogRef.current) {
      const firstBtn = dialogRef.current.querySelector("button");
      firstBtn?.focus();
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onAction("cancel");
      } else if (e.key === "Enter") {
        e.preventDefault();
        onAction("save");
      }
    },
    [onAction],
  );

  if (!open) return null;

  return (
    <div
      className="dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onAction("cancel");
      }}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="未保存的修改"
    >
      <div className="dialog-panel" ref={dialogRef}>
        <div className="dialog-header">
          <AlertTriangle size={20} className="dialog-header-icon" />
          <span className="dialog-title">未保存的修改</span>
        </div>

        <p className="dialog-body">
          当前文档有未保存的修改。在继续之前，您希望如何处理？
        </p>

        <div className="dialog-actions">
          <button
            className="dialog-btn dialog-btn--save"
            onClick={() => onAction("save")}
            title="保存后继续"
          >
            <Save size={16} />
            保存并继续
          </button>

          <button
            className="dialog-btn dialog-btn--discard"
            onClick={() => onAction("discard")}
            title="放弃修改并继续"
          >
            <X size={16} />
            不保存并继续
          </button>

          <button
            className="dialog-btn dialog-btn--cancel"
            onClick={() => onAction("cancel")}
            title="取消操作，保持当前状态"
          >
            <LogOut size={16} />
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export default UnsavedConfirmDialog;