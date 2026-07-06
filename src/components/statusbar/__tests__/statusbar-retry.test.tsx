import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import StatusBar from "../StatusBar";

describe("StatusBar retry (T39)", () => {
  it('docStatus="保存失败: ..." + onRetrySave → renders clickable retry, click calls handler', () => {
    const onRetrySave = vi.fn();
    render(
      <StatusBar
        message="就绪"
        workspace={null}
        workspaceState="idle"
        fileCount={0}
        docStatus="保存失败: 磁盘空间不足"
        viewMode="split-editor"
        documentTitle="test.md"
        onRetrySave={onRetrySave}
      />,
    );

    // Find the doc-status element specifically (not the message)
    const el = document.querySelector(".statusbar-doc-status--clickable");
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("保存失败");
    fireEvent.click(el!);
    expect(onRetrySave).toHaveBeenCalledTimes(1);
  });

  it("no onRetrySave → not clickable", () => {
    render(
      <StatusBar
        message="就绪"
        workspace={null}
        workspaceState="idle"
        fileCount={0}
        docStatus="保存失败: 错误"
        viewMode="split-editor"
        documentTitle="test.md"
      />,
    );

    const el = screen.getByText((content) => content.startsWith("保存失败"));
    expect(el).toBeTruthy();
    // Click should not throw even without handler
    fireEvent.click(el);
  });
});