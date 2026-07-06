import DOMPurify from "dompurify";

/**
 * Sanitize HTML to prevent XSS attacks.
 *
 * KaTeX output (SVG, MathML) is allowed by adding the necessary tags
 * and attributes to DOMPurify's allowlist.
 *
 * This must be called before any HTML is injected into the DOM.
 */
export function sanitizeHtml(rawHtml: string): string {
  // Configure DOMPurify to allow KaTeX output
  // Pass window explicitly — in Tauri WKWebView the default window detection
  // may fall back to a degraded mode that mishandles Chinese/Unicode chars.
  const purify = DOMPurify(window);

  // Allow SVG and MathML elements that KaTeX outputs
  const ALLOWED_TAGS = [
    // Standard HTML
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "ul", "ol", "li",
    "blockquote",
    "pre", "code",
    "table", "thead", "tbody", "tr", "th", "td",
    "a", "img",
    "strong", "em", "b", "i", "s", "del", "ins",
    "span", "div",
    "input",
    // KaTeX SVG output
    "svg", "path", "g", "rect", "circle", "line", "polyline", "polygon",
    "text", "tspan", "use", "defs", "clipPath", "mask",
    // MathML
    "math", "mi", "mo", "mn", "msup", "msub", "mfrac", "msqrt",
    "mover", "munder", "mtable", "mtr", "mtd", "mrow", "mphantom",
    // Error / placeholder
    "figure", "figcaption",
  ];

  const ALLOWED_ATTR = [
    "href", "target", "rel",
    "src", "alt", "title", "width", "height",
    "class", "id", "style",
    "type", "checked", "disabled",
    // SVG attributes
    "viewBox", "xmlns", "fill", "stroke", "stroke-width",
    "d", "cx", "cy", "r", "x", "y", "dx", "dy",
    "transform", "clip-rule", "fill-rule",
    "text-anchor", "dominant-baseline",
    "data-*", "aria-*",
    // KaTeX
    "displaystyle",
  ];

  return purify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
  });
}