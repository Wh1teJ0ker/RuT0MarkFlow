import { describe, it, expect } from "vitest";
import { preprocessMath, postprocessMath } from "../math";

describe("preprocessMath", () => {
  it("extracts inline math ($...$)", () => {
    const input = "Inline formula $E = mc^2$ here.";
    const result = preprocessMath(input);
    expect(result.placeholders).toHaveLength(1);
    expect(result.placeholders[0].display).toBe(false);
    expect(result.placeholders[0].formula).toBe("E = mc^2");
    expect(result.text).toContain("__MATH_INLINE_0__");
    expect(result.text).not.toContain("$E");
  });

  it("extracts block math ($$...$$)", () => {
    const input = "Block formula: $$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$";
    const result = preprocessMath(input);
    expect(result.placeholders).toHaveLength(1);
    expect(result.placeholders[0].display).toBe(true);
    expect(result.text).toContain("__MATH_BLOCK_0__");
    expect(result.text).not.toContain("$$");
  });

  it("handles multiple formulas", () => {
    const input = "$a$ and $b$ and $$c$$";
    const result = preprocessMath(input);
    expect(result.placeholders.length).toBeGreaterThanOrEqual(3);
  });

  it("returns original text when no math", () => {
    const input = "Just plain text with no math.";
    const result = preprocessMath(input);
    expect(result.placeholders).toHaveLength(0);
    expect(result.text).toBe(input);
  });

  it("handles empty input", () => {
    const result = preprocessMath("");
    expect(result.placeholders).toHaveLength(0);
    expect(result.text).toBe("");
  });
});

describe("postprocessMath", () => {
  it("renders block math with KaTeX", () => {
    const html = "<p>__MATH_BLOCK_0__</p>";
    const mathErrors: string[] = [];
    const placeholders = [{
      placeholder: "__MATH_BLOCK_0__",
      formula: "E = mc^2",
      display: true,
    }];
    const result = postprocessMath(html, placeholders, mathErrors);
    expect(result).toContain("katex");
    expect(mathErrors).toHaveLength(0);
  });

  it("renders inline math with KaTeX", () => {
    const html = "<p>__MATH_INLINE_0__</p>";
    const mathErrors: string[] = [];
    const placeholders = [{
      placeholder: "__MATH_INLINE_0__",
      formula: "a^2 + b^2 = c^2",
      display: false,
    }];
    const result = postprocessMath(html, placeholders, mathErrors);
    expect(result).toContain("katex");
    expect(mathErrors).toHaveLength(0);
  });

  it("records errors for invalid formulas", () => {
    const html = "<p>__MATH_BLOCK_0__</p>";
    const mathErrors: string[] = [];
    const placeholders = [{
      placeholder: "__MATH_BLOCK_0__",
      formula: "\\invalid{}",
      display: true,
    }];
    const result = postprocessMath(html, placeholders, mathErrors);
    expect(mathErrors.length).toBeGreaterThan(0);
    expect(result).toContain("math-error");
  });

  it("leaves html unchanged when placeholder not found", () => {
    const html = "<p>no math here</p>";
    const mathErrors: string[] = [];
    const result = postprocessMath(html, [], mathErrors);
    expect(result).toBe("<p>no math here</p>");
  });

  it("handles display mode rendering", () => {
    const html = "<p>__MATH_BLOCK_0__</p>";
    const mathErrors: string[] = [];
    const placeholders = [{
      placeholder: "__MATH_BLOCK_0__",
      formula: "\\int_a^b f(x)dx",
      display: true,
    }];
    const result = postprocessMath(html, placeholders, mathErrors);
    expect(result).toContain("katex-display");
  });
});