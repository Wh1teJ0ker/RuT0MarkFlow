/**
 * Tauri command invocation wrapper.
 *
 * Provides a typed `invoke` helper that wraps @tauri-apps/api's invoke
 * and normalizes error handling to our CommandResponse shape.
 *
 * Usage:
 *   import { invokeTauriCommand } from "../services/tauri";
 *   const result = await invokeTauriCommand<HealthCheckResult>("health_check");
 *
 * TODO:
 *  - Add request/response logging in debug mode
 *  - Add timeout / retry logic for idempotent commands
 */

import { invoke } from "@tauri-apps/api/core";
import type { CommandResponse } from "../../types";

/**
 * Wraps a Tauri command invocation and extracts data or throws.
 *
 * Returns the parsed response as CommandResponse<T>.
 * The caller should inspect `.success` and `.data` / `.error`.
 */
export async function invokeTauriCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<CommandResponse<T>> {
  try {
    const raw = await invoke<CommandResponse<T>>(command, args);
    return raw;
  } catch (err) {
    // Unexpected invocation-level error (e.g. command not found)
    return {
      success: false,
      data: null,
      error: {
        code: "INVOKE_ERROR",
        message: `调用命令 "${command}" 失败: ${err instanceof Error ? err.message : String(err)}`,
        detail: undefined,
        recoverable: false,
      },
    };
  }
}