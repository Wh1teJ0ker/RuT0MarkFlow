import { marked } from "marked";
import type { RenderResult, RenderOptions } from "../../types";
import { sanitizeHtml } from "./sanitize";
import { preprocessMath, postprocessMath } from "./math";
import { resolveResources } from "./resource";
import { splitMarkdown } from "./chunker";
import { logger } from "../logger";

// Re-export chunker so useRender can import it from the same barrel
export { splitMarkdown } from "./chunker";
// Re-export DOM → Markdown deserialization (used by ImmersiveEditor)
export { deserializeHtmlToMarkdown } from "./serialize";

// ── Marked global configuration ─────────────────────────────────
// gfm: true enables tables, task lists, strikethrough, etc.
// breaks: true converts soft line breaks (\n) to <br> for Chinese text.
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Render Markdown content to sanitized HTML, with math and resource resolution.
 *
 * Pipeline:
 * 1. Pre-process: extract math formulas → placeholders
 * 2. Marked parse: Markdown → raw HTML
 * 3. Resource resolution: resolve relative paths for images/links (+ onerror)
 * 4. Math post-process: render extracted formulas via KaTeX
 * 5. HTML sanitization: DOMPurify
 */
export function renderMarkdown(
  content: string,
  options?: RenderOptions,
): RenderResult {
  const errors: string[] = [];
  const imageErrors: string[] = [];
  const mathErrors: string[] = [];
  let hasDegradedBlocks = false;

  if (!content) {
    return { html: "", errors, hasDegradedBlocks: false, imageErrors, mathErrors };
  }

  logger.debug("Rendering markdown", { contentLength: content.length });

  // ── Step 0: Normalize CRLF → LF ─────────────────────────────
  // Windows files use \r\n line endings; marked's breaks:true converts
  // \n to <br>, but residual \r causes rendering artifacts (extra spaces,
  // odd <br> placement). Normalize once at the render entry point so all
  // downstream consumers (chunker, marked, KaTeX) see consistent line endings.
  // save (writer.rs) writes content as-is, preserving the user's original
  // line ending convention — we only normalize for rendering.
  let processed = content.replace(/\r\n/g, "\n");

  // ── Step 1: Pre-process math ────────────────────────────────
  let mathPlaceholders: { placeholder: string; formula: string; display: boolean }[] = [];

  try {
    const mathResult = preprocessMath(processed);
    processed = mathResult.text;
    mathPlaceholders = mathResult.placeholders;
  } catch (e) {
    errors.push(`数学公式预处理失败: ${e instanceof Error ? e.message : String(e)}`);
    hasDegradedBlocks = true;
    logger.warn("Math preprocessing failed", { error: e instanceof Error ? e.message : String(e) });
  }

  // ── Step 2: Markdown → HTML ─────────────────────────────────
  let rawHtml = "";
  try {
    rawHtml = marked.parse(processed, { async: false }) as string;
  } catch (e) {
    errors.push(`Markdown 渲染失败: ${e instanceof Error ? e.message : String(e)}`);
    logger.warn("Markdown parse failed", { error: e instanceof Error ? e.message : String(e) });
    return {
      html: `<div class="render-error"><p>渲染失败: ${e instanceof Error ? e.message : String(e)}</p></div>`,
      errors, hasDegradedBlocks: true, imageErrors, mathErrors,
    };
  }

  // ── Step 2b: Garbled text diagnosis ─────────────────────────
  // Compare marked output vs original to detect double-encoding
  // or entity corruption early (Tauri webview / DOMPurify edge cases).
  // Wrap in try-catch so logging never breaks rendering.
  try {
    const hasChinese = /[\u4e00-\u9fff]/.test(content);
    const hasHtmlEntities = /&[#a-zA-Z0-9]+;/.test(rawHtml);
    const hasAngleBrackets = /[<>]/.test(content);
    if ((hasChinese || hasHtmlEntities || hasAngleBrackets) && rawHtml.length > 0) {
      // Check if DOMPurify has mangled entities by scanning for &amp;
      // which would indicate double-encoding (& → &amp;)
      const entityCount = (rawHtml.match(/&[#a-zA-Z0-9]+;/g) || []).length;
      const doubleEncodedCount = (rawHtml.match(/&amp;[#a-zA-Z]/g) || []).length;
      if (doubleEncodedCount > entityCount * 0.1) {
        logger.warn("Possible double-encoding detected", { doubleEncodedCount, entityCount, sample: rawHtml.slice(0, 200) });
      }
    }
  } catch (_e) {
    // Logging must never break rendering
  }

  // ── Step 3: Resolve resources ───────────────────────────────
  try {
    const resourceResult = resolveResources(rawHtml, {
      documentDir: options?.documentDir,
      rootPath: options?.rootPath,
      convertFileSrc: options?.convertFileSrc,
    });
    rawHtml = resourceResult.html;
    imageErrors.push(...resourceResult.imageErrors);
    if (resourceResult.imageErrors.length > 0) hasDegradedBlocks = true;
  } catch (e) {
    errors.push(`资源解析失败: ${e instanceof Error ? e.message : String(e)}`);
    hasDegradedBlocks = true;
    logger.warn("Resource resolution failed", { error: e instanceof Error ? e.message : String(e) });
  }

  // ── Step 4: Post-process math (render KaTeX) ────────────────
  try {
    rawHtml = postprocessMath(rawHtml, mathPlaceholders, mathErrors);
    if (mathErrors.length > 0) hasDegradedBlocks = true;
  } catch (e) {
    errors.push(`公式渲染失败: ${e instanceof Error ? e.message : String(e)}`);
    hasDegradedBlocks = true;
    logger.warn("Math postprocessing failed", { error: e instanceof Error ? e.message : String(e) });
  }

  // ── Step 5: Sanitize HTML ───────────────────────────────────
  let safeHtml = "";
  try {
    safeHtml = sanitizeHtml(rawHtml);
  } catch (e) {
    errors.push(`HTML 净化失败: ${e instanceof Error ? e.message : String(e)}`);
    logger.warn("HTML sanitization failed", { error: e instanceof Error ? e.message : String(e) });
    return {
      html: `<div class="render-error"><p>HTML 净化失败</p></div>`,
      errors, hasDegradedBlocks: true, imageErrors, mathErrors,
    };
  }

  // ── Step 5b: Post-sanitize diagnosis ───────────────────────
  // Compare safeHtml with rawHtml to detect DOMPurify corruption.
  try {
    const hasChineseSafe = /[\u4e00-\u9fff]/.test(safeHtml);
    const hasChineseRaw = /[\u4e00-\u9fff]/.test(rawHtml);
    if (hasChineseRaw && !hasChineseSafe && rawHtml.length > 0) {
      logger.warn("DOMPurify stripped Chinese characters", { rawSample: rawHtml.slice(0, 100), safeSample: safeHtml.slice(0, 100) });
    }
    const ampCount = (safeHtml.match(/&amp;/g) || []).length;
    const rawAmpCount = (rawHtml.match(/&amp;/g) || []).length;
    if (ampCount > rawAmpCount && ampCount > 0) {
      logger.warn("DOMPurify added extra &amp; entities", { extraCount: ampCount - rawAmpCount });
    }
  } catch (_e) {
    // Logging must never break rendering
  }

  logger.debug("Render complete", { htmlLength: safeHtml.length, errorCount: errors.length, imageErrorCount: imageErrors.length, mathErrorCount: mathErrors.length, degraded: hasDegradedBlocks });

  return {
    html: safeHtml,
    errors, hasDegradedBlocks, imageErrors, mathErrors,
  };
}

/**
 * Convenience: render each chunk of a long document through the full
 * renderMarkdown pipeline and return chunked results wrapped in
 * `.render-chunk` divs.
 *
 * The caller (useRender) typically handles chunk scheduling itself;
 * this function is provided as a building block for direct use or
 * testing.
 */
export function renderMarkdownChunks(
  content: string,
  options?: RenderOptions,
  maxChunkLines = 500,
): { chunks: RenderResult[]; html: string } {
  const parts = splitMarkdown(content, maxChunkLines);
  const chunks: RenderResult[] = parts.map((chunk) => renderMarkdown(chunk, options));
  const html = chunks
    .map((c, i) => `<div class="render-chunk" data-chunk-index="${i}">${c.html}</div>`)
    .join("");
  return { chunks, html };
}