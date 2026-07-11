/**
 * Tests for SettingsPage component.
 *
 * Covers: rendering sections, theme toggle interaction,
 * version info display, Esc key close, back button close,
 * and update status display (idle/checking/available/unavailable/error/installing).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SettingsPage from "../SettingsPage";
import type { UpdateStatus } from "../../../types";

function renderSettings(
  overrides: Record<string, unknown> = {},
  updateStatus?: UpdateStatus,
) {
  const props = {
    theme: "light" as const,
    onToggleTheme: vi.fn(),
    onClose: vi.fn(),
    updateStatus: updateStatus ?? { type: "idle" },
    onCheckForUpdates: vi.fn(),
    onInstallUpdate: vi.fn(),
    ...overrides,
  };
  return render(<SettingsPage {...props} />);
}

describe("SettingsPage", () => {
  it("renders the settings page with header and sections", () => {
    renderSettings();
    expect(screen.getByText("设置")).toBeTruthy();
    expect(screen.getByText("外观")).toBeTruthy();
    expect(screen.getByText("关于")).toBeTruthy();
    expect(screen.getByText("更新")).toBeTruthy();
  });

  it("calls onClose when back button is clicked", () => {
    const onClose = vi.fn();
    renderSettings({ onClose });
    const backBtn = screen.getByText("返回").closest("button");
    expect(backBtn).toBeTruthy();
    fireEvent.click(backBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Esc key is pressed", () => {
    const onClose = vi.fn();
    renderSettings({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("highlights light theme button when theme is light", () => {
    renderSettings({ theme: "light" });
    const lightBtn = screen.getByText("浅色").closest("button");
    expect(lightBtn?.className).toContain("settings-theme-btn--active");
    const darkBtn = screen.getByText("深色").closest("button");
    expect(darkBtn?.className).not.toContain("settings-theme-btn--active");
  });

  it("highlights dark theme button when theme is dark", () => {
    renderSettings({ theme: "dark" });
    const darkBtn = screen.getByText("深色").closest("button");
    expect(darkBtn?.className).toContain("settings-theme-btn--active");
    const lightBtn = screen.getByText("浅色").closest("button");
    expect(lightBtn?.className).not.toContain("settings-theme-btn--active");
  });

  it("calls onToggleTheme when inactive theme button is clicked", () => {
    const onToggleTheme = vi.fn();
    renderSettings({ theme: "light", onToggleTheme });
    // Click dark button (inactive)
    const darkBtn = screen.getByText("深色").closest("button");
    fireEvent.click(darkBtn!);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("does not call onToggleTheme when active theme button is clicked", () => {
    const onToggleTheme = vi.fn();
    renderSettings({ theme: "light", onToggleTheme });
    // Click light button (already active)
    const lightBtn = screen.getByText("浅色").closest("button");
    fireEvent.click(lightBtn!);
    expect(onToggleTheme).not.toHaveBeenCalled();
  });

  it("displays version summary", () => {
    renderSettings();
    expect(screen.getByText(/App\s+\d+\.\d+\.\d+/)).toBeTruthy();
  });

  it("displays version details", () => {
    renderSettings();
    // VERSION_DETAILS contains "Release:" and "App:" lines
    expect(screen.getByText(/Release:/)).toBeTruthy();
    expect(screen.getByText(/App:/)).toBeTruthy();
  });

  // ── Update status tests ─────────────────────────────────────

  it("shows idle state with check button", () => {
    renderSettings({}, { type: "idle" });
    expect(screen.getByText("点击下方按钮检查更新")).toBeTruthy();
    expect(screen.getByText("检查更新")).toBeTruthy();
  });

  it("shows checking state and hides check button", () => {
    renderSettings({}, { type: "checking" });
    expect(screen.getByText("正在检查更新…")).toBeTruthy();
    expect(screen.queryByText("检查更新")).toBeNull();
  });

  it("shows installing state and hides check button", () => {
    renderSettings({}, { type: "installing" });
    expect(screen.getByText("正在下载并安装更新…")).toBeTruthy();
    expect(screen.queryByText("检查更新")).toBeNull();
  });

  it("shows unavailable state with '已是最新版本' and check button", () => {
    renderSettings({}, { type: "unavailable" });
    expect(screen.getByText("当前已是最新版本")).toBeTruthy();
    expect(screen.getByText("检查更新")).toBeTruthy();
  });

  it("shows available state with version, install button, and check button", () => {
    renderSettings(
      {},
      { type: "available", version: "0.2.0", notes: "New features" },
    );
    expect(screen.getByText(/发现新版本/)).toBeTruthy();
    // Version is rendered inside "发现新版本 v0.2.0" - check parent text
    expect(screen.getByText(/v0\.2\.0/)).toBeTruthy();
    expect(screen.getByText("安装更新")).toBeTruthy();
    expect(screen.getByText("检查更新")).toBeTruthy();
  });

  it("shows available state with notes when provided", () => {
    renderSettings(
      {},
      { type: "available", version: "0.2.0", notes: "Bug fixes\nPerformance" },
    );
    // Newline in notes is rendered as space in DOM; use regex to match flexibly
    expect(screen.getByText(/Bug fixes/)).toBeTruthy();
    expect(screen.getByText(/Performance/)).toBeTruthy();
  });

  it("shows error state with message and retry button", () => {
    renderSettings(
      {},
      { type: "error", message: "无法连接更新服务器" },
    );
    expect(screen.getByText("无法连接更新服务器")).toBeTruthy();
    expect(screen.getByText("重试")).toBeTruthy();
    expect(screen.getByText("检查更新")).toBeTruthy();
  });

  it("calls onCheckForUpdates when check button is clicked", () => {
    const onCheckForUpdates = vi.fn();
    renderSettings({ onCheckForUpdates }, { type: "idle" });
    const checkBtn = screen.getByText("检查更新").closest("button");
    fireEvent.click(checkBtn!);
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("calls onInstallUpdate when install button is clicked", () => {
    const onInstallUpdate = vi.fn();
    renderSettings(
      { onInstallUpdate },
      { type: "available", version: "0.2.0" },
    );
    const installBtn = screen.getByText("安装更新").closest("button");
    fireEvent.click(installBtn!);
    expect(onInstallUpdate).toHaveBeenCalledTimes(1);
  });

  it("calls onCheckForUpdates when retry button is clicked in error state", () => {
    const onCheckForUpdates = vi.fn();
    renderSettings(
      { onCheckForUpdates },
      { type: "error", message: "无法连接更新服务器" },
    );
    const retryBtn = screen.getByText("重试").closest("button");
    fireEvent.click(retryBtn!);
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });
});