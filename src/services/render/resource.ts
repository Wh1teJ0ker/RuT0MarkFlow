/**
 * Resolve relative paths for images and links in rendered HTML.
 *
 * - Image relative paths → resolved against document directory,
 *   then converted via convertFileSrc to an asset URL the webview can load.
 * - Internal .md links → intercepted for app-internal open
 * - External http(s) links → identified for system browser open
 * - Absolute paths and http(s) URLs → left as-is
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
 * Images with unresolvable paths are replaced with a placeholder span.
 * Every <img> gets an onerror attribute so the preview can catch load failures.
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
      // Skip if it's an absolute path, http(s), or data URI
      if (
        src.startsWith("http://") ||
        src.startsWith("https://") ||
        src.startsWith("data:") ||
        src.startsWith("/")
      ) {
        // Add onerror handler for load-failure tracking
        return _match;
      }

      // Relative path: resolve to absolute filesystem path first
      const resolvedPath = resolveRelativePath(src, documentDir, rootPath);

      if (!resolvedPath) {
        imageErrors.push(`图片路径无法解析: ${src}`);
        return `<span class="image-error" data-failed-src="${src}" title="图片加载失败: ${src}">[图片: ${src}]</span>`;
      }

      // Convert to asset URL via convertFileSrc (Tauri) or fall back to raw path
      const assetUrl = convertFileSrc
        ? convertFileSrc(resolvedPath)
        : resolvedPath;

      // Attach onerror so the preview can report runtime load failures
      return `<img ${before}src="${assetUrl}"${after} onerror="this.outerHTML='<span class=\\'image-error\\' data-failed-src=\\'${src}\\' title=\\'图片加载失败: ${src}\\'>[图片: ${src}]</span>'" />`;
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

      // Internal .md link (within workspace)
      if (
        href.endsWith(".md") ||
        href.endsWith(".markdown") ||
        href.includes(".md#") ||
        href.includes(".markdown#")
      ) {
        const cleanHref = href.split("#")[0];
        return `<a ${before}href="${href}"${after} data-internal-md="${cleanHref}">`;
      }

      // Skip hash-only links
      if (href.startsWith("#")) {
        return _match;
      }

      // Other relative links — leave as-is
      return _match;
    },
  );

  return { html: result, imageErrors };
}

/**
 * Resolve a relative path against the document directory, returning
 * an absolute filesystem path.
 */
function resolveRelativePath(
  src: string,
  documentDir: string,
  rootPath: string,
): string | null {
  if (!rootPath) return null;

  const base = documentDir ? `${rootPath}/${documentDir}` : rootPath;
  const joined = `${base}/${src}`;
  return joined.replace(/\/+/g, "/");
}