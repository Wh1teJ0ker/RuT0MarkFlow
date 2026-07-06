/**
 * Component-level tests for IndexTree expand state persistence (T12).
 *
 * Verifies:
 * - Clicking a directory toggles its expand state
 * - Expand state survives index tree re-render with same data
 * - Expand state survives index tree re-render with NEW data reference
 * - Active file path is correctly highlighted
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { act } from "react";
import { useState, useCallback } from "react";
import IndexTree from "../../components/sidebar/IndexTree";
import type { IndexTreeNode } from "../../types";

function makeDir(id: string, name: string, children: IndexTreeNode[]): IndexTreeNode {
  return {
    id,
    name,
    type: "directory",
    relativePath: name,
    children,
  };
}

function makeFile(relPath: string, name: string): IndexTreeNode {
  return {
    id: relPath,
    name,
    type: "file",
    relativePath: relPath,
    entry: {
      id: relPath,
      name,
      absolutePath: `/ws/${relPath}`,
      relativePath: relPath,
      parentRelativePath: relPath.split("/").slice(0, -1).join("/"),
      extension: "md",
    },
  };
}

// ── Test wrapper: re-render with same or new indexTree ───────────

interface WrapperProps {
  nodes: IndexTreeNode[];
  activePath?: string | null;
}

function ExpandPersistenceWrapper({ nodes, activePath }: WrapperProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const handleToggleExpand = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  return (
    <IndexTree
      nodes={nodes}
      onOpenDocument={vi.fn()}
      activePath={activePath ?? null}
      expandedIds={expandedIds}
      onToggleExpand={handleToggleExpand}
    />
  );
}

describe("IndexTree expand state persistence", () => {
  const tree: IndexTreeNode[] = [
    makeDir("dir:src", "src", [
      makeFile("src/index.md", "index.md"),
      makeFile("src/guide.md", "guide.md"),
    ]),
    makeDir("dir:docs", "docs", [
      makeFile("docs/api.md", "api.md"),
      makeFile("docs/faq.md", "faq.md"),
    ]),
    makeFile("readme.md", "readme.md"),
  ];

  it("renders all root nodes", () => {
    const { container } = render(
      <ExpandPersistenceWrapper nodes={tree} />,
    );
    const labels = container.querySelectorAll(".tree-node-label");
    expect(labels.length).toBe(3); // 2 dirs + 1 file at root level
    expect(labels[0].textContent).toBe("src");
    expect(labels[1].textContent).toBe("docs");
    expect(labels[2].textContent).toBe("readme.md");
  });

  it("toggling a directory shows its children", () => {
    const { container } = render(
      <ExpandPersistenceWrapper nodes={tree} />,
    );

    // Initially, no children visible
    expect(container.querySelectorAll(".tree-node-children").length).toBe(0);

    // Click the "src" directory row to expand
    const dirRows = container.querySelectorAll(".tree-node-row--dir");
    expect(dirRows.length).toBe(2);

    act(() => {
      fireEvent.click(dirRows[0]);
    });

    // Now children should be visible
    const childrenContainers = container.querySelectorAll(".tree-node-children");
    expect(childrenContainers.length).toBe(1);

    // Should show 2 file labels inside
    const childLabels = childrenContainers[0].querySelectorAll(".tree-node-label");
    expect(childLabels.length).toBe(2);
    expect(childLabels[0].textContent).toBe("index.md");
    expect(childLabels[1].textContent).toBe("guide.md");
  });

  it("expand state survives re-render with same tree data", () => {
    const { container, rerender } = render(
      <ExpandPersistenceWrapper nodes={tree} />,
    );

    // Expand "src" directory
    const dirRows = container.querySelectorAll(".tree-node-row--dir");
    act(() => {
      fireEvent.click(dirRows[0]);
    });
    expect(container.querySelectorAll(".tree-node-children").length).toBe(1);

    // Re-render with SAME tree reference
    rerender(<ExpandPersistenceWrapper nodes={tree} />);

    // Expand state should persist
    expect(container.querySelectorAll(".tree-node-children").length).toBe(1);
  });

  it("expand state survives re-render with new tree data (simulating watcher refresh)", () => {
    const { container, rerender } = render(
      <ExpandPersistenceWrapper nodes={[...tree]} />,
    );

    // Expand "src" directory
    const dirRows = container.querySelectorAll(".tree-node-row--dir");
    act(() => {
      fireEvent.click(dirRows[0]);
    });
    expect(container.querySelectorAll(".tree-node-children").length).toBe(1);

    // Re-render with NEW tree array (simulating watcher-triggered index rebuild)
    const newTree: IndexTreeNode[] = [
      makeDir("dir:src", "src", [
        makeFile("src/index.md", "index.md"),
        makeFile("src/guide.md", "guide.md"),
      ]),
      makeDir("dir:docs", "docs", [
        makeFile("docs/api.md", "api.md"),
      ]),
      makeFile("readme.md", "readme.md"),
      makeFile("CHANGELOG.md", "CHANGELOG.md"),
    ];

    rerender(<ExpandPersistenceWrapper nodes={newTree} />);

    // "src" should remain expanded
    const childrenContainers = container.querySelectorAll(".tree-node-children");
    expect(childrenContainers.length).toBe(1);

    // New file shows up
    const labels = container.querySelectorAll(".tree-node-label");
    const labelTexts = Array.from(labels).map((l) => l.textContent);
    expect(labelTexts).toContain("CHANGELOG.md");
  });

  it("highlighted activePath updates correctly", () => {
    const { container, rerender } = render(
      <ExpandPersistenceWrapper nodes={tree} activePath="readme.md" />,
    );

    const activeRows = container.querySelectorAll(".tree-node-row--active");
    expect(activeRows.length).toBe(1);
    expect(activeRows[0].textContent).toContain("readme.md");

    // Change active path
    rerender(<ExpandPersistenceWrapper nodes={tree} activePath="src/guide.md" />);

    // Expand src to see the active file
    const dirRows = container.querySelectorAll(".tree-node-row--dir");
    act(() => {
      fireEvent.click(dirRows[0]);
    });

    const activeAfter = container.querySelectorAll(".tree-node-row--active");
    expect(activeAfter.length).toBe(1);
    expect(activeAfter[0].textContent).toContain("guide.md");
  });
});