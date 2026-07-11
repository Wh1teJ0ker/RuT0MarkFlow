import { invokeTauriCommand } from "../../services/tauri";
import type {
  UpdateCheckResult,
  UpdateInstallResult,
  AppErrorPayload,
} from "../../types";

/**
 * Result of an update check attempt.
 */
export interface UpdateCheckResponse {
  result: UpdateCheckResult | null;
  error: AppErrorPayload | null;
}

/**
 * Result of an update install attempt.
 */
export interface UpdateInstallResponse {
  result: UpdateInstallResult | null;
  error: AppErrorPayload | null;
}

/**
 * Classify an update error into a user-friendly Chinese message.
 *
 * Heuristic:
 *  - Network-level errors (connection refused, DNS failure, timeout) -> "无法连接更新服务器"
 *  - HTTP 404 or "not found" -> "更新源未配置，请等待发布"
 *  - Otherwise -> original message
 */
function classifyUpdateError(error: AppErrorPayload): AppErrorPayload {
  const msg = error.message || "";
  const isNetworkError =
    /(?:connect(?:ion)?\s*(?:refused|reset|timed?out)|dns|network|timeout|econnrefused|enotfound|econnreset)/i.test(
      msg,
    );
  const is404 = /(?:404|not ?found|status 404)/i.test(msg);

  if (isNetworkError) {
    return { ...error, message: "无法连接更新服务器" };
  }
  if (is404) {
    return { ...error, message: "更新源未配置，请等待发布" };
  }
  return error;
}

/**
 * Check for updates via the Tauri updater plugin.
 *
 * Calls the `check_for_updates` Tauri command which queries GitHub Releases.
 * Errors are wrapped in structured AppErrorPayload (domain: system, operation: check-update).
 * Error messages are classified into user-friendly Chinese strings.
 */
export async function checkForUpdates(): Promise<UpdateCheckResponse> {
  const result = await invokeTauriCommand<UpdateCheckResult>(
    "check_for_updates",
    {},
    {
      domain: "system",
      operation: "check-update",
      fallbackMessage: "暂时无法检查更新",
      recoveryAction: "retry-check-update",
      recoverable: true,
    },
  );

  if (result.success && result.data) {
    return { result: result.data, error: null };
  }

  return {
    result: null,
    error: result.error ? classifyUpdateError(result.error) : result.error,
  };
}

/**
 * Download and install the available update.
 *
 * Calls the `install_update` Tauri command which downloads, installs,
 * and restarts the application.
 * Errors are wrapped in structured AppErrorPayload (domain: system, operation: install-update).
 */
export async function installUpdate(): Promise<UpdateInstallResponse> {
  const result = await invokeTauriCommand<UpdateInstallResult>(
    "install_update",
    {},
    {
      domain: "system",
      operation: "install-update",
      fallbackMessage: "暂时无法安装更新",
      recoveryAction: "retry-install-update",
      recoverable: true,
    },
  );

  if (result.success && result.data) {
    return { result: result.data, error: null };
  }

  return { result: null, error: result.error };
}