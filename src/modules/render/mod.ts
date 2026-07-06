import { useState, useCallback, useRef, useEffect } from "react";
import { renderMarkdown, splitMarkdown } from "../../services/render";
import type { RenderOptions, RenderResult, RenderState } from "../../types";

/**
 * React hook for managing Markdown rendering state.
 *
 * For short documents (≤ 1 chunk) behaves identically to the original
 * synchronous implementation.  For long documents uses a three-layer
 * strategy:
 *
 * 1. **Source chunking** — `splitMarkdown` divides content at blank-line
 *    boundaries, protecting fences and math blocks.
 * 2. **Incremental scheduling** — the first 1-2 chunks render
 *    synchronously (visible in one paint), remaining chunks via
 *    `setTimeout` batches (2-3 at a time).
 * 3. **Per-chunk cache** — unchanged chunks are served from a
 *    Map keyed by `simpleHash(chunk)|docDir|rootPath`.
 */
export function useRender() {
  const [state, setState] = useState<RenderState>({
    html: "",
    lastSourceHash: "",
    isRendering: false,
    hasDegradedBlocks: false,
    imageErrors: [],
    mathErrors: [],
  });

  // ── Caches ─────────────────────────────────────────────────────
  /** Full-content cache (same as before) — used for short docs. */
  const cacheRef = useRef<Map<string, RenderResult>>(new Map());
  /** Per-chunk cache — key = simpleHash(chunkContent)|docDir|rootPath */
  const chunkCacheRef = useRef<Map<string, RenderResult>>(new Map());
  /** Pending chunk timer (setTimeout id) for cleanup. */
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Guard against calling setState after unmount. */
  const mountedRef = useRef(true);

  const MAX_CHUNK_LINES = 500;
  /** Number of chunks rendered synchronously for the first paint. */
  const SYNC_CHUNK_COUNT = 2;
  /** Number of chunks rendered per async batch. */
  const BATCH_SIZE = 3;

  // ── Simple hash (32-bit, same as before) ────────────────────────
  function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  // ── Per-chunk cache helpers ────────────────────────────────────
  function chunkCacheKey(chunkContent: string, docDir: string, rootPath: string): string {
    return `${simpleHash(chunkContent)}|${docDir}|${rootPath}`;
  }

  /** Evict old entries when per-chunk cache exceeds limit. */
  function pruneChunkCache() {
    if (chunkCacheRef.current.size >= 100) {
      const firstKey = chunkCacheRef.current.keys().next().value;
      if (firstKey) chunkCacheRef.current.delete(firstKey);
    }
  }

  /** Render a single chunk (check cache first). */
  function renderChunk(
    chunkContent: string,
    docDir: string,
    rootPath: string,
    options?: RenderOptions,
  ): RenderResult {
    const key = chunkCacheKey(chunkContent, docDir, rootPath);
    const cached = chunkCacheRef.current.get(key);
    if (cached) return cached;
    const result = renderMarkdown(chunkContent, options);
    pruneChunkCache();
    chunkCacheRef.current.set(key, result);
    return result;
  }

  /** Build chunked HTML wrapping each chunk in `.render-chunk`. */
  function buildChunkedHtml(results: RenderResult[], startIndex: number): string {
    return results
      .map((r, i) => `<div class="render-chunk" data-chunk-index="${startIndex + i}">${r.html}</div>`)
      .join("");
  }

  /** Aggregate errors from multiple chunk results. */
  function mergeResults(results: RenderResult[]): {
    hasDegradedBlocks: boolean;
    imageErrors: string[];
    mathErrors: string[];
  } {
    let hasDegradedBlocks = false;
    const imageErrors: string[] = [];
    const mathErrors: string[] = [];
    for (const r of results) {
      if (r.hasDegradedBlocks) hasDegradedBlocks = true;
      imageErrors.push(...r.imageErrors);
      mathErrors.push(...r.mathErrors);
    }
    return { hasDegradedBlocks, imageErrors, mathErrors };
  }

  /** Cancel any pending chunk rendering timer. */
  function cancelPendingChunks() {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }

  // ── Main render function ────────────────────────────────────────

  const render = useCallback(
    (content: string, options?: RenderOptions): RenderResult | undefined => {
      cancelPendingChunks();

      if (!content) {
        setState({
          html: "",
          lastSourceHash: "",
          isRendering: false,
          hasDegradedBlocks: false,
          imageErrors: [],
          mathErrors: [],
        });
        return undefined;
      }

      const docDir = options?.documentDir || "";
      const rootPath = options?.rootPath || "";
      const hash = simpleHash(content);
      const fullCacheKey = `${hash}|${docDir}|${rootPath}`;

      // ── Short document: original sync path ─────────────────────
      const chunks = splitMarkdown(content, MAX_CHUNK_LINES);
      if (chunks.length <= 1) {
        const cached = cacheRef.current.get(fullCacheKey);
        if (cached) {
          setState({
            html: cached.html,
            lastSourceHash: hash,
            isRendering: false,
            hasDegradedBlocks: cached.hasDegradedBlocks,
            imageErrors: cached.imageErrors,
            mathErrors: cached.mathErrors,
          });
          return cached;
        }

        setState((prev) => ({ ...prev, isRendering: true }));

        const result = renderMarkdown(content, options);

        if (cacheRef.current.size >= 20) {
          const firstKey = cacheRef.current.keys().next().value;
          if (firstKey) cacheRef.current.delete(firstKey);
        }
        cacheRef.current.set(fullCacheKey, result);

        setState({
          html: result.html,
          lastSourceHash: hash,
          isRendering: false,
          hasDegradedBlocks: result.hasDegradedBlocks,
          imageErrors: result.imageErrors,
          mathErrors: result.mathErrors,
        });

        return result;
      }

      // ── Long document: chunked rendering ───────────────────────

      // Sync batch: first SYNC_CHUNK_COUNT chunks
      const syncChunks = chunks.slice(0, SYNC_CHUNK_COUNT);
      const syncResults = syncChunks.map((chunk) => renderChunk(chunk, docDir, rootPath, options));
      const syncHtml = buildChunkedHtml(syncResults, 0);
      const syncMerged = mergeResults(syncResults);

      setState({
        html: syncHtml,
        lastSourceHash: hash,
        isRendering: false, // false so ContentArea renders the partial HTML
        hasDegradedBlocks: syncMerged.hasDegradedBlocks,
        imageErrors: syncMerged.imageErrors,
        mathErrors: syncMerged.mathErrors,
      });

      // Return the aggregate result of sync chunks for error tracking
      const syncResult: RenderResult = {
        html: syncHtml,
        errors: [],
        hasDegradedBlocks: syncMerged.hasDegradedBlocks,
        imageErrors: syncMerged.imageErrors,
        mathErrors: syncMerged.mathErrors,
      };

      // ── Async batches: remaining chunks via setTimeout ─────────
      if (chunks.length > SYNC_CHUNK_COUNT) {
        let currentIndex = SYNC_CHUNK_COUNT;
        const remainingCount = chunks.length - SYNC_CHUNK_COUNT;
        const totalBatches = Math.ceil(remainingCount / BATCH_SIZE);
        let batchCount = 0;

        const scheduleNext = () => {
          if (!mountedRef.current) return;
          if (currentIndex >= chunks.length) {
            setState((prev) => ({ ...prev, isRendering: false }));
            pendingTimerRef.current = null;
            return;
          }

          const batch = chunks.slice(currentIndex, currentIndex + BATCH_SIZE);
          const batchResults = batch.map((chunk) => renderChunk(chunk, docDir, rootPath, options));
          const batchHtml = buildChunkedHtml(batchResults, currentIndex);
          const batchMerged = mergeResults(batchResults);

          setState((prev) => ({
            ...prev,
            html: prev.html + batchHtml,
            isRendering: currentIndex + BATCH_SIZE < chunks.length,
            hasDegradedBlocks: prev.hasDegradedBlocks || batchMerged.hasDegradedBlocks,
            imageErrors: [...prev.imageErrors, ...batchMerged.imageErrors],
            mathErrors: [...prev.mathErrors, ...batchMerged.mathErrors],
          }));

          currentIndex += BATCH_SIZE;
          batchCount++;

          if (currentIndex < chunks.length) {
            // Use increasing delay for later batches to avoid starving the main thread
            // Early batches: 0ms (next event loop tick).  Late batches: spread out.
            const delay = batchCount <= totalBatches / 2 ? 0 : 4;
            pendingTimerRef.current = setTimeout(scheduleNext, delay);
          } else {
            pendingTimerRef.current = null;
          }
        };

        pendingTimerRef.current = setTimeout(scheduleNext, 0);
      }

      return syncResult;
    },
    [],
  );

  // ── Error reporting (unchanged) ─────────────────────────────────

  const reportImageError = useCallback((src: string) => {
    setState((prev) => {
      if (prev.imageErrors.includes(src)) return prev;
      return {
        ...prev,
        imageErrors: [...prev.imageErrors, src],
        hasDegradedBlocks: true,
      };
    });
  }, []);

  const resetRenderErrors = useCallback(() => {
    setState((prev) => ({
      ...prev,
      imageErrors: [],
      mathErrors: [],
      hasDegradedBlocks: false,
    }));
  }, []);

  const reset = useCallback(() => {
    cancelPendingChunks();
    cacheRef.current.clear();
    chunkCacheRef.current.clear();
    setState({
      html: "",
      lastSourceHash: "",
      isRendering: false,
      hasDegradedBlocks: false,
      imageErrors: [],
      mathErrors: [],
    });
  }, []);

  // Clean up on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelPendingChunks();
    };
  }, []);

  return { ...state, render, reportImageError, resetRenderErrors, reset };
}

export function isRenderEmpty(html: string): boolean {
  const stripped = html.replace(/<[^>]+>/g, "").trim();
  return stripped.length === 0;
}