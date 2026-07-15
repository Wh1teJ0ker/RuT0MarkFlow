/**
 * Lightweight frontend logger.
 *
 * Features:
 * - Level filtering (trace/debug/info/warn/error) gated by __LOG_LEVEL__
 *   injected by vite.config.ts (dev=debug, release=info).
 * - Ring buffer (max 500 entries) for later inspection (e.g. UI log viewer).
 * - Console output with timestamp + level prefix.
 * - Fire-and-forget forwarding to the Rust backend via the Tauri log plugin.
 *
 * Note: forwardToBackend uses a dynamic import of "@tauri-apps/api/core" so
 * that non-Tauri environments (e.g. vitest) do not load the Tauri API at
 * module evaluation time. Failures are swallowed (console-only fallback).
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

// __LOG_LEVEL__ is injected by vite.config.ts (dev=debug, release=info)
declare const __LOG_LEVEL__: string;

const CURRENT_LEVEL: LogLevel = (
  typeof __LOG_LEVEL__ !== "undefined" ? __LOG_LEVEL__ : "info"
) as LogLevel;

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

const MAX_BUFFER = 500;
const buffer: LogEntry[] = [];

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[CURRENT_LEVEL];
}

function formatMessage(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): string {
  const ts = new Date().toISOString();
  const ctx = context ? ` ${JSON.stringify(context)}` : "";
  return `[${ts}] [${level.toUpperCase()}] ${message}${ctx}`;
}

function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = { level, message, timestamp: Date.now(), context };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  const formatted = formatMessage(level, message, context);
  switch (level) {
    case "trace":
    case "debug":
      console.debug(formatted);
      break;
    case "info":
      console.info(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "error":
      console.error(formatted);
      break;
  }

  // Forward to Rust backend (fire-and-forget, never block)
  void forwardToBackend(entry);
}

async function forwardToBackend(entry: LogEntry): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("plugin:log|log", {
      level: entry.level,
      message: entry.message,
    });
  } catch {
    // Backend not available (e.g. dev mode without Tauri) — console only
  }
}

export const logger = {
  trace: (message: string, context?: Record<string, unknown>) =>
    log("trace", message, context),
  debug: (message: string, context?: Record<string, unknown>) =>
    log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    log("error", message, context),
  getBuffer: (): readonly LogEntry[] => buffer,
  getLevel: (): LogLevel => CURRENT_LEVEL,
};
