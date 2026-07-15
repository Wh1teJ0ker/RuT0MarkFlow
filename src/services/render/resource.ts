/**
 * Resolve relative paths for images and links in rendered HTML.
 *
 * Path resolution rules (all paths are resolved against the current document
 * directory and constrained to the workspace boundary):
 *
 * - Image relative paths → resolved against the document directory, then
 *   converted via `convertFileSrc` to an asset URL the webview can load.
 * - `../` segments are collapsed but the resolved path may not escape the
 *   workspace root; an escape attempt is reported as an image error.
 * - Absolute filesystem paths (`/foo`, `C:\foo`) are NOT loaded directly;
 *   they are reported as image errors (prevents loading arbitrary files).
 * - Internal `.md` links → resolved against the document directory into a
 *   workspace-root-relative path and tagged with `data-internal-md` so the
 *   preview click delegation can open the target document. The fragment
 *   (`#anchor`) is preserved in `data-internal-md-anchor` so it is not lost.
 * - External `http(s)` links → tagged for system-browser open.
 * - Hash-only links (`#anchor`) → left unchanged (in-page navigation).
 */

export interface ResourceOptions {
  documentDir?: string;
  rootPath?: string;
  onOpenDocument?: (relativePath: string) => void;
  convertFileSrc?: (path: string) => string;
  onImageError?: (src: string) => void;
}

export interface ResourceResult {
  html: string;
  imageErrors: string[];
}

/**
 * Resolve resource paths in HTML.
 *
 * Images with unresolvable paths are replaced with a placeholder span built
 * with escaped text (no inline handlers). Runtime load failures of resolvable
 * `<img>` elements are reported via the preview's delegated `error` event
 * listener (see ContentArea), so no inline `onerror` attribute is emitted —
 * this keeps the strict CSP (no `unsafe-inline`) intact and avoids
 * `outerHTML` string concatenation that could re-inject HTML from malicious
 * src/alt values.
 */
export function resolveResources(
  html: string,
  options?: ResourceOptions,
): ResourceResult {
  const imageErrors: string[] = [];
  const documentDir = options?.documentDir || "";
  const rootPath = options?.rootPath || "";
  const convertFileSrc = options?.convertFileSrc;

  // ── Resolve <img src="..."> ─────────────────────────────────
  let result = html.replace(
    /<img\s+([^>]*?)src="([^"]+)"([^>]*?)\/?>/gi,
    (_match, before: string, src: string, after: string) => {
      // http(s) / data URIs are not rewritten; runtime load failures are
      // still caught by the preview's delegated error listener.
      if (
        src.startsWith("http://") ||
        src.startsWith("https://") ||
        src.startsWith("data:")
      ) {
        return _match;
      }

      // Absolute filesystem paths are NOT loaded directly. This blocks
      // attempts to read arbitrary files via `/etc/...` or `C:\...`.
      if (isAbsoluteFsPath(src)) {
        imageErrors.push(`图片路径为绝对路径，已拒绝加载: ${src}`);
        return `<span class="image-error" data-failed-src="${escapeAttr(src)}" title="图片加载失败: ${escapeAttr(src)}">[图片: ${escapeText(src)}]</span>`;
      }

      // Relative path: resolve to absolute filesystem path, constrained
      // to the workspace boundary.
      const resolvedPath = resolveRelativePath(src, documentDir, rootPath);

      if (!resolvedPath) {
        imageErrors.push(`图片路径无法解析: ${src}`);
        return `<span class="image-error" data-failed-src="${escapeAttr(src)}" title="图片加载失败: ${escapeAttr(src)}">[图片: ${escapeText(src)}]</span>`;
      }

      // Convert to asset URL via convertFileSrc (Tauri) or fall back to raw path
      const assetUrl = convertFileSrc
        ? convertFileSrc(resolvedPath)
        : resolvedPath;

      // No inline onerror — the preview attaches a delegated `error` listener
      // and replaces failed images via DOM API + textContent. We preserve the
      // original relative src in a data attribute so retry can re-resolve it.
      return `<img ${before}src="${escapeAttr(assetUrl)}" data-original-src="${escapeAttr(src)}"${after} />`;
    },
  );

  // ── Handle <a href="..."> — add data attributes for click delegation ──
  result = result.replace(
    /<a\s+([^>]*?)href="([^"]+)"([^>]*?)>/gi,
    (_match, before: string, href: string, after: string) => {
      // External http(s) link
      if (href.startsWith("http://") || href.startsWith("https://")) {
        return `<a ${before}href="${href}"${after} data-external-link="true">`;
      }

      // Skip hash-only links (in-page anchors) — leave unchanged so the
      // browser/webview default anchor navigation still works.
      if (href.startsWith("#")) {
        return _match;
      }

      // Internal .md link (within workspace)
      if (
        href.endsWith(".md") ||
        href.endsWith(".markdown") ||
        href.includes(".md#") ||
        href.includes(".markdown#")
      ) {
        const { pathPart, fragment } = splitFragment(href);
        const rootRelative = resolveLinkPath(pathPart, documentDir, rootPath);
        // Preserve the fragment in a dedicated attribute so it is not lost
        // (the document-opener path must be fragment-free).
        const anchorAttr = fragment
          ? ` data-internal-md-anchor="${escapeAttr(fragment)}"`
          : "";
        return `<a ${before}href="${href}"${after} data-internal-md="${escapeAttr(rootRelative)}"${anchorAttr}>`;
      }

      // Other relative links — leave as-is
      return _match;
    },
  );

  return { html: result, imageErrors };
}

