/**
 * Unit tests for splitMarkdown (T37 chunker).
 *
 * Coverage:
 * - Empty content → []
 * - Short content (< maxChunkLines) → single element
 * - Fence code block protection: not split inside ```…```
 * - Math block protection: not split inside $$…$$
 * - Multi-chunk split at blank-line boundary
 * - No blank-line boundary → split at maxChunkLines
 * - Exact boundary alignment
 */
import { describe, it, expect } from "vitest";
import { splitMarkdown } from "../chunker";

describe("splitMarkdown", () => {
  it("returns [] for empty content", () => {
    expect(splitMarkdown("", 500)).toEqual([]);
    expect(splitMarkdown("", 100)).toEqual([]);
  });

  it("returns single chunk for short content", () => {
    const content = "# Hello\n\nThis is a short document.\n\nBye.";
    const result = splitMarkdown(content, 500);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(content);
  });

  it("returns single chunk when lines <= maxChunkLines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
    const content = lines.join("\n");
    const result = splitMarkdown(content, 100);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(content);
  });

  it("splits into multiple chunks at blank-line boundaries", () => {
    // Build content with 3 sections separated by blank lines
    const sections = [
      Array.from({ length: 600 }, (_, i) => `Section1 line ${i + 1}`).join("\n"),
      Array.from({ length: 600 }, (_, i) => `Section2 line ${i + 1}`).join("\n"),
      Array.from({ length: 600 }, (_, i) => `Section3 line ${i + 1}`).join("\n"),
    ];
    const content = sections.join("\n\n");

    const result = splitMarkdown(content, 500);

    // Should be split into 3+ chunks (each section is ~600 lines > 500 maxChunkLines)
    expect(result.length).toBeGreaterThanOrEqual(3);

    // Each chunk should be non-empty
    for (const chunk of result) {
      expect(chunk.length).toBeGreaterThan(0);
    }

    // Concatenating chunks should reconstruct original content
    expect(result.join("")).toBe(content);
  });

  it("protects fenced code blocks from being split", () => {
    // Build content where a code block starts near the chunk boundary
    const linesBefore = Array.from({ length: 498 }, (_, i) => `Line ${i + 1}`);
    const codeBlock = [
      "```javascript",
      'const x = 1;',
      'const y = 2;',
      'function test() {',
      '  return x + y;',
      '}',
      "```",
    ];
    const linesAfter = Array.from({ length: 100 }, (_, i) => `After ${i + 1}`);

    const content = [...linesBefore, ...codeBlock, ...linesAfter].join("\n");
    const result = splitMarkdown(content, 500);

    // The code block should be entirely within one chunk (not split across chunks)
    // Find the chunk containing the code block
    const codeBlockStr = codeBlock.join("\n");
    let foundCodeBlock = false;
    for (const chunk of result) {
      if (chunk.includes(codeBlockStr)) {
        foundCodeBlock = true;
        // The code block should be fully contained in this chunk
        expect(chunk.includes("```javascript")).toBe(true);
        expect(chunk.includes("```")).toBe(true);
        // Count backticks in the chunk — should be paired (even number of ```)
        const backtickLines = chunk.split("\n").filter(l => /^```/.test(l.trimEnd())).length;
        expect(backtickLines % 2).toBe(0);
        break;
      }
    }
    expect(foundCodeBlock).toBe(true);

    // Concatenation should reconstruct
    expect(result.join("")).toBe(content);
  });

  it("protects display math blocks from being split", () => {
    const linesBefore = Array.from({ length: 498 }, (_, i) => `Line ${i + 1}`);
    const mathBlock = [
      "$$",
      "E = mc^2",
      "\\int_{0}^{\\infty} e^{-x} dx",
      "$$",
    ];
    const linesAfter = Array.from({ length: 100 }, (_, i) => `After ${i + 1}`);

    const content = [...linesBefore, ...mathBlock, ...linesAfter].join("\n");
    const result = splitMarkdown(content, 500);

    // The math block should be entirely within one chunk
    const mathBlockStr = mathBlock.join("\n");
    let foundMathBlock = false;
    for (const chunk of result) {
      if (chunk.includes(mathBlockStr)) {
        foundMathBlock = true;
        // Count $$ markers — should be paired
        const mathLines = chunk.split("\n").filter(l => /^\$\$$/.test(l.trimEnd())).length;
        expect(mathLines % 2).toBe(0);
        break;
      }
    }
    expect(foundMathBlock).toBe(true);

    expect(result.join("")).toBe(content);
  });

  it("splits at maxChunkLines when no blank-line boundary exists", () => {
    // Content with no blank lines
    const lines = Array.from({ length: 1200 }, (_, i) => `Line ${i + 1} with no blank line between`);
    const content = lines.join("\n");

    const result = splitMarkdown(content, 500);

    // Since there are no blank lines, it should split at exactly 500 and 1000 boundaries
    expect(result.length).toBeGreaterThanOrEqual(2);

    // First chunk should be ~500 lines
    const firstChunkLines = result[0].split("\n").length;
    expect(firstChunkLines).toBeLessThanOrEqual(510);
    expect(firstChunkLines).toBeGreaterThanOrEqual(490);

    expect(result.join("")).toBe(content);
  });

  it("handles exact boundary alignment", () => {
    // Content with exactly 1000 lines, chunk at 500 → should produce 2 chunks at blank-line boundary
    const sections = [
      Array.from({ length: 500 }, (_, i) => `A line ${i + 1}`).join("\n"),
      Array.from({ length: 500 }, (_, i) => `B line ${i + 1}`).join("\n"),
    ];
    const content = sections.join("\n\n");

    const result = splitMarkdown(content, 500);
    expect(result.length).toBe(2);
    expect(result.join("")).toBe(content);
  });

  it("handles nested fences correctly", () => {
    // Content where a code block contains blank lines
    const codeBlock = [
      "```",
      "Line 1",
      "",
      "Line 3 (after blank line inside code block)",
      "",
      "Line 5",
      "```",
    ];
    const after = Array.from({ length: 600 }, (_, i) => `After line ${i + 1}`);

    const content = [...codeBlock, ...after].join("\n");
    const result = splitMarkdown(content, 500);

    // Code block should be intact
    const codeBlockStr = codeBlock.join("\n");
    let foundCodeBlock = false;
    for (const chunk of result) {
      if (chunk.includes(codeBlockStr)) {
        foundCodeBlock = true;
        break;
      }
    }
    expect(foundCodeBlock).toBe(true);

    expect(result.join("")).toBe(content);
  });

  it("preserves original content when concatenated", () => {
    const lines = Array.from({ length: 2500 }, (_, i) => {
      const section = Math.floor(i / 500) + 1;
      return `Section ${section} line ${i + 1}`;
    });
    const content = lines.join("\n");

    const result = splitMarkdown(content, 500);
    expect(result.length).toBeGreaterThanOrEqual(5);
    expect(result.join("")).toBe(content);
  });
});