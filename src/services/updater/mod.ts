import { invokeTauriCommand } from "../../services/tauri";
import { logger } from "../logger";
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
 *  - Release metadata incomplete / not yet published -> "更新发布尚未完成，请稍后重试"
 *  - Otherwise -> original message
 */
export function classifyUpdateError(error: AppErrorPayload): AppErrorPayload {
  const msg = error.message || "";
  const isNetworkError =
    /(?:connect(?:ion)?\s*(?:refused|reset|timed?out)|dns|network|timeout|econnrefused|enotfound|econnreset)/i.test(
      msg,
    );
  const is404 = /(?:404|not ?found|status 404)/i.test(msg);
  const isReleaseJsonUnavailable =
    /could not fetch a valid release json from the remote/i.test(msg);
  const isPlatformMissing =
    /platform .* was not found in the response .*platforms.*object/i.test(msg) ||
    /none of the fallback platforms .* were found in the response .*platforms.*object/i.test(msg);

  if (isNetworkError) {
    const result = { ...error, message: "无法连接更新服务器" };
    logger.debug("Update error classified", { original: error.message, classified: result.message });
    return result;
  }
  if (isReleaseJsonUnavailable || isPlatformMissing) {
    const result = { ...error, message: "更新发布尚未完成，请稍后重试" };
    logger.debug("Update error classified", { original: error.message, classified: result.message });
    return result;
  }
  if (is404) {
    const result = { ...error, message: "更新源未配置，请等待发布" };
    logger.debug("Update error classified", { original: error.message, classified: result.message });
    return result;
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
  logger.info("Checking for updates...");
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
    if (result.data.available) {
      logger.info("Update available", { version: result.data.version });
    } else {
      logger.info("No update available");
    }
    return { result: result.data, error: null };
  }

  logger.warn("Update check failed", { code: result.error?.code, message: result.error?.message });
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
  logger.info("Installing update...");
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
    logger.info("Update installed successfully");
    return { result: result.data, error: null };
  }

  logger.error("Update install failed", { code: result.error?.code, message: result.error?.message });
  return { result: null, error: result.error };
}
