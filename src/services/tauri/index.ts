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
import type {
  AppErrorDisplay,
  AppErrorDomain,
  AppErrorOperation,
  AppErrorPayload,
  AppRecoveryAction,
  CommandResponse,
  DocumentStatusDescriptor,
} from "../../types";

export interface AppErrorContext {
  domain: AppErrorDomain;
  operation: AppErrorOperation;
  fallbackMessage: string;
  recoveryAction?: AppRecoveryAction;
  recoverable?: boolean;
}

const ERROR_TITLES: Record<AppErrorOperation, string> = {
  "open-document": "文档打开失败",
  "save-document": "保存失败",
  "save-document-as": "另存为失败",
  "pick-save-path": "保存路径选择失败",
  "select-workspace": "工作区加载失败",
  "load-workspace": "工作区加载失败",
  "restore-workspace": "工作区恢复失败",
  "refresh-workspace": "工作区刷新失败",
  "invoke-command": "应用操作失败",
};

const RECOVERY_LABELS: Record<AppRecoveryAction, string | null> = {
  "retry-open-document": "重试打开文档",
  "retry-save-document": "重试保存",
  "reselect-workspace": "重新选择工作区",
  none: null,
};

function normalizeErrorMessage(
  message: string | null | undefined,
  fallbackMessage: string,
): string {
  const normalized = message?.trim();
  return normalized ? normalized : fallbackMessage;
}

export function withAppErrorContext(
  error: AppErrorPayload | null | undefined,
  context: AppErrorContext,
): AppErrorPayload {
  const baseRecoverable =
    typeof error?.recoverable === "boolean"
      ? error.recoverable
      : (context.recoverable ?? false);

  return {
    code: error?.code || "UNKNOWN_ERROR",
    message: normalizeErrorMessage(error?.message, context.fallbackMessage),
    detail: error?.detail,
    recoverable: baseRecoverable,
    domain: context.domain,
    operation: context.operation,
    recoveryAction: baseRecoverable
      ? (context.recoveryAction ?? error?.recoveryAction ?? "none")
      : "none",
  };
}

export function getAppErrorDisplay(
  error: AppErrorPayload | null | undefined,
): AppErrorDisplay | null {
  if (!error) {
    return null;
  }

  const title = ERROR_TITLES[error.operation ?? "invoke-command"];
  const actionLabel = error.recoverable
    ? RECOVERY_LABELS[error.recoveryAction ?? "none"]
    : null;

  return {
    title,
    description: error.message,
    statusMessage: `${title}: ${error.message}`,
    actionLabel,
    canRetry: Boolean(actionLabel),
  };
}

export function getDocumentStatusDescriptor({
  isDirty,
  isSaving,
  hasDocument,
  isNew,
  saveError,
}: {
  isDirty: boolean;
  isSaving: boolean;
  hasDocument: boolean;
  isNew: boolean;
  saveError: AppErrorPayload | null;
}): DocumentStatusDescriptor {
  if (saveError) {
    const display = getAppErrorDisplay(saveError);
    return {
      label: display?.statusMessage ?? "保存失败",
      tone: "error",
      retryable: Boolean(display?.canRetry),
      retryLabel: display?.actionLabel ?? undefined,
    };
  }

  if (isSaving) {
    return { label: "正在保存…", tone: "saving", retryable: false };
  }
  if (isNew) {
    return { label: "新建文档（未保存）", tone: "default", retryable: false };
  }
  if (isDirty) {
    return { label: "未保存", tone: "dirty", retryable: false };
  }
  if (hasDocument) {
    return { label: "已保存", tone: "default", retryable: false };
  }

  return { label: "", tone: "default", retryable: false };
}

/**
 * Wraps a Tauri command invocation and extracts data or throws.
 *
 * Returns the parsed response as CommandResponse<T>.
 * The caller should inspect `.success` and `.data` / `.error`.
 */
export async function invokeTauriCommand<T>(
  command: string,
  args?: Record<string, unknown>,
  errorContext?: AppErrorContext,
): Promise<CommandResponse<T>> {
  try {
    const raw = await invoke<CommandResponse<T>>(command, args);

    if (!errorContext || raw.success) {
      return raw;
    }

    return {
      ...raw,
      error: withAppErrorContext(raw.error, errorContext),
    };
  } catch (err) {
    // Unexpected invocation-level error (e.g. command not found)
    const invokeError: AppErrorPayload = {
      code: "INVOKE_ERROR",
      message: `调用命令 "${command}" 失败: ${err instanceof Error ? err.message : String(err)}`,
      detail: undefined,
      recoverable: false,
      domain: "system",
      operation: "invoke-command",
      recoveryAction: "none",
    };

    return {
      success: false,
      data: null,
      error: errorContext
        ? withAppErrorContext(invokeError, {
            ...errorContext,
            recoverable: false,
            recoveryAction: "none",
          })
        : invokeError,
    };
  }
}
