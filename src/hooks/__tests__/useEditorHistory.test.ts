import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEditorHistory } from "../useEditorHistory";
import { renderHook, act } from "@testing-library/react";

describe("useEditorHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("push + undo restores previous content", () => {
    const { result } = renderHook(() => useEditorHistory("current"));

    // Simulate: content was "" → changed to "v0" → push("")
    act(() => { result.current.push(""); });
    act(() => { vi.advanceTimersByTime(600); });
    // Content was "v0" → changed to "v1" → push("v0")
    act(() => { result.current.push("v0"); });

    // Undo "v1" should return "v0" (the content before the last change)
    const prev = result.current.undo("v1");
    expect(prev).toBe("v0");
    // Undo again should return "" (the content before the first change)
    expect(result.current.undo("v0")).toBe("");
    // Undo stack is now empty
    expect(result.current.undo("")).toBeNull();
  });

  it("push then redo restores next content", () => {
    const { result } = renderHook(() => useEditorHistory(""));

    act(() => { result.current.push("v0"); });
    act(() => { result.current.push("v1"); });
    act(() => { result.current.undo("v1"); });

    expect(result.current.redo("v0")).toBe("v1");
  });

  it("new push clears redo stack", () => {
    const { result } = renderHook(() => useEditorHistory(""));

    act(() => { result.current.push("v0"); });
    act(() => { result.current.push("v1"); });
    act(() => { result.current.undo("v1"); });

    // Can redo before new push
    expect(result.current.canRedo).toBe(true);

    // New push
    act(() => { result.current.push("v2"); });

    // Redo stack should be cleared
    expect(result.current.canRedo).toBe(false);
    expect(result.current.redo("v2")).toBeNull();
  });

  it("undo on empty stack returns null", () => {
    const { result } = renderHook(() => useEditorHistory(""));
    expect(result.current.undo("anything")).toBeNull();
  });

  it("redo on empty stack returns null", () => {
    const { result } = renderHook(() => useEditorHistory(""));
    expect(result.current.redo("anything")).toBeNull();
  });

  it("clear() empties both stacks", () => {
    const { result } = renderHook(() => useEditorHistory(""));

    act(() => { result.current.push("v0"); });
    act(() => { result.current.push("v1"); });
    expect(result.current.canUndo).toBe(true);

    act(() => { result.current.clear(); });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undo("x")).toBeNull();
  });

  it("merge: consecutive pushes within 500ms merge into one entry", () => {
    const { result } = renderHook(() => useEditorHistory(""));

    act(() => { result.current.push("v0"); });
    // First push at t=0
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { result.current.push("v1"); }); // merge with v0 -> replaces v0
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { result.current.push("v2"); }); // merge with previous -> replaces

    // Only one entry in undo stack: "v2" (the latest merged)
    const val = result.current.undo("current");
    expect(val).toBe("v2");
    // After one undo, stack is empty
    expect(result.current.undo("v2")).toBeNull();
  });

  it("no merge when push is more than 500ms apart", () => {
    const { result } = renderHook(() => useEditorHistory(""));

    act(() => { result.current.push("v0"); });
    act(() => { vi.advanceTimersByTime(600); });
    act(() => { result.current.push("v1"); });

    // Two separate entries
    expect(result.current.undo("current")).toBe("v1");
    expect(result.current.undo("v1")).toBe("v0");
    expect(result.current.undo("v0")).toBeNull();
  });

  it("stack max size: push beyond 100 evicts oldest", () => {
    const { result } = renderHook(() => useEditorHistory(""));

    // Push 102 entries (with >500ms between each to avoid merge)
    for (let i = 0; i < 102; i++) {
      act(() => { result.current.push(`v${i}`); });
      act(() => { vi.advanceTimersByTime(600); });
    }

    // Undo 101 times to verify we have exactly 100 entries
    let count = 0;
    let val: string | null;
    let current = "latest";
    while ((val = result.current.undo(current)) !== null) {
      count++;
      current = val;
    }
    // Should have 100 entries (v2..v101 — v0 and v1 evicted)
    expect(count).toBe(100);
  });

  it("push skips duplicate of top of stack", () => {
    const { result } = renderHook(() => useEditorHistory(""));

    act(() => { result.current.push("v0"); });
    act(() => { vi.advanceTimersByTime(600); });
    act(() => { result.current.push("v0"); }); // same as top — should skip

    // Only one entry
    expect(result.current.undo("v0")).toBe("v0");
    expect(result.current.undo("v0")).toBeNull();
  });

  it("canUndo / canRedo reflect current state", () => {
    const { result } = renderHook(() => useEditorHistory(""));

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    act(() => { result.current.push("v0"); });
    expect(result.current.canUndo).toBe(true);

    act(() => { result.current.undo("v0"); });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });
});