import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StatusBar from "../StatusBar";
import type { DocumentStatusDescriptor, UpdateStatus } from "../../../types";

function renderStatusBar(overrides: Record<string, unknown> = {}) {
  const defaultDocStatus: DocumentStatusDescriptor = {
    label: "",
    tone: "default",
    retryable: false,
  };

  const props = {
    message: "就绪",
    workspace: null,
    workspaceState: "idle" as const,
    fileCount: 0,
    docStatus: defaultDocStatus,
    viewMode: "split-editor" as const,
    documentTitle: null,
    versionSummary: "App 0.1.3 · UI 0.1.3 · Core 0.1.3",
    versionDetails: "Release: v0.1.3\nApp: 0.1.3",
    updateStatus: { type: "idle" } as UpdateStatus,
    onCheckForUpdates: vi.fn(),
    onInstallUpdate: vi.fn(),
    ...overrides,
  };

  return render(<StatusBar {...(props as any)} />);
}

describe("StatusBar update indicator", () => {
  it("renders '检查更新' button when onCheckForUpdates is provided", () => {
    renderStatusBar();
    const checkBtn = screen.getByText("检查更新");
    expect(checkBtn).toBeTruthy();
  });

  it("renders update-available indicator when updateStatus is available", () => {
    renderStatusBar({
      updateStatus: { type: "available", version: "0.1.4", notes: "Bug fixes" },
    });
    const updateText = screen.getByText(/有新版本/);
    expect(updateText).toBeTruthy();
    expect(updateText.textContent).toContain("v0.1.4");
  });

  it("clicking update-available indicator triggers onInstallUpdate", () => {
    const onInstallUpdate = vi.fn();
    renderStatusBar({
      updateStatus: { type: "available", version: "0.1.4" },
      onInstallUpdate,
    });
    const updateText = screen.getByText(/有新版本/);
    fireEvent.click(updateText);
    expect(onInstallUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not render update-available indicator when updateStatus is idle", () => {
    renderStatusBar({ updateStatus: { type: "idle" } });
    expect(screen.queryByText(/有新版本/)).toBeNull();
  });

  it("does not render update-available indicator when updateStatus is unavailable", () => {
    renderStatusBar({ updateStatus: { type: "unavailable" } });
    expect(screen.queryByText(/有新版本/)).toBeNull();
  });

  it("shows checking state text when updateStatus is checking", () => {
    renderStatusBar({ updateStatus: { type: "checking" } });
    expect(screen.getByText("检查中…")).toBeTruthy();
  });
});