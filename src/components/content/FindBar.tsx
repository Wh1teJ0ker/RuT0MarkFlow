import { useState, useCallback, useEffect, useRef } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";

interface FindBarProps {
  open: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * FindBar — In-document text search with highlights.
 *
 * Traverses text nodes in the preview container (skipping KaTeX and
 * code subtrees) and wraps matches in `<mark class="find-highlight">`.
 * Supports next/previous navigation via a list of mark elements.
 */
export default function FindBar({ open, onClose, containerRef }: FindBarProps) {
  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const marksRef = useRef<HTMLElement[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Clear highlights ──────────────────────────────────────────
  const clearHighlights = useCallback(() => {
    for (const m of marksRef.current) {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent || ""), m);
        parent.normalize();
      }
    }
    marksRef.current = [];
    setMatchCount(0);
    setCurrentIndex(0);
  }, []);

  // ── Run search ────────────────────────────────────────────────
  const runSearch = useCallback((q: string) => {
    clearHighlights();
    if (!q || !containerRef.current) {
      return;
    }

    const marks: HTMLElement[] = [];
    const treeWalker = document.createTreeWalker(
      containerRef.current,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip text nodes inside KaTeX rendering or code blocks
          const parent = node.parentElement;
          if (parent?.closest(".katex, .katex-display, pre code, code")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    const lowerQ = q.toLowerCase();
    let textNode: Text | null;
    while ((textNode = treeWalker.nextNode() as Text | null)) {
      const text = textNode.textContent || "";
      const lowerText = text.toLowerCase();
      let idx = lowerText.indexOf(lowerQ);
      if (idx === -1) continue;

      // Split text node and insert <mark> for each match
      const fragment = document.createDocumentFragment();
      let lastIdx = 0;
      while (idx !== -1) {
        // Text before match
        if (idx > lastIdx) {
          fragment.appendChild(document.createTextNode(text.slice(lastIdx, idx)));
        }
        // The matching <mark>
        const mark = document.createElement("mark");
        mark.className = "find-highlight";
        mark.textContent = text.slice(idx, idx + q.length);
        fragment.appendChild(mark);
        marks.push(mark);
        lastIdx = idx + q.length;
        idx = lowerText.indexOf(lowerQ, lastIdx);
      }
      // Remaining text after last match
      if (lastIdx < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      textNode.parentNode?.replaceChild(fragment, textNode);
    }

    marksRef.current = marks;
    setMatchCount(marks.length);
    setCurrentIndex(marks.length > 0 ? 0 : -1);
  }, [clearHighlights, containerRef]);

  // ── Query change ──────────────────────────────────────────────
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    runSearch(q);
  }, [runSearch]);

  // ── Next / Previous ───────────────────────────────────────────
  const goNext = useCallback(() => {
    if (marksRef.current.length === 0) return;
    const next = (currentIndex + 1) % marksRef.current.length;
    marksRef.current[currentIndex]?.classList.remove("find-highlight--current");
    marksRef.current[next]?.classList.add("find-highlight--current");
    marksRef.current[next]?.scrollIntoView({ block: "nearest" });
    setCurrentIndex(next);
  }, [currentIndex]);

  const goPrev = useCallback(() => {
    if (marksRef.current.length === 0) return;
    const prev = (currentIndex - 1 + marksRef.current.length) % marksRef.current.length;
    marksRef.current[currentIndex]?.classList.remove("find-highlight--current");
    marksRef.current[prev]?.classList.add("find-highlight--current");
    marksRef.current[prev]?.scrollIntoView({ block: "nearest" });
    setCurrentIndex(prev);
  }, [currentIndex]);

  // ── Close ─────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    clearHighlights();
    setQuery("");
    onClose();
  }, [clearHighlights, onClose]);

  // ── Keyboard inside FindBar ───────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Enter") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, handleClose, goNext, goPrev]);

  // ── Focus input on open ───────────────────────────────────────
  useEffect(() => {
    if (open) {
      // Delay focus until after DOM update
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // ── Cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => clearHighlights();
  }, [clearHighlights]);

  if (!open) return null;

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="find-bar-input"
        type="text"
        placeholder="在预览区中查找…"
        value={query}
        onChange={handleQueryChange}
      />
      {query && (
        <span className="find-bar-count">
          {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : "0/0"}
        </span>
      )}
      <button className="find-bar-btn" onClick={goPrev} disabled={matchCount === 0} title="上一个 (Shift+Enter)">
        <ChevronUp size={14} />
      </button>
      <button className="find-bar-btn" onClick={goNext} disabled={matchCount === 0} title="下一个 (Enter)">
        <ChevronDown size={14} />
      </button>
      <button className="find-bar-btn" onClick={handleClose} title="关闭 (Esc)">
        <X size={14} />
      </button>
    </div>
  );
}