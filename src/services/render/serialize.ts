/**
 * DOM → Markdown source deserialization.
 *
 * Used by the immersive editor (ImmersiveEditor) to recover Markdown source
 * from the `contentEditable` rendered DOM, so that editing in the rendered
 * state round-trips back to Markdown syntax (instead of degrading to plain
 * text and losing `#`, `**`, etc.).
 *
 * Scope — supports the node types in T10's acceptance_criteria:
 *   block:  h1–h6, p, ul/ol (incl. nested), blockquote, pre>code, table, hr
 *   inline: strong/b, em/i, del/s, code, a, br
 *   math:   `.math-source-block` containers carry the original formula source
 *           in `data-formula-source` / `data-formula-display` (see math.ts).
 *
 * Design notes:
 * - Pure DOM walk; no Markdown library, no marked config changes.
 * - Best-effort: unknown / degraded blocks fall back to their textContent so
 *   editing never silently drops content.
 * - Tables are re-emitted as GFM pipe tables (header + separator + rows).
 * - List nesting is tracked by depth; ordered lists keep their numeric
 *   markers starting at 1 (matching marked's default rendering).
 * - Output is a sequence of logical blocks joined by a single blank line;
 *   multi-line blocks (lists, tables, blockquotes, code fences) keep their
 *   internal `\n` line breaks so they survive the block join intact.
 * - Soft breaks inside paragraphs (`<br>`) become hard line breaks preserved
 *   as-is (marked breaks:true renders `\n` as `<br>`, so a `<br>` round-trips
 *   back to `\n`).
 *
 * Entity handling: text is always read via the DOM (textContent / nodeValue),
 * which decodes HTML entities automatically, so no manual unescaping is
 * required.
 */

/** A serialized logical block: one string that may itself contain `\n`. */
type Block = string;

/** Serialize an inline node to a Markdown fragment string. */
function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const inner = () => serializeInlineChildren(el);

  switch (tag) {
    case "strong":
    case "b":
      return `**${inner()}**`;
    case "em":
    case "i":
      return `*${inner()}*`;
    case "del":
    case "s":
    case "strike":
      return `~~${inner()}~~`;
    case "code":
      // Inline code: use backticks. If the content contains a backtick,
      // pad with spaces and pick a fence longer than the longest run.
      return wrapInlineCode(el.textContent ?? "");
    case "br":
      return "\n";
    case "a": {
      const text = inner();
      const href = el.getAttribute("href") ?? "";
      if (!href) return text;
      const title = el.getAttribute("title");
      return title
        ? `[${text}](${href} "${title}")`
        : `[${text}](${href})`;
    }
    case "img": {
      const alt = el.getAttribute("alt") ?? "";
      const src = el.getAttribute("data-original-src") ?? el.getAttribute("src") ?? "";
      return `![${alt}](${src})`;
    }
    case "span":
    case "div": {
      // Inline math wrapper (span/div carrying a formula source) — recover
      // the source so a formula nested inside a paragraph round-trips.
      if (el.getAttribute("data-formula-source") !== null) {
        return serializeMathInline(el);
      }
      // Generic wrapper — fall through to children.
      return inner();
    }
    default:
      return inner();
  }
}

/** Serialize all children of a node inline. */
function serializeInlineChildren(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    out += serializeInline(child);
  });
  return out;
}

/**
 * Wrap inline code content with backticks, choosing a fence length that
 * avoids ambiguity when the content itself contains backticks.
 */
function wrapInlineCode(content: string): string {
  if (!content) return "``";
  const longestRun = content.match(/`+/g)?.reduce((m, s) => Math.max(m, s.length), 0) ?? 0;
  const fence = "`".repeat(longestRun + 1);
  // Pad with spaces when the content contains a backtick (so the fence is
  // unambiguous) or starts/ends with a space (to avoid trimming).
  const pad =
    longestRun > 0 ||
    content.startsWith(" ") ||
    content.endsWith(" ");
  return pad ? `${fence} ${content} ${fence}` : `${fence}${content}${fence}`;
}

/** Serialize a block-level element to one or more logical blocks. */
function serializeBlock(el: Element, depth: number): Block[] {
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag[1]);
      const text = serializeInlineChildren(el).replace(/\n/g, " ").trim();
      return [`${"#".repeat(level)} ${text}`];
    }
    case "p": {
      const text = serializeInlineChildren(el);
      // Normalize inner newlines from <br>: keep them (hard break).
      const lines = text.split("\n").map((l) => l.trimEnd());
      return [lines.join("\n")];
    }
    case "hr":
      return ["---"];
    case "blockquote": {
      const inner = serializeChildrenBlocks(el, depth);
      // Paragraphs inside a blockquote are separated by a blank `>` line,
      // matching the canonical `> quote\n>\n> more` form.
      return [inner.map((b) => b.split("\n").map((l) => `> ${l}`).join("\n")).join("\n>\n")];
    }
    case "ul":
    case "ol":
      return [serializeList(el, tag === "ol", depth).join("\n")];
    case "pre":
      return serializePre(el);
    case "table":
      return [serializeTable(el).join("\n")];
    case "div":
    case "section": {
      // Math block wrapper (div.math-source-block) — recover source.
      if (el.getAttribute("data-formula-source") !== null) {
        return serializeMath(el);
      }
      // Generic div: treat children as blocks.
      return serializeChildrenBlocks(el, depth);
    }
    case "span": {
      // Inline math wrapper appearing as a top-level block — recover source.
      if (el.getAttribute("data-formula-source") !== null) {
        return serializeMath(el);
      }
      // Otherwise treat as inline within a paragraph-like block.
      const text = serializeInlineChildren(el).trim();
      return text ? [text] : [];
    }
    case "figure": {
      // figure/figcaption from degraded image blocks — fall back to text.
      return serializeChildrenBlocks(el, depth);
    }
    default: {
      // Unknown block element → best-effort: serialize children as blocks,
      // falling back to textContent if no block children.
      const blocks = serializeChildrenBlocks(el, depth);
      if (blocks.length > 0) return blocks;
      const text = (el.textContent ?? "").trim();
      return text ? [text] : [];
    }
  }
}

