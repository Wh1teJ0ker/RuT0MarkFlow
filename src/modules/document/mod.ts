import { invokeTauriCommand } from "../../services/tauri";
import { logger } from "../../services/logger";
import type {
  AppErrorPayload,
  DocumentOpenResult,
  DocumentSaveResult,
  DocumentState,
  PickSavePathResult,
} from "../../types";

/**
 * Open a Markdown document from the current authorised workspace.
 *
 * The workspace root is read from the Rust-side AppState; the front-end no
 * longer supplies a `rootPath`.
 */
export async function openDocument(
  relativePath: string,
): Promise<{ state: DocumentState; error?: AppErrorPayload }> {
  const result = await invokeTauriCommand<DocumentOpenResult>("open_document", {
    relativePath,
  }, {
    domain: "document",
    operation: "open-document",
    fallbackMessage: "暂时无法打开该文档",
    recoveryAction: "retry-open-document",
    recoverable: true,
  });

  if (result.success && result.data) {
    const doc = result.data;
    logger.info("Document opened", { relativePath });
    return {
      state: {
        path: doc.path,
        relativePath: doc.relativePath,
        title: doc.path,
        content: doc.content,
        lastSavedContent: doc.content,
        isDirty: false,
        isSaving: false,
        isNew: false,
      },
    };
  }

  const error = result.error;
  logger.warn("Failed to open document", { relativePath, code: error?.code, message: error?.message });
  return {
    state: {
      path: null,
      relativePath,
      title: relativePath,
      content: "",
      lastSavedContent: "",
      isDirty: false,
      isSaving: false,
      isNew: false,
      openError: error ?? undefined,
    },
    error: error ?? undefined,
  };
}

/**
 * Save content to an existing Markdown document (overwrite).
 *
 * The workspace root is read from the Rust-side AppState; the front-end no
 * longer supplies a `rootPath`.
 */
export async function saveDocument(
  relativePath: string,
  content: string,
): Promise<{ success: boolean; error?: AppErrorPayload }> {
  const result = await invokeTauriCommand<DocumentSaveResult>("save_document", {
    relativePath,
    content,
  }, {
    domain: "document",
    operation: "save-document",
    fallbackMessage: "暂时无法保存当前文档",
    recoveryAction: "retry-save-document",
    recoverable: true,
  });

  if (result.success && result.data) {
    logger.info("Document saved", { relativePath });
    return { success: true };
  }
  logger.warn("Failed to save document", { relativePath, code: result.error?.code, message: result.error?.message });
  return {
    success: false,
    error: result.error ?? undefined,
  };
}

/**
 * Open the system save-as dialog and return the selected path info.
 *
 * The workspace root is read from the Rust-side AppState to determine
 * whether the picked path falls within the authorised workspace.
 */
export async function pickSavePath(
  defaultName: string,
): Promise<{
  cancelled: boolean;
  path?: PickSavePathResult;
  error?: AppErrorPayload;
}> {
  const result = await invokeTauriCommand<PickSavePathResult>("pick_save_path", {
    defaultName,
  }, {
    domain: "document",
    operation: "pick-save-path",
    fallbackMessage: "暂时无法选择保存路径",
    recoveryAction: "retry-save-document",
    recoverable: true,
  });

  if (result.error?.code === "CANCELLED") {
    logger.debug("Save path picker cancelled");
    return { cancelled: true };
  }

  if (result.success && result.data) {
    return { cancelled: false, path: result.data };
  }

  logger.warn("Failed to pick save path", { code: result.error?.code, message: result.error?.message });
  return {
    cancelled: false,
    error: result.error ?? undefined,
  };
}

/**
 * Save content to a new target path (save-as).
 *
 * The target path is no longer supplied by the front-end. Instead the
 * one-time `saveToken` returned by `pickSavePath` is passed back; the Rust
 * side consumes the token and reads the bound path from AppState, so a
 * compromised webview cannot forge an arbitrary target path.
 */
export async function saveDocumentAs(
  saveToken: string,
  content: string,
): Promise<{ success: boolean; error?: AppErrorPayload }> {
  const result = await invokeTauriCommand<DocumentSaveResult>("save_document_as", {
    saveToken,
    content,
  }, {
    domain: "document",
    operation: "save-document-as",
    fallbackMessage: "暂时无法完成另存为",
    recoveryAction: "retry-save-document",
    recoverable: true,
  });

  if (result.success && result.data) {
    logger.info("Document saved as new file");
    return { success: true };
  }
  logger.warn("Failed to save document as", { code: result.error?.code, message: result.error?.message });
  return {
    success: false,
    error: result.error ?? undefined,
  };
}
