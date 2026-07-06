import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import Sidebar from "../Sidebar";

describe("Sidebar retry (T39)", () => {
  it('workspaceState="error" + onSelectWorkspace → renders retry button, click calls handler', () => {
    const onSelectWorkspace = vi.fn();
    render(
      <Sidebar
        workspace={null}
        workspaceState="error"
        workspaceError={{ code: "SCAN_FAILED", message: "扫描失败", recoverable: true }}
        fileCount={0}
        indexTree={[]}
        onOpenDocument={vi.fn()}
        activeDocumentRelativePath={null}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

    const btn = screen.getByText("重新选择工作区");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onSelectWorkspace).toHaveBeenCalledTimes(1);
  });
});