import { describe, it, expect } from "vitest";
import { resolveResources } from "../resource";

describe("resolveResources", () => {
  it("resolves relative image paths using documentDir + rootPath", () => {
    const html = '<img src="image.png" />';
    const result = resolveResources(html, {
      documentDir: "subdir",
      rootPath: "/workspace",
    });
    expect(result.html).toContain("workspace/subdir/image.png");
    // Strict CSP: no inline onerror handler; original src preserved for retry.
    expect(result.html).not.toContain("onerror=");
    expect(result.html).toContain('data-original-src="image.png"');
    expect(result.imageErrors).toHaveLength(0);
  });

  it("blocks absolute image paths and reports an error", () => {
    const html = '<img src="/absolute/path.png" />';
    const result = resolveResources(html, {
      documentDir: "docs",
      rootPath: "/ws",
    });
    // Absolute paths must not be loaded directly (defense-in-depth; the
    // Rust asset layer also enforces scope). No <img> with the abs path is
    // emitted; instead an error placeholder is shown.
    expect(result.html).not.toContain("<img");
    expect(result.html).toContain("image-error");
    expect(result.html).toContain("[图片: /absolute/path.png]");
    expect(result.imageErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("blocks Windows absolute image paths and reports an error", () => {
    const html = '<img src="C:\\secret\\img.png" />';
    const result = resolveResources(html, {
      documentDir: "docs",
      rootPath: "/ws",
    });
    expect(result.html).not.toContain("<img");
    expect(result.imageErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("prevents ../ escape in image paths", () => {
    const html = '<img src="../../outside.png" />';
    const result = resolveResources(html, {
      documentDir: "sub",
      rootPath: "/ws",
    });
    // Escape attempt must not resolve to a path outside the workspace.
    expect(result.html).toContain("image-error");
    expect(result.imageErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("leaves http/https image src unchanged", () => {
    const html = '<img src="https://example.com/image.png" />';
    const result = resolveResources(html);
    expect(result.html).toContain('src="https://example.com/image.png"');
  });

  it("marks external links with data-external-link", () => {
    const html = '<a href="https://example.com">Link</a>';
    const result = resolveResources(html);
    expect(result.html).toContain('data-external-link="true"');
    expect(result.html).not.toContain('target="_blank"');
  });

  it("marks internal .md links with data-internal-md", () => {
    const html = '<a href="doc.md">Doc</a>';
    const result = resolveResources(html);
    expect(result.html).toContain('data-internal-md="doc.md"');
  });

  it("handles links with .md#anchor fragments", () => {
    const html = '<a href="doc.md#section">Section</a>';
    const result = resolveResources(html);
    expect(result.html).toContain('data-internal-md="doc.md"');
    // Fragment is preserved in a dedicated attribute (not lost).
    expect(result.html).toContain('data-internal-md-anchor="#section"');
  });

  it("resolves relative .md links against the current document directory", () => {
    const html = '<a href="other.md">Other</a>';
    const result = resolveResources(html, {
      documentDir: "subdir",
      rootPath: "/ws",
    });
    // Root-relative path passed to the document opener.
    expect(result.html).toContain('data-internal-md="subdir/other.md"');
  });

  it("clamps ../ in .md links to the workspace root", () => {
    const html = '<a href="../../../parent.md">Parent</a>';
    const result = resolveResources(html, {
      documentDir: "a/b",
      rootPath: "/ws",
    });
    // Escape above root is stripped → stays at root.
    expect(result.html).toContain('data-internal-md="parent.md"');
  });

  it("resolves sibling .md links with fragments against doc dir", () => {
    const html = '<a href="./sibling.md#heading">Sibling</a>';
    const result = resolveResources(html, {
      documentDir: "docs",
      rootPath: "/ws",
    });
    expect(result.html).toContain('data-internal-md="docs/sibling.md"');
    expect(result.html).toContain('data-internal-md-anchor="#heading"');
  });

  it("leaves hash-only links unchanged", () => {
    const html = '<a href="#section">Section</a>';
    const result = resolveResources(html);
    expect(result.html).not.toContain("data-internal-md");
    expect(result.html).toContain('href="#section"');
  });

  it("uses convertFileSrc when provided", () => {
    const html = '<img src="img.png" />';
    const fakeConvert = (p: string) => `asset://local/${p}`;
    const result = resolveResources(html, {
      documentDir: "docs",
      rootPath: "/ws",
      convertFileSrc: fakeConvert,
    });
    expect(result.html).toContain("asset://local//ws/docs/img.png");
    expect(result.imageErrors).toHaveLength(0);
  });

  it("reports unresolvable images as errors", () => {
    const html = '<img src="unknown.png" />';
    const result = resolveResources(html, { documentDir: "subdir" });
    // No rootPath → unresolvable
    expect(result.imageErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("normalizes Windows backslashes in rootPath", () => {
    const html = '<img src="image.png" />';
    const result = resolveResources(html, {
      documentDir: "docs\\sub",
      rootPath: "C:\\Projects\\ws",
    });
    // Backslashes should be normalized to forward slashes in the src attribute
    expect(result.html).toContain("C:/Projects/ws/docs/sub/image.png");
    // The src attribute path should not contain backslashes (but onerror handler
    // may contain escaped quotes like \' which are not path separators)
    const srcMatch = result.html.match(/src="([^"]+)"/);
    expect(srcMatch).not.toBeNull();
    expect(srcMatch![1]).not.toContain("\\");
    expect(result.imageErrors).toHaveLength(0);
  });

  it("normalizes Windows backslashes in documentDir", () => {
    const html = '<img src="img.png" />';
    const result = resolveResources(html, {
      documentDir: "docs\\子目录",
      rootPath: "D:\\ws",
    });
    expect(result.html).toContain("D:/ws/docs/子目录/img.png");
    const srcMatch = result.html.match(/src="([^"]+)"/);
    expect(srcMatch).not.toBeNull();
    expect(srcMatch![1]).not.toContain("\\");
  });

  it("handles mixed backslash/forwardslash paths", () => {
    const html = '<img src="sub\\img.png" />';
    const result = resolveResources(html, {
      documentDir: "docs",
      rootPath: "C:\\Projects\\ws",
    });
    // All path separators should be forward slashes
    expect(result.html).toContain("C:/Projects/ws/docs/sub/img.png");
    const srcMatch = result.html.match(/src="([^"]+)"/);
    expect(srcMatch).not.toBeNull();
    expect(srcMatch![1]).not.toContain("\\");
  });
});