/** Serialize direct block children of `node`. */
function serializeChildrenBlocks(node: Node, depth: number): Block[] {
  const out: Block[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      out.push(...serializeBlock(child as Element, depth));
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.nodeValue ?? "").trim();
      if (text) out.push(text);
    }
  });
  return out;
}

/** Serialize a list (ul/ol), tracking nesting depth. Returns lines. */
function serializeList(el: Element, ordered: boolean, depth: number): string[] {
  const out: string[] = [];
  let index = 1;
  el.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const li = child as Element;
    if (li.tagName.toLowerCase() !== "li") return;

    const marker = ordered ? `${index}. ` : "- ";
    const indent = "  ".repeat(depth);

    // A <li> may contain inline content directly + nested block elements
    // (nested ul/ol, <p>, etc.). Separate them.
    const inlineParts: string[] = [];
    const blockLines: string[] = [];
    li.childNodes.forEach((c) => {
      if (c.nodeType === Node.ELEMENT_NODE) {
        const ce = c as Element;
        const t = ce.tagName.toLowerCase();
        if (t === "ul" || t === "ol") {
          blockLines.push(...serializeList(ce, t === "ol", depth + 1));
        } else if (t === "p" || t === "pre" || t === "blockquote" || t === "table") {
          blockLines.push(...serializeBlock(ce, depth + 1));
        } else {
          inlineParts.push(serializeInline(ce));
        }
      } else if (c.nodeType === Node.TEXT_NODE) {
        inlineParts.push(c.nodeValue ?? "");
      }
    });

    const inlineText = inlineParts.join("").replace(/\n/g, " ").trim();
    out.push(`${indent}${marker}${inlineText}`);
    if (blockLines.length > 0) out.push(...blockLines);
    index++;
  });
  return out;
}

/** Serialize a <pre> (code block) — extract language from the <code> class. */
function serializePre(el: Element): Block[] {
  const codeEl = el.querySelector("code");
  let lang = "";
  if (codeEl) {
    const cls = codeEl.getAttribute("class") ?? "";
    const m = cls.match(/language-([\w-]+)/);
    if (m) lang = m[1];
  }
  // Use textContent of the <code> (or <pre> if no <code>) — preserves the
  // user-edited source as-is. Drop a single trailing newline that marked
  // appends to code blocks.
  const raw = (codeEl ?? el).textContent ?? "";
  const body = raw.replace(/\n$/, "");
  return [`\`\`\`${lang}\n${body}\n\`\`\``];
}

/** Serialize a GFM table → returns its lines. */
function serializeTable(el: Element): string[] {
  const rows: Element[] = [];
  const pushRows = (parent: Element | null) => {
    if (!parent) return;
    parent.querySelectorAll(":scope > tr").forEach((tr) => rows.push(tr));
  };
  pushRows(el.querySelector(":scope > thead"));
  el.querySelectorAll(":scope > tbody").forEach((tb) =>
    tb.querySelectorAll(":scope > tr").forEach((tr) => rows.push(tr)),
  );

  if (rows.length === 0) {
    // Malformed table → fall back to text.
    const text = (el.textContent ?? "").trim();
    return text ? [text] : [];
  }

  const cells = rows.map((tr) =>
    Array.from(tr.querySelectorAll(":scope > th, :scope > td")).map((cell) =>
      serializeInlineChildren(cell).replace(/\n/g, " ").trim(),
    ),
  );

  // First row is the header.
  const header = cells[0] ?? [];
  const colCount = header.length;
  const sep = Array.from({ length: colCount }, () => "---");

  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...cells.slice(1).map((r) => {
      // Pad to colCount.
      const padded = r.slice();
      while (padded.length < colCount) padded.push("");
      return `| ${padded.join(" | ")} |`;
    }),
  ];
  return lines;
}

/** Recover a math block from a `.math-source-block` wrapper element. */
function serializeMath(el: Element): Block[] {
  const source = el.getAttribute("data-formula-source") ?? "";
  const display = el.getAttribute("data-formula-display") !== "false";
  if (!source) return [];
  return [display ? `$$${source}$$` : `$${source}$`];
}

/** Recover an inline math span to `$...$` (no display mode). */
function serializeMathInline(el: Element): string {
  const source = el.getAttribute("data-formula-source") ?? "";
  if (!source) return "";
  // Inline math is always `$...$`; ignore the display flag here (block path
  // handles display math).
  return `$${source}$`;
}

/**
 * Deserialize a rendered DOM subtree back to Markdown source.
 *
 * Top-level: walks the children of `root` and serializes each block-level
 * element to one or more logical blocks. Text nodes between block elements
 * are treated as paragraph fragments (best-effort).
 *
 * Blocks are separated by a single blank line, matching the canonical
 * Markdown rendering of the source. A trailing newline terminates the
 * document.
 */
export function deserializeHtmlToMarkdown(root: HTMLElement): string {
  const blocks: Block[] = serializeChildrenBlocks(root, 0);
  // Drop trailing whitespace per block, drop empty blocks, then join with a
  // blank line.
  const cleaned = blocks.map((b) => b.replace(/\s+$/, "")).filter((b) => b.length > 0);
  return cleaned.join("\n\n") + "\n";
}
