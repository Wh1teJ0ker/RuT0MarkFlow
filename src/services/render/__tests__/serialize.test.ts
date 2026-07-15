import { describe, it, expect } from "vitest";
import { deserializeHtmlToMarkdown } from "../serialize";

/**
 * deserializeHtmlToMarkdown: DOM → Markdown source round-trip.
 *
 * Each test builds the rendered DOM that marked+sanitize would produce and
 * asserts the recovered Markdown source.
 */

function makeRoot(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("deserializeHtmlToMarkdown — block constructs", () => {
  it("serializes headings H1–H6", () => {
    const root = makeRoot(
      "<h1>Title</h1><h2>Sub</h2><h3>Subsub</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>",
    );
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe(
      "# Title\n\n## Sub\n\n### Subsub\n\n#### H4\n\n##### H5\n\n###### H6\n",
    );
  });

  it("serializes paragraphs separated by blank line", () => {
    const root = makeRoot("<p>first</p><p>second</p>");
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("first\n\nsecond\n");
  });

  it("serializes <hr> as ---", () => {
    const root = makeRoot("<p>a</p><hr><p>b</p>");
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("a\n\n---\n\nb\n");
  });

  it("serializes blockquote with > prefix", () => {
    const root = makeRoot("<blockquote><p>quote</p><p>more</p></blockquote>");
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("> quote\n>\n> more\n");
  });
});

describe("deserializeHtmlToMarkdown — lists", () => {
  it("serializes unordered list", () => {
    const root = makeRoot("<ul><li>one</li><li>two</li></ul>");
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("- one\n- two\n");
  });

  it("serializes ordered list starting at 1.", () => {
    const root = makeRoot("<ol><li>first</li><li>second</li></ol>");
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("1. first\n2. second\n");
  });

  it("serializes nested list with indent", () => {
    const root = makeRoot(
      "<ul><li>top<ul><li>nested</li></ul></li><li>sibling</li></ul>",
    );
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("- top\n  - nested\n- sibling\n");
  });
});

describe("deserializeHtmlToMarkdown — code blocks", () => {
  it("serializes fenced code block with language", () => {
    const root = makeRoot('<pre><code class="language-js">const x = 1;\n</code></pre>');
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("```js\nconst x = 1;\n```\n");
  });

  it("serializes fenced code block without language", () => {
    const root = makeRoot("<pre><code>plain\n</code></pre>");
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("```\nplain\n```\n");
  });

  it("keeps multi-line code body", () => {
    const root = makeRoot("<pre><code>line1\nline2\n</code></pre>");
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("```\nline1\nline2\n```\n");
  });
});

describe("deserializeHtmlToMarkdown — tables", () => {
  it("serializes GFM table with header + body", () => {
    const root = makeRoot(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
  });

  it("handles tables with inline formatting in cells", () => {
    const root = makeRoot(
      "<table><thead><tr><th><strong>h</strong></th></tr></thead><tbody><tr><td><em>x</em></td></tr></tbody></table>",
    );
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("| **h** |\n| --- |\n| *x* |\n");
  });
});

describe("deserializeHtmlToMarkdown — inline formatting", () => {
  it("serializes bold/italic/strike/code", () => {
    const root = makeRoot(
      "<p><strong>b</strong> <em>i</em> <del>s</del> <code>c</code></p>",
    );
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("**b** *i* ~~s~~ `c`\n");
  });

  it("escapes ambiguous inline code with backticks", () => {
    const root = makeRoot("<p><code>a`b</code></p>");
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("`` a`b ``\n");
  });

  it("serializes links and images", () => {
    const root = makeRoot(
      '<p><a href="https://x.io">link</a> <img src="p.png" alt="pic"></p>',
    );
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("[link](https://x.io) ![pic](p.png)\n");
  });

  it("serializes <br> inside paragraph as hard break", () => {
    const root = makeRoot("<p>line1<br>line2</p>");
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("line1\nline2\n");
  });
});

describe("deserializeHtmlToMarkdown — math source blocks", () => {
  it("recovers display math from data-formula-source", () => {
    const root = makeRoot(
      '<div class="math-block math-source-block" data-formula-source="x = y" data-formula-display="true"><span class="katex">…</span></div>',
    );
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("$$x = y$$\n");
  });

  it("recovers inline math from data-formula-source", () => {
    const root = makeRoot(
      '<p>before <span class="math-inline math-source-block" data-formula-source="a^2" data-formula-display="false">x</span> after</p>',
    );
    const md = deserializeHtmlToMarkdown(root);
    expect(md).toBe("before $a^2$ after\n");
  });
});
