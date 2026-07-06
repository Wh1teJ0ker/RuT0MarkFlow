/**
 * Tests for FindBar (Item B).
 *
 * Scenarios:
 * - Input query → highlights matches
 * - Next/Prev navigate
 * - Esc closes and clears highlights
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FindBar from "../FindBar";
import { createRef } from "react";

describe("FindBar (Item B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders when open=true, null when open=false", () => {
    const ref = createRef<HTMLDivElement>();

    const { container: c1 } = render(<FindBar open={false} onClose={vi.fn()} containerRef={ref} />);
    expect(c1.querySelector(".find-bar")).toBeNull();

    const { container: c2 } = render(<FindBar open={true} onClose={vi.fn()} containerRef={ref} />);
    expect(c2.querySelector(".find-bar")).not.toBeNull();
  });

  it("typing query updates the count display", () => {
    const ref = createRef<HTMLDivElement>();

    // Create a container with text content
    const container = document.createElement("div");
    container.className = "markdown-body";
    container.textContent = "hello world hello universe";
    document.body.appendChild(container);
    (ref as any).current = container;

    render(<FindBar open={true} onClose={vi.fn()} containerRef={ref as any} />);

    const input = screen.getByPlaceholderText("在预览区中查找…");
    fireEvent.change(input, { target: { value: "hello" } });

    // Should show match count
    expect(screen.getByText((t) => t.includes("/"))).toBeTruthy();

    document.body.removeChild(container);
  });

  it("Esc calls onClose", () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLDivElement>();

    render(<FindBar open={true} onClose={onClose} containerRef={ref} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking X button calls onClose", () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLDivElement>();

    render(<FindBar open={true} onClose={onClose} containerRef={ref} />);

    // Find the X close button
    const closeBtns = document.querySelectorAll(".find-bar-btn");
    // Last button is the close button
    const xBtn = closeBtns[closeBtns.length - 1];
    fireEvent.click(xBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});