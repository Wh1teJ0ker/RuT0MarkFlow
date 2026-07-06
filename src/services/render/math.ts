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
      result = result.replace(placeholder, rendered);
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