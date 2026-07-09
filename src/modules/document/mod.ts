import { invokeTauriCommand } from "../../services/tauri";
import type {
  AppErrorPayload,
  DocumentOpenResult,
  DocumentSaveResult,
  DocumentState,
  PickSavePathResult,
} from "../../types";

/**
 * Open a Markdown document from the current workspace.
 */
export async function openDocument(
  rootPath: string,
  relativePath: string,
): Promise<{ state: DocumentState; error?: AppErrorPayload }> {
  const result = await invokeTauriCommand<DocumentOpenResult>("open_document", {
    rootPath,
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
 */
export async function saveDocument(
  rootPath: string,
  relativePath: string,
  content: string,
): Promise<{ success: boolean; error?: AppErrorPayload }> {
  const result = await invokeTauriCommand<DocumentSaveResult>("save_document", {
    rootPath,
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
    return { success: true };
  }
  return {
    success: false,
    error: result.error ?? undefined,
  };
}

/**
 * Open the system save-as dialog and return the selected path info.
 */
export async function pickSavePath(
  rootPath: string,
  defaultName: string,
): Promise<{
  cancelled: boolean;
  path?: PickSavePathResult;
  error?: AppErrorPayload;
}> {
  const result = await invokeTauriCommand<PickSavePathResult>("pick_save_path", {
    rootPath,
    defaultName,
  }, {
    domain: "document",
    operation: "pick-save-path",
    fallbackMessage: "暂时无法选择保存路径",
    recoveryAction: "retry-save-document",
    recoverable: true,
  });

  if (result.error?.code === "CANCELLED") {
    return { cancelled: true };
  }

  if (result.success && result.data) {
    return { cancelled: false, path: result.data };
  }

  return {
    cancelled: false,
    error: result.error ?? undefined,
  };
}

/**
 * Save content to a new target path (save-as).
 */
export async function saveDocumentAs(
  rootPath: string,
  targetPath: string,
  content: string,
): Promise<{ success: boolean; error?: AppErrorPayload }> {
  const result = await invokeTauriCommand<DocumentSaveResult>("save_document_as", {
    rootPath,
    targetPath,
    content,
  }, {
    domain: "document",
    operation: "save-document-as",
    fallbackMessage: "暂时无法完成另存为",
    recoveryAction: "retry-save-document",
    recoverable: true,
  });

  if (result.success && result.data) {
    return { success: true };
  }
  return {
    success: false,
    error: result.error ?? undefined,
  };
}
