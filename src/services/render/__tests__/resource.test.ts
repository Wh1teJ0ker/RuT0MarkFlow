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
    expect(result.html).toContain("onerror=");
    expect(result.imageErrors).toHaveLength(0);
  });

  it("leaves absolute image paths unchanged", () => {
    const html = '<img src="/absolute/path.png" />';
    const result = resolveResources(html, { documentDir: "docs" });
    expect(result.html).toContain('src="/absolute/path.png"');
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
});