/**
 * Tests for StatusBar component state display.
 *
 * Covers: idle/loading/ready/error states,
 * mode display, save state, doc title, workspace info.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusBar from "../../components/statusbar/StatusBar";

const base = {
  message: "就绪",
  workspace: null,
  workspaceState: "idle" as const,
  fileCount: 0,
  docStatus: {
    label: "",
    tone: "default" as const,
    retryable: false,
  },
  viewMode: "split-editor" as const,
  documentTitle: null,
  versionSummary: undefined,
  versionDetails: undefined,
};

describe("StatusBar state display", () => {
  it("shows 无文档 and 未选择 for idle state", () => {
    render(<StatusBar {...base} />);
    expect(screen.getByText("无文档")).toBeTruthy();
    expect(screen.getByText("未选择")).toBeTruthy(); // index label
  });

  it("shows 扫描中… during loading", () => {
    render(<StatusBar {...base} workspaceState="loading" />);
    expect(screen.getByText("扫描中…")).toBeTruthy();
  });

  it("shows file count when ready", () => {
    render(<StatusBar {...base} workspaceState="ready" fileCount={5} workspace={{ rootPath: "/ws", displayName: "ws", isAvailable: true, fileCount: 5 }} />);
    expect(screen.getByText("5 文件")).toBeTruthy();
  });

  it("shows 错误 for error state", () => {
    render(<StatusBar {...base} workspaceState="error" />);
    expect(screen.getByText("错误")).toBeTruthy();
  });

  it("shows mode label", () => {
    render(<StatusBar {...base} viewMode="immersive-preview" />);
    expect(screen.getByText("沉浸预览")).toBeTruthy();
  });

  it("shows 双栏编辑 for split-editor mode", () => {
    render(<StatusBar {...base} viewMode="split-editor" />);
    expect(screen.getByText("双栏编辑")).toBeTruthy();
  });

  it("shows document title when provided", () => {
    render(<StatusBar {...base} documentTitle="readme.md" />);
    expect(screen.getByText("readme.md")).toBeTruthy();
  });

  it("shows render error count", () => {
    render(<StatusBar {...base} renderErrorCount={3} />);
    expect(screen.getByText("3 错误")).toBeTruthy();
  });

  it("shows version summary when provided", () => {
    render(
      <StatusBar
        {...base}
        versionSummary="App current · UI current · Core current"
        versionDetails={"Release: current\nApp: current"}
      />,
    );
    expect(screen.getByText("App current · UI current · Core current")).toBeTruthy();
  });
});
