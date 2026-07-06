import { useRef, useCallback } from "react";

const MAX_STACK = 100;
const MERGE_MS = 500;

/**
 * Application-level undo/redo history for a controlled textarea.
 *
 * The browser's native undo is broken for controlled inputs because
 * React overwrites the value before the native history can capture it.
 * This hook provides an explicit undo/redo stack that integrates with
 * the editor's content-change flow.
 *
 * Push strategy:
 * - `push(prevContent)` records the content *before* each change.
 * - Consecutive pushes within `MERGE_MS` (500ms) are merged into one
 *   entry so continuous typing doesn't flood the stack.
 * - Duplicate entries (exact same as top of stack) are skipped.
 * - Max 100 entries; oldest entries are evicted when the limit is reached.
 */
export function useEditorHistory(_currentContent: string) {
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const lastPushAtRef = useRef(0);

  const push = useCallback((prevContent: string) => {
    const now = Date.now();
    const stack = undoStackRef.current;

    // De-duplicate: skip if same as top of stack
    if (stack.length > 0 && stack[stack.length - 1] === prevContent) {
      return;
    }

    // Merge: within 500ms, replace top instead of push
    if (stack.length > 0 && now - lastPushAtRef.current < MERGE_MS) {
      stack[stack.length - 1] = prevContent;
    } else {
      stack.push(prevContent);
      // Enforce max size
      if (stack.length > MAX_STACK) {
        stack.splice(0, stack.length - MAX_STACK);
      }
    }

    lastPushAtRef.current = now;
    // Any new push invalidates the redo stack
    redoStackRef.current = [];
  }, []);

  const undo = useCallback((currentContent: string): string | null => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return null;
    const prev = stack.pop()!;
    // Push current content onto redo stack so the user can redo
    redoStackRef.current.push(currentContent);
    return prev;
  }, []);

  const redo = useCallback((currentContent: string): string | null => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return null;
    const next = stack.pop()!;
    // Push current content back onto undo stack
    undoStackRef.current.push(currentContent);
    return next;
  }, []);

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastPushAtRef.current = 0;
  }, []);

  return {
    push,
    undo,
    redo,
    clear,
    get canUndo() { return undoStackRef.current.length > 0; },
    get canRedo() { return redoStackRef.current.length > 0; },
  };
}