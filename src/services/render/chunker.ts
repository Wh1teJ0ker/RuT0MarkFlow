/**
 * Markdown content chunker for T37 long-document virtualisation.
 *
 * Splits Markdown content into chunks at blank-line boundaries,
 * protecting fenced code blocks (```) and math blocks ($$) from
 * being split internally.
 *
 * Pure function — no side effects, no dependencies on the render pipeline.
 *
 * Fence/math state for a line is evaluated AFTER the flush/blanks
 * checks for that line.  This prevents the code-block closing line
 * itself from triggering a premature flush while still inside the
 * block, and allows the block-opening line to be a safe split point.
 *
 * When a fence or math block causes the buffer to overflow
 * maxChunkLines, the split point is deferred to right before the
 * block started (or the last blank-line boundary, whichever is
 * closer).  This guarantees that blocks are never cut in half.
 */

const DEFAULT_MAX_CHUNK_LINES = 500;

/**
 * Split Markdown content into chunks at blank-line boundaries.
 *
 * - Tracks fenced code block (```) state so code blocks are never split.
 * - Tracks display math ($$) state so math blocks are never split.
 * - Accumulates lines until reaching `maxChunkLines`, then cuts at
 *   the most recent blank-line boundary.  If no boundary exists,
 *   cuts at the line before the nearest fence/math block, or at
 *   `maxChunkLines` directly.
 * - Empty content returns `[]`.
 * - Content shorter than `maxChunkLines` returns a single chunk.
 * - Concatenating the returned chunks (chunks.join("")) reconstructs
 *   the original content exactly.
 */
export function splitMarkdown(
  content: string,
  maxChunkLines: number = DEFAULT_MAX_CHUNK_LINES,
): string[] {
  if (!content) return [];

  const lines = content.split("\n");
  if (lines.length <= maxChunkLines) return [content];

  const chunks: string[] = [];
  let buffer: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  let inMathBlock = false;
  let lastSplitLine = -1; // index in buffer of last blank-line boundary
  let fenceStartIdx = -1; // buffer index where the current fence/math block opened

  /**
   * Flush buffer[0..endIndex] as a chunk, including a trailing newline
   * so that concatenating chunks (chunks.join("")) reconstructs the
   * original content exactly.
   */
  function flushChunk(endIndex: number) {
    chunks.push(buffer.slice(0, endIndex + 1).join("\n") + "\n");
    buffer = buffer.slice(endIndex + 1);
    lastSplitLine = -1;
    fenceStartIdx = -1;
  }

  for (const line of lines) {
    const trimmed = line.trimEnd();

    buffer.push(line);

    // ── Blank line → potential split point ─────────────────────
    // Uses inFence/inMathBlock from BEFORE processing the current
    // line's fence state, so a ``` closing line won't accidentally
    // add a split point while still inside the code block.
    if (trimmed === "" && !inFence && !inMathBlock) {
      lastSplitLine = buffer.length - 1;
    }

    // ── Flush when buffer exceeds maxChunkLines ────────────────
    // Uses > (not >=) so that a buffer exactly at maxChunkLines waits
    // for the next line.  If the next line is a blank line it becomes
    // a clean split point; if it's content we flush at maxChunkLines-1
    // on the following iteration.
    // Also uses inFence/inMathBlock from BEFORE processing the current
    // line's fence state, preventing premature flush on the ``` line.
    if (buffer.length > maxChunkLines && !inFence && !inMathBlock) {
      if (lastSplitLine >= 0) {
        flushChunk(lastSplitLine);
      } else if (fenceStartIdx >= 1) {
        // A fence/math block caused overflow — flush at the line
        // right before the block started so the block stays intact.
        flushChunk(fenceStartIdx - 1);
      } else {
        flushChunk(maxChunkLines - 1);
      }
    }

    // ── Track fenced code block state ──────────────────────────
    if (!inMathBlock && /^```/.test(trimmed)) {
      if (!inFence) {
        inFence = true;
        fenceMarker = trimmed;
        fenceStartIdx = buffer.length - 1;
      } else if (trimmed === fenceMarker || /^```$/.test(trimmed)) {
        inFence = false;
      }
    }

    // ── Track display math block state ($$) ────────────────────
    if (!inFence && /^\$\$$/.test(trimmed)) {
      if (!inMathBlock) {
        inMathBlock = true;
        fenceStartIdx = buffer.length - 1;
      } else {
        inMathBlock = false;
      }
    }
  }

  // ── Remaining lines as final chunk (no trailing newline) ─────
  if (buffer.length > 0) {
    chunks.push(buffer.join("\n"));
  }

  return chunks;
}