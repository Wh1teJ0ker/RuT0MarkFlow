import { invokeTauriCommand } from "../../services/tauri";
import type {
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
): Promise<{ state: DocumentState; error?: string }> {
  const result = await invokeTauriCommand<DocumentOpenResult>("open_document", {
    rootPath,
    relativePath,
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

  const errorMsg = result.error?.message || "文档打开失败";
  return {
    state: {
      path: null,
      relativePath: null,
      title: "",
      content: "",
      lastSavedContent: "",
      isDirty: false,
      isSaving: false,
      isNew: false,
      openError: errorMsg,
    },
    error: errorMsg,
  };
}

/**
 * Save content to an existing Markdown document (overwrite).
 */
export async function saveDocument(
  rootPath: string,
  relativePath: string,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await invokeTauriCommand<DocumentSaveResult>("save_document", {
    rootPath,
    relativePath,
    content,
  });

  if (result.success && result.data) {
    return { success: true };
  }
  return {
    success: false,
    error: result.error?.message || "文档保存失败",
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
  error?: string;
}> {
  const result = await invokeTauriCommand<PickSavePathResult>("pick_save_path", {
    rootPath,
    defaultName,
  });

  if (result.error?.code === "CANCELLED") {
    return { cancelled: true };
  }

  if (result.success && result.data) {
    return { cancelled: false, path: result.data };
  }

  return {
    cancelled: false,
    error: result.error?.message || "保存路径选择失败",
  };
}

/**
 * Save content to a new target path (save-as).
 */
export async function saveDocumentAs(
  rootPath: string,
  targetPath: string,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await invokeTauriCommand<DocumentSaveResult>("save_document_as", {
    rootPath,
    targetPath,
    content,
  });

  if (result.success && result.data) {
    return { success: true };
  }
  return {
    success: false,
    error: result.error?.message || "另存为失败",
  };
}