/**
 * Resolve a relative path against the document directory, returning
 * an absolute filesystem path constrained to the workspace root.
 *
 * - Backslashes are normalized to forward slashes (Windows compat).
 * - `.` and `..` segments are collapsed lexically.
 * - The resolved path must start with the workspace root; `../` escape
 *   attempts that would leave the workspace return `null`.
 * - Absolute filesystem paths are rejected (return `null`); callers should
 *   detect these separately to produce a "blocked" error rather than
 *   "unresolvable".
 *
 * On Windows, rootPath may contain backslashes (e.g. `C:\Users\foo`).
 * This function normalizes all backslashes to forward slashes so the
 * returned path is compatible with `convertFileSrc` and the webview
 * asset protocol.
 */
function resolveRelativePath(
  src: string,
  documentDir: string,
  rootPath: string,
): string | null {
  if (!rootPath) return null;

  const normalizedRoot = normalizePath(rootPath);
  const base = documentDir
    ? `${normalizedRoot}/${normalizePath(documentDir)}`
    : normalizedRoot;
  const joined = `${base}/${normalizePath(src)}`;

  const collapsed = collapseDots(joined);

  // Boundary check: resolved path must stay within the workspace root.
  if (!isWithinRoot(collapsed, normalizedRoot)) {
    return null;
  }

  return collapsed;
}

/**
 * Resolve a `.md` link href into a workspace-root-relative path (the form
 * expected by `openDocument` → Rust `read_markdown_file`). The fragment is
 * handled by the caller; this receives only the path portion.
 *
 * - If `rootPath` is unavailable (no workspace context), the cleaned href is
 *   returned as-is so previews without a workspace still render the link.
 * - `..` escape attempts that leave the workspace collapse to the boundary
 *   and are clamped (the root-relative form cannot escape above the root).
 * - Absolute filesystem paths are returned unchanged to the Rust layer,
 *   which enforces the real boundary via `canonicalize` + `starts_with`.
 */
function resolveLinkPath(
  hrefPath: string,
  documentDir: string,
  rootPath: string,
): string {
  const normalizedHref = normalizePath(hrefPath);

  // Without a workspace root, fall back to the raw href (best-effort).
  if (!rootPath) {
    return collapseRootRelative(normalizedHref);
  }

  const base = documentDir
    ? `${normalizePath(documentDir)}/${normalizedHref}`
    : normalizedHref;

  const collapsed = collapseRootRelative(base);
  // Clamp: a root-relative path may not start with `../` (escape above root).
  // Strip any leading `../` segments so the link stays within the workspace.
  return clampToRoot(collapsed);
}

/**
 * Split a href into path + fragment portions. The fragment includes the
 * leading `#`.
 */
function splitFragment(href: string): { pathPart: string; fragment: string } {
  const hashIdx = href.indexOf("#");
  if (hashIdx === -1) {
    return { pathPart: href, fragment: "" };
  }
  return { pathPart: href.slice(0, hashIdx), fragment: href.slice(hashIdx) };
}

/**
 * Normalize a path: convert backslashes to forward slashes and collapse
 * repeated slashes. Does NOT resolve `.`/`..` segments.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

/**
 * Collapse `.` and `..` segments lexically (no filesystem access). Handles
 * absolute POSIX paths (leading `/`) and absolute Windows drive paths
 * (`C:/...`).
 */
function collapseDots(path: string): string {
  const isAbs = isAbsoluteFsPath(path);
  // Preserve the absolute prefix (drive letter + / or leading /).
  let prefix = "";
  let rest = path;
  if (isAbs) {
    // Windows drive path like "C:/Users/foo"
    const driveMatch = rest.match(/^([a-zA-Z]:)(\/.*)$/);
    if (driveMatch) {
      prefix = driveMatch[1] + "/";
      rest = driveMatch[2].slice(1);
    } else {
      // POSIX absolute like "/etc/passwd"
      prefix = "/";
      rest = rest.slice(1);
    }
  }

  const segs = rest.split("/").filter((s) => s.length > 0);
  const out: string[] = [];
  for (const seg of segs) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0) {
        out.pop();
      }
      // If at root for an absolute path, `..` is a no-op (cannot escape root).
      // For relative paths, we let `..` remain in the output so the caller
      // can detect escape via boundary check.
      else if (!isAbs) {
        out.push("..");
      }
      continue;
    }
    out.push(seg);
  }
  const body = out.join("/");
  return prefix + body;
}

/**
 * Collapse `.`/`..` for a root-relative path (no leading slash, no drive).
 * Leading `..` segments that would escape above the starting point are
 * preserved so the caller can clamp them.
 */
function collapseRootRelative(path: string): string {
  const segs = path.split("/").filter((s) => s.length > 0);
  const out: string[] = [];
  for (const seg of segs) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else {
        out.push("..");
      }
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

/**
 * Strip leading `../` segments from a root-relative path so it cannot
 * escape above the workspace root.
 */
function clampToRoot(path: string): string {
  const segs = path.split("/").filter((s) => s.length > 0);
  while (segs.length > 0 && segs[0] === "..") {
    segs.shift();
  }
  // Also drop any leading `.` segments.
  while (segs.length > 0 && segs[0] === ".") {
    segs.shift();
  }
  return segs.join("/");
}

/**
 * Return true if `resolved` is within `root` (both normalized with forward
 * slashes). `root` is treated as a directory prefix; a match must be either
 * exactly `root` or start with `root + "/"`.
 */
function isWithinRoot(resolved: string, root: string): boolean {
  if (resolved === root) return true;
  return resolved.startsWith(root.endsWith("/") ? root : root + "/");
}

/**
 * Detect an absolute filesystem path. Recognizes POSIX absolute (`/foo`)
 * and Windows drive paths (`C:\foo` / `C:/foo`). HTTP(s) and data URIs are
 * NOT considered absolute filesystem paths (they are handled earlier).
 */
function isAbsoluteFsPath(p: string): boolean {
  if (p.startsWith("/")) return true;
  // Windows drive letter: `C:\` or `C:/`
  return /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * Escape a string for safe insertion into an HTML attribute value
 * (double-quoted). Prevents attribute-breakout injection from malicious
 * src/alt values before the HTML reaches DOMPurify.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape a string for safe insertion as HTML text content. Prevents
 * HTML injection from malicious src values in placeholder spans.
 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
