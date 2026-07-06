import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../index";

describe("renderMarkdown - T22 Base Syntax", () => {
  it("renders headings H1-H6", () => {
    const input = `# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6`;
    const result = renderMarkdown(input);
    expect(result.html).toContain("<h1");
    expect(result.html).toContain("<h2");
    expect(result.html).toContain("<h3");
    expect(result.html).toContain("<h4");
    expect(result.html).toContain("<h5");
    expect(result.html).toContain("<h6");
    expect(result.errors).toHaveLength(0);
  });

  it("renders paragraphs", () => {
    const input = "Paragraph one.\n\nParagraph two.";
    const result = renderMarkdown(input);
    expect(result.html).toContain("<p>Paragraph one.</p>");
    expect(result.html).toContain("<p>Paragraph two.</p>");
  });

  it("renders bold, italic, bold-italic, strikethrough", () => {
    const input = "**bold** *italic* ***bold-italic*** ~~strikethrough~~";
    const result = renderMarkdown(input);
    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain("<em>italic</em>");
    expect(result.html).toContain("<del>strikethrough</del>");
  });

  it("renders inline code", () => {
    const input = "Use `code` inline.";
    const result = renderMarkdown(input);
    expect(result.html).toContain("<code>code</code>");
  });

  it("renders unordered, ordered, and nested lists", () => {
    const input = `- Item 1\n- Item 2\n  - Nested 1\n  - Nested 2\n\n1. First\n2. Second`;
    const result = renderMarkdown(input);
    expect(result.html).toContain("<li>Item 1</li>");
    expect(result.html).toContain("<li>Nested 1</li>");
    expect(result.html).toContain("<li>First</li>");
  });

  it("renders task lists with checkbox", () => {
    const input = `- [ ] Unchecked\n- [x] Checked`;
    const result = renderMarkdown(input);
    expect(result.html).toContain('input');
    expect(result.html).toContain('checked');
  });

  it("renders blockquotes and nested blockquotes", () => {
    const input = `> Quote\n>\n> > Nested`;
    const result = renderMarkdown(input);
    expect(result.html).toContain("<blockquote>");
    expect(result.errors).toHaveLength(0);
  });

  it("renders horizontal rules", () => {
    const input = `Above\n\n---\n\nBelow`;
    const result = renderMarkdown(input);
    expect(result.html).toContain("<hr");
  });

  it("renders fenced code blocks", () => {
    const input = "```js\nconsole.log('hello');\n```";
    const result = renderMarkdown(input);
    expect(result.html).toContain("<pre>");
    expect(result.html).toContain("<code");
    expect(result.html).toContain("console.log");
  });

  it("renders tables with alignment", () => {
    const input = `| Left | Center | Right |\n| :--- | :----: | ----: |\n| A    | B      | C     |`;
    const result = renderMarkdown(input);
    expect(result.html).toContain("<table>");
    expect(result.html).toContain("<th");
    expect(result.html).toContain("<td");
  });

  it("renders inline links", () => {
    const input = "[Example](https://example.com)";
    const result = renderMarkdown(input);
    expect(result.html).toContain("<a");
    expect(result.html).toContain('href="https://example.com"');
  });

  it("renders auto links (bare URLs)", () => {
    const input = "Visit https://example.com";
    const result = renderMarkdown(input);
    expect(result.html).toContain('href="https://example.com"');
  });

  it("renders images", () => {
    const input = "![Alt](image.png)";
    const result = renderMarkdown(input, { documentDir: "docs" });
    expect(result.html).toContain("image.png");
    expect(result.errors).toHaveLength(0);
  });

  it("returns empty html for empty content", () => {
    const result = renderMarkdown("");
    expect(result.html).toBe("");
  });

  it("does not crash on malformed content", () => {
    const input = "Unclosed **tag\n\n\nExtra newlines\n\n\n\n";
    const result = renderMarkdown(input);
    expect(result.errors).toHaveLength(0);
    expect(result.hasDegradedBlocks).toBe(false);
  });

  it("strips dangerous HTML tags via DOMPurify", () => {
    const input = "<script>alert('xss')</script>\n\n**safe**";
    const result = renderMarkdown(input);
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("<strong>safe</strong>");
  });
});