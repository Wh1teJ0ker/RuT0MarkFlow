import { useEffect } from "react";
import { ArrowLeft, Moon, Sun, RefreshCw, ArrowUpCircle, AlertCircle, CheckCircle } from "lucide-react";
import { VERSION_SUMMARY, VERSION_DETAILS } from "../../version";
import type { UpdateStatus } from "../../types";

interface SettingsPageProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onClose: () => void;
  updateStatus: UpdateStatus;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
}

/**
 * SettingsPage — Standalone settings page rendered in the main content area.
 *
 * Sections:
 *  - 外观 (Appearance): theme toggle (light/dark)
 *  - 关于 (About): version info via VERSION_SUMMARY / VERSION_DETAILS
 *  - 更新 (Updates): update check, install, and status display
 */
function SettingsPage({
  theme,
  onToggleTheme,
  onClose,
  updateStatus,
  onCheckForUpdates,
  onInstallUpdate,
}: SettingsPageProps) {
  // ── Esc key closes settings ──────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="settings-page">
      {/* Header with back button */}
      <div className="settings-header">
        <button
          className="settings-back-btn"
          onClick={onClose}
          title="返回编辑器 (Esc)"
        >
          <ArrowLeft size={18} />
          返回
        </button>
        <h2 className="settings-title">设置</h2>
      </div>

      <div className="settings-body">
        {/* ── Appearance section ────────────────────────────── */}
        <section className="settings-section">
          <h3 className="settings-section-title">外观</h3>
          <div className="settings-row">
            <span className="settings-label">主题</span>
            <div className="settings-theme-toggle">
              <button
                className={`settings-theme-btn${theme === "light" ? " settings-theme-btn--active" : ""}`}
                onClick={() => {
                  if (theme !== "light") onToggleTheme();
                }}
                title="浅色模式"
              >
                <Sun size={16} />
                浅色
              </button>
              <button
                className={`settings-theme-btn${theme === "dark" ? " settings-theme-btn--active" : ""}`}
                onClick={() => {
                  if (theme !== "dark") onToggleTheme();
                }}
                title="深色模式"
              >
                <Moon size={16} />
                深色
              </button>
            </div>
          </div>
        </section>

        {/* ── About section ─────────────────────────────────── */}
        <section className="settings-section">
          <h3 className="settings-section-title">关于</h3>
          <div className="settings-about-info">
            <p className="settings-about-summary">{VERSION_SUMMARY}</p>
            <pre className="settings-about-details">{VERSION_DETAILS}</pre>
          </div>
        </section>

        {/* ── Updates section ──────────────────────────────────── */}
        <section className="settings-section">
          <h3 className="settings-section-title">更新</h3>
          <div className="settings-updates-content">
            {/* Status message */}
            {updateStatus.type === "idle" && (
              <p className="settings-updates-idle">点击下方按钮检查更新</p>
            )}

            {updateStatus.type === "checking" && (
              <p className="settings-updates-status">
                <RefreshCw size={14} className="icon-spin settings-updates-icon" />
                正在检查更新…
              </p>
            )}

            {updateStatus.type === "installing" && (
              <p className="settings-updates-status">
                <RefreshCw size={14} className="icon-spin settings-updates-icon" />
                正在下载并安装更新…
              </p>
            )}

            {updateStatus.type === "unavailable" && (
              <p className="settings-updates-status settings-updates-status--ok">
                <CheckCircle size={14} className="settings-updates-icon" />
                当前已是最新版本
              </p>
            )}

            {updateStatus.type === "available" && (
              <div className="settings-updates-available">
                <p className="settings-updates-status">
                  <ArrowUpCircle size={14} className="settings-updates-icon" />
                  发现新版本 v{updateStatus.version}
                </p>
                {updateStatus.notes && (
                  <p className="settings-updates-notes">{updateStatus.notes}</p>
                )}
                <button
                  className="settings-updates-install-btn"
                  onClick={onInstallUpdate}
                >
                  <ArrowUpCircle size={14} />
                  安装更新
                </button>
              </div>
            )}

            {updateStatus.type === "error" && (
              <div className="settings-updates-error">
                <p className="settings-updates-status settings-updates-status--error">
                  <AlertCircle size={14} className="settings-updates-icon" />
                  {updateStatus.message}
                </p>
                <button
                  className="settings-updates-retry-btn"
                  onClick={onCheckForUpdates}
                >
                  <RefreshCw size={14} />
                  重试
                </button>
              </div>
            )}

            {/* Check button (hidden when checking/installing) */}
            {updateStatus.type !== "checking" && updateStatus.type !== "installing" && (
              <button
                className="settings-updates-check-btn"
                onClick={onCheckForUpdates}
              >
                <RefreshCw size={14} />
                检查更新
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default SettingsPage;