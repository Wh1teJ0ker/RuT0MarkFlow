/**
 * Unit tests for the frontend logger module.
 *
 * Covers:
 * - Level filtering (trace suppressed when level=debug/info)
 * - Ring buffer cap at 500 entries (oldest evicted)
 * - Buffer entry shape
 * - console.debug/info/warn/error spy calls
 * - forwardToBackend failure does not throw (Tauri API unavailable in vitest)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Tauri core module so the dynamic import inside forwardToBackend
// resolves without attempting to load the real native binding.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("backend unavailable")),
}));

import { logger } from "../index";

describe("logger", () => {
  let consoleSpies: Record<
    "debug" | "info" | "warn" | "error",
    ReturnType<typeof vi.spyOn>
  >;

  beforeEach(() => {
    consoleSpies = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes the configured level", () => {
    // In vitest, __LOG_LEVEL__ is not injected, so the fallback "info" is used.
    expect(logger.getLevel()).toBe("info");
  });

  it("writes info-level messages to console.info", () => {
    logger.info("hello");
    expect(consoleSpies.info).toHaveBeenCalledTimes(1);
    const formatted = String(consoleSpies.info.mock.calls[0][0]);
    expect(formatted).toContain("[INFO]");
    expect(formatted).toContain("hello");
  });

  it("writes warn-level messages to console.warn", () => {
    logger.warn("careful");
    expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
    expect(String(consoleSpies.warn.mock.calls[0][0])).toContain("careful");
  });

  it("writes error-level messages to console.error", () => {
    logger.error("boom");
    expect(consoleSpies.error).toHaveBeenCalledTimes(1);
    expect(String(consoleSpies.error.mock.calls[0][0])).toContain("boom");
  });

  it("suppresses debug when current level is info (fallback)", () => {
    // fallback level is "info" → debug (priority 1) < info (priority 2)
    logger.debug("dbg");
    expect(consoleSpies.debug).not.toHaveBeenCalled();
  });

  it("suppresses trace when current level is info (fallback)", () => {
    // fallback level is "info" → trace (priority 0) < info (priority 2)
    logger.trace("should not appear");
    expect(consoleSpies.debug).not.toHaveBeenCalled();
  });

  it("records entries in the buffer with correct shape", () => {
    logger.info("buffered", { foo: 1 });
    const buf = logger.getBuffer();
    const last = buf[buf.length - 1];
    expect(last).toMatchObject({
      level: "info",
      message: "buffered",
      context: { foo: 1 },
    });
    expect(typeof last.timestamp).toBe("number");
  });

  it("caps the ring buffer at 500 entries, evicting the oldest", () => {
    // Fill beyond MAX_BUFFER (500). Buffer may already contain entries from
    // prior tests, but once we add 510, it should be clamped to 500.
    for (let i = 0; i < 510; i++) {
      logger.info(`fill-${i}`);
    }
    const after = logger.getBuffer();
    expect(after.length).toBeLessThanOrEqual(500);
    // The oldest remaining entry should be one of the most recent fills,
    // not an entry from before this loop (the first 10 were evicted).
    const firstRemaining = after[0];
    expect(firstRemaining.message).toBe("fill-10");
  });

  it("does not throw when backend forwarding fails", async () => {
    // The mocked invoke rejects; ensure calling error does not throw.
    expect(() => logger.error("fire-and-forget")).not.toThrow();
    // Allow microtasks to flush the rejected dynamic import.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleSpies.error).toHaveBeenCalled();
  });

  it("formats context as JSON suffix", () => {
    logger.warn("ctx", { a: 1 });
    const formatted = String(consoleSpies.warn.mock.calls[0][0]);
    expect(formatted).toContain('{"a":1}');
  });
});
