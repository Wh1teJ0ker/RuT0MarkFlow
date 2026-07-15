/**
 * Math formula pre-processing and post-processing.
 *
 * Pipeline:
 * 1. Pre-process: Extract `$$...$$` (block) and `$...$` (inline) formulas,
 *    replace with unique placeholders to avoid marked interference.
 * 2. Post-process: Replace placeholders with KaTeX-rendered HTML.
 *
 * Formula rendering is done per-node: a single formula failure does not
 * affect the rest of the document. Failed formulas are kept as raw text.
 */
import katex from "katex";

export interface MathPlaceholder {
  placeholder: string;
  formula: string;
  display: boolean;
}

/**
 * Extract math formulas from text and replace with placeholders.
 */
export function preprocessMath(text: string): {
  text: string;
  placeholders: MathPlaceholder[];
} {
  const placeholders: MathPlaceholder[] = [];
  let counter = 0;

  // Block math: $$...$$
  let result = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula: string) => {
    const placeholder = `__MATH_BLOCK_${counter}__`;
    placeholders.push({ placeholder, formula: formula.trim(), display: true });
    counter++;
    return placeholder;
  });

  // Inline math: $...$ (but not $$ which we already handled)
  // Use a negative lookbehind to avoid matching $$
  result = result.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_match, formula: string) => {
    const placeholder = `__MATH_INLINE_${counter}__`;
    placeholders.push({ placeholder, formula: formula.trim(), display: false });
    counter++;
    return placeholder;
  });

  return { text: result, placeholders };
}

/**
 * Render extracted math formulas with KaTeX and replace placeholders.
 *
 * @param html - HTML after Markdown rendering and resource resolution
 * @param placeholders - Extracted formula placeholders
 * @param mathErrors - Array to collect error messages (mutated in-place)
 * @returns HTML with formulas rendered
 */
export function postprocessMath(
  html: string,
  placeholders: MathPlaceholder[],
  mathErrors: string[],
): string {
  let result = html;

  for (const { placeholder, formula, display } of placeholders) {
    if (!result.includes(placeholder)) continue;

    try {
      const rendered = katex.renderToString(formula, {
        displayMode: display,
        throwOnError: true,
        output: "html",
      });
      // Wrap the rendered KaTeX in a container that carries the original
      // formula source and display mode, so the immersive editor can
      // deserialize the block back to Markdown source (`$$...$$` / `$...$`)
      // rather than losing the syntax to KaTeX HTML.
      //
      // The KaTeX-rendered HTML is still shown visually; the source is
      // recoverable via the data attributes. This does NOT implement
      // WYSIWYG editing of the formula itself (out_of_scope) — it only
      // preserves the source for round-trip serialization.
      const wrapperTag = display ? "div" : "span";
      const wrapperClass = display
        ? "math-block math-source-block"
        : "math-inline math-source-block";
      const sourceAttr = escapeAttr(formula);
      const displayAttr = display ? "true" : "false";
      result = result.replace(
        placeholder,
        `<${wrapperTag} class="${wrapperClass}" data-formula-source="${sourceAttr}" data-formula-display="${displayAttr}">${rendered}</${wrapperTag}>`,
      );
    } catch (e) {
      // Formula failed — keep original text
      const displayText = display ? `$$${formula}$$` : `$${formula}$`;
      result = result.replace(
        placeholder,
        `<span class="math-error" title="公式渲染失败">${displayText}</span>`,
      );
      mathErrors.push(`公式渲染失败: ${formula} (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  return result;
}

/**
 * Escape a string for safe insertion into an HTML attribute value
 * (double-quoted). Mirrors resource.ts::escapeAttr — kept local to avoid
 * a cross-module dependency for a tiny helper.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}