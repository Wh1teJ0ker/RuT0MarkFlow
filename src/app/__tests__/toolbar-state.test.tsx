/**
 * Tests for Toolbar button disabled logic.
 *
 * Covers: save button, new button, mode toggle button
 * across workspaceState and document state combinations.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Toolbar from "../../components/toolbar/Toolbar";

function renderToolbar(overrides: Record<string, unknown> = {}) {
  const props = {
    viewMode: "split-editor" as const,
    onViewModeChange: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onNewDocument: vi.fn(),
    hasWorkspace: true,
    hasDocument: true,
    isDirty: false,
    isLoading: false,
    isSaving: false,
    isNew: false,
    workspaceState: "ready" as const,
    theme: "light" as const,
    onToggleTheme: vi.fn(),
    onCloseDocument: vi.fn(),
    ...overrides,
  };
  return render(<Toolbar {...props} />);
}

describe("Toolbar button disabled logic", () => {
  it("save button disabled when no document", () => {
    renderToolbar({ hasDocument: false, isDirty: false });
    const btn = screen.getByText("保存").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("save button disabled when not dirty", () => {
    renderToolbar({ isDirty: false });
    const btn = screen.getByText("保存").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("save button enabled when dirty", () => {
    renderToolbar({ isDirty: true });
    const btn = screen.getByText("保存").closest("button");
    expect(btn?.disabled).toBe(false);
  });

  it("save button shows 首次保存 when isNew", () => {
    renderToolbar({ isNew: true, hasDocument: true });
    expect(screen.getByText("首次保存")).toBeTruthy();
  });

  it("save button disabled when saving", () => {
    renderToolbar({ isSaving: true, isDirty: true });
    const btn = screen.getByText("保存").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("new button disabled when workspaceState is idle", () => {
    renderToolbar({ workspaceState: "idle", hasWorkspace: false });
    const btn = screen.getByText("新建").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("new button enabled when workspaceState is ready", () => {
    renderToolbar({ workspaceState: "ready" });
    const btn = screen.getByText("新建").closest("button");
    expect(btn?.disabled).toBe(false);
  });

  it("mode toggle disabled when workspaceState is idle", () => {
    renderToolbar({ workspaceState: "idle", hasWorkspace: false });
    const btn = screen.getByText("无感预览").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("mode toggle enabled when workspaceState is ready", () => {
    renderToolbar({ workspaceState: "ready" });
    const btn = screen.getByText("无感预览").closest("button");
    expect(btn?.disabled).toBe(false);
  });

  it("save-as disabled when no document", () => {
    renderToolbar({ hasDocument: false });
    const btn = screen.getByText("另存为").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("save-as enabled when document exists", () => {
    renderToolbar({ hasDocument: true });
    const btn = screen.getByText("另存为").closest("button");
    expect(btn?.disabled).toBe(false);
  });
});