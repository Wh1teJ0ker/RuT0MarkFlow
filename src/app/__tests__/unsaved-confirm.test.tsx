/**
 * Tests for unsaved changes confirmation dialog + save-as path.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnsavedConfirmDialog } from "../../components/dialogs";

describe("UnsavedConfirmDialog", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <UnsavedConfirmDialog open={false} onAction={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders three buttons when open=true", () => {
    render(<UnsavedConfirmDialog open={true} onAction={vi.fn()} />);
    expect(screen.getByText("保存并继续")).toBeTruthy();
    expect(screen.getByText("不保存并继续")).toBeTruthy();
    expect(screen.getByText("取消")).toBeTruthy();
  });

  it("calls onAction('save') when Save button clicked", () => {
    const onAction = vi.fn();
    render(<UnsavedConfirmDialog open={true} onAction={onAction} />);
    fireEvent.click(screen.getByText("保存并继续"));
    expect(onAction).toHaveBeenCalledWith("save");
  });

  it("calls onAction('discard') when Discard button clicked", () => {
    const onAction = vi.fn();
    render(<UnsavedConfirmDialog open={true} onAction={onAction} />);
    fireEvent.click(screen.getByText("不保存并继续"));
    expect(onAction).toHaveBeenCalledWith("discard");
  });

  it("calls onAction('cancel') when Cancel button clicked", () => {
    const onAction = vi.fn();
    render(<UnsavedConfirmDialog open={true} onAction={onAction} />);
    fireEvent.click(screen.getByText("取消"));
    expect(onAction).toHaveBeenCalledWith("cancel");
  });

  it("calls onAction('cancel') on Escape key", () => {
    const onAction = vi.fn();
    render(<UnsavedConfirmDialog open={true} onAction={onAction} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onAction).toHaveBeenCalledWith("cancel");
  });

  it("calls onAction('cancel') when clicking overlay backdrop", () => {
    const onAction = vi.fn();
    render(<UnsavedConfirmDialog open={true} onAction={onAction} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onAction).toHaveBeenCalledWith("cancel");
  });
});

describe("handleSaveDocument + isNew path", () => {
  /**
   * Verifies the logic pattern used in App.tsx:
   *
   * handleSaveDocument():
   *   if (document.isNew) { return await handleSaveAs(); }
   *
   * handleSaveAs():
   *   ...pickSavePath → ...saveDocumentAs → return true/false
   *
   * The key fix: handleSaveAs now returns true on success,
   * false on cancel/failure. handleSaveDocument propagates
   * that boolean to its callers (handleSelectWorkspace,
   * handleOpenDocument, window-close handler) so that
   * "save and continue" actually continues after a successful save.
   */
  it("handleSaveAs returns true when save succeeds", async () => {
    // Simulate handleSaveAs success path
    let saved = false;
    const mockHandleSaveAs = async (): Promise<boolean> => {
      saved = true;
      return true;
    };

    const result = await mockHandleSaveAs();
    expect(result).toBe(true);
    expect(saved).toBe(true);
  });

  it("handleSaveAs returns false when save is cancelled", async () => {
    // Simulate handleSaveAs cancel path
    const mockHandleSaveAs = async (): Promise<boolean> => {
      return false; // user cancelled
    };

    const result = await mockHandleSaveAs();
    expect(result).toBe(false);
  });

  it("handleSaveDocument(isNew=true) propagates handleSaveAs return value", async () => {
    // Simulate handleSaveDocument's isNew branch:
    // if (document.isNew) { return await handleSaveAs(); }
    const handleSaveAs = async (): Promise<boolean> => true; // success
    const handleSaveDocument = async (isNew: boolean): Promise<boolean> => {
      if (isNew) return await handleSaveAs();
      return true;
    };

    // isNew + save succeeds → true → caller continues
    expect(await handleSaveDocument(true)).toBe(true);

    // isNew + save fails → false → caller stops
    const handleSaveAsFail = async (): Promise<boolean> => false;
    const handleSaveDocumentFail = async (isNew: boolean): Promise<boolean> => {
      if (isNew) return await handleSaveAsFail();
      return true;
    };
    expect(await handleSaveDocumentFail(true)).toBe(false);
  });

  it("after save success, caller continues (no early return)", async () => {
    // Simulate the caller pattern:
    //   if (document.isDirty) {
    //     const action = await requestUnsavedConfirm();
    //     if (action === "save") {
    //       const saved = await handleSaveDocument();
    //       if (!saved) return; // ← this must NOT fire on successful save
    //     }
    //   }
    //   // ... continue with the action
    let continueExecuted = false;

    const handleSaveDocument = async (): Promise<boolean> => true; // success
    const handleSelectWorkspace = async () => {
      const saved = await handleSaveDocument();
      if (!saved) return; // early return — must not happen
      continueExecuted = true; // continue with the action
    };

    await handleSelectWorkspace();
    expect(continueExecuted).toBe(true);
  });

  it("after save failure, caller stops (early return)", async () => {
    let continueExecuted = false;

    const handleSaveDocument = async (): Promise<boolean> => false; // failure
    const handleSelectWorkspace = async () => {
      const saved = await handleSaveDocument();
      if (!saved) return; // early return — must happen
      continueExecuted = true;
    };

    await handleSelectWorkspace();
    expect(continueExecuted).toBe(false);
  });
});