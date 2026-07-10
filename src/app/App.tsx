import { useState, useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import MainLayout from "../components/layout/MainLayout";
import Toolbar from "../components/toolbar/Toolbar";
import Sidebar from "../components/sidebar/Sidebar";
import ContentArea from "../components/content/ContentArea";
import StatusBar from "../components/statusbar/StatusBar";
import { VERSION_DETAILS, VERSION_SUMMARY } from "../version";
import { UnsavedConfirmDialog } from "../components/dialogs";
import {
  getAppErrorDisplay,
  getDocumentStatusDescriptor,
  withAppErrorContext,
} from "../services/tauri";
import { selectWorkspace, refreshWorkspaceIndex, loadWorkspace, loadAppSettings, saveAppSettings } from "../modules/workspace/mod";
import {
  openDocument,
  saveDocument,
  pickSavePath,
  saveDocumentAs,
} from "../modules/document/mod";
import { checkForUpdates, installUpdate } from "../services/updater/mod";
import { useRender } from "../modules/render/mod";
import { useEditorHistory } from "../hooks/useEditorHistory";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ViewMode,
  WorkspaceState,
  WorkspaceInfo,
  DocumentState,
  IndexTreeNode,
  AppErrorPayload,
  AppSettings,
  DialogAction,
  IndexChangedPayload,
  UpdateStatus,
} from "../types";

function App() {
  // ── Workspace state ──────────────────────────────────────────
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>("idle");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceError, setWorkspaceError] = useState<AppErrorPayload | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [indexTree, setIndexTree] = useState<IndexTreeNode[]>([]);

  // ── Document state ───────────────────────────────────────────
  const [document, setDocument] = useState<DocumentState>({
    path: null,
    relativePath: null,
    title: "",
    content: "",
    lastSavedContent: "",
    isDirty: false,
    isSaving: false,
    isNew: false,
  });
  const [saveError, setSaveError] = useState<AppErrorPayload | null>(null);

  // ── Update state ────────────────────────────────────────────────
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ type: "idle" });

  // ── Unsaved confirm dialog ─────────────────────────────────────
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const resolveConfirmRef = useRef<((action: DialogAction) => void) | null>(null);

  const requestUnsavedConfirm = useCallback((): Promise<DialogAction> => {
    return new Promise((resolve) => {
      resolveConfirmRef.current = resolve;
      setIsConfirmOpen(true);
    });
  }, []);

  const handleConfirmAction = useCallback((action: DialogAction) => {
    setIsConfirmOpen(false);
    const resolve = resolveConfirmRef.current;
    resolveConfirmRef.current = null;
    if (resolve) resolve(action);
  }, []);

  // ── Render state ─────────────────────────────────────────────
  const {
    html: renderedHtml,
    isRendering: isRenderPending,
    imageErrors,
    mathErrors,
    render,
    reportImageError,
    resetRenderErrors,
  } = useRender();

  const renderErrorsRef = useRef<string[]>([]);
  const prevRelativePathRef = useRef<string | null>(null);
  const prevViewModeRef = useRef<ViewMode | null>(null);

  // ── UI state ─────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("split-editor");
  const [statusMessage, setStatusMessage] = useState("就绪");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [renderNonce, setRenderNonce] = useState(0);
  const [isFindBarOpen, setIsFindBarOpen] = useState(false);

  // ── Editor history (undo/redo) ─────────────────────────────────
  const history = useEditorHistory(document.content);

  // ── Theme data-attribute effect ──────────────────────────────
  useEffect(() => {
    if (window.document?.documentElement) {
      window.document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  // ── Render debounce ──────────────────────────────────────────
  const renderDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 250ms debounce for editor content changes. */
  const RENDER_DEBOUNCE_MS = 250;

  // Store latest render params in a ref so the debounce callback always
  // has access to the most recent values (not stale closures).
  const renderParamsRef = useRef({ content: "", docDir: "", rootPath: "" });
  renderParamsRef.current = {
    content: document.content,
    docDir: document.relativePath
      ? document.relativePath.split("/").slice(0, -1).join("/")
      : "",
    rootPath: workspace?.rootPath ?? "",
  };

  const doRender = useCallback((content: string, docDir: string, rootPath: string) => {
    const result = render(content, {
      documentDir: docDir,
      rootPath: rootPath || undefined,
      convertFileSrc,
      onImageError: (src: string) => {
        reportImageError(src);
      },
    });
    if (result) {
      renderErrorsRef.current = result.errors;
    }
  }, []);

  // ── Render effect with debounce ───────────────────────────────
  // Immediate (no debounce): identity change, viewMode change
  // Debounced: editor content changes (continuous typing)
  useEffect(() => {
    const identityChanged =
      document.relativePath !== prevRelativePathRef.current;
    prevRelativePathRef.current = document.relativePath;

    const modeChanged = viewMode !== prevViewModeRef.current;
    prevViewModeRef.current = viewMode;

    const needsImmediate = identityChanged || modeChanged;

    if (identityChanged) {
      resetRenderErrors();
      renderErrorsRef.current = [];
    }

    if (!document.content) {
      if (renderDebounceTimerRef.current) {
        clearTimeout(renderDebounceTimerRef.current);
        renderDebounceTimerRef.current = null;
      }
      render("");
      renderErrorsRef.current = [];
      return;
    }

    // Identity change or viewMode change → immediate render
    if (needsImmediate) {
      if (renderDebounceTimerRef.current) {
        clearTimeout(renderDebounceTimerRef.current);
        renderDebounceTimerRef.current = null;
      }
      const docDir = document.relativePath
        ? document.relativePath.split("/").slice(0, -1).join("/")
        : "";
      doRender(document.content, docDir, workspace?.rootPath ?? "");
      return;
    }

    // Editor content change → debounce
    if (renderDebounceTimerRef.current) {
      clearTimeout(renderDebounceTimerRef.current);
    }
    renderDebounceTimerRef.current = setTimeout(() => {
      renderDebounceTimerRef.current = null;
      // Read latest values from ref (not stale closure)
      const p = renderParamsRef.current;
      doRender(p.content, p.docDir, p.rootPath);
    }, RENDER_DEBOUNCE_MS);

    return () => {
      if (renderDebounceTimerRef.current) {
        clearTimeout(renderDebounceTimerRef.current);
        renderDebounceTimerRef.current = null;
      }
    };
  }, [document.content, document.relativePath, viewMode, renderNonce]);

  // ── Startup: restore last workspace / document / mode ─────────
  const restoreAttemptedRef = useRef(false);

  useEffect(() => {
    if (restoreAttemptedRef.current) return;

    (async () => {
      const settings = await loadAppSettings();
      const mode = settings.viewMode === "immersive-preview"
        ? ("immersive-preview" as ViewMode)
        : ("split-editor" as ViewMode);
      setViewMode(mode);
      setTheme(settings.theme === "dark" ? "dark" : "light");

      // Restore workspace
      const wsPath = settings.recentWorkspacePath;
      if (!wsPath) {
        setStatusMessage("就绪（无最近工作区）");
        restoreAttemptedRef.current = true;
        return;
      }

      setWorkspaceState("loading");
      setStatusMessage("正在恢复上次工作区…");

      const wsResult = await loadWorkspace(wsPath);
      if (wsResult.state !== "ready" || !wsResult.workspace) {
        const restoreError = withAppErrorContext(wsResult.error, {
          domain: "workspace",
          operation: "restore-workspace",
          fallbackMessage: "最近工作区不可用",
          recoveryAction: "reselect-workspace",
          recoverable: true,
        });
        const restoreDisplay = getAppErrorDisplay(restoreError);
        setWorkspaceState("error");
        setWorkspaceError(restoreError);
        setWorkspace(null);
        setFileCount(0);
        setIndexTree([]);
        setStatusMessage(restoreDisplay?.statusMessage ?? "工作区恢复失败");
        // Persist the cleared path
        const updated: AppSettings = {
          ...settings,
          recentWorkspacePath: undefined,
          recentDocumentPath: undefined,
        };
        saveAppSettings(updated);
        restoreAttemptedRef.current = true;
        return;
      }

      // Workspace restored successfully
      setWorkspaceState("ready");
      setWorkspace(wsResult.workspace);
      setWorkspaceError(null);
      setFileCount(wsResult.fileCount);
      setIndexTree(wsResult.indexTree);
      setStatusMessage(`已恢复工作区: ${wsResult.workspace.displayName}`);

      // Restore recent document if within this workspace
      const docRelPath = settings.recentDocumentPath;
      if (!docRelPath) {
        restoreAttemptedRef.current = true;
        return;
      }

      const docResult = await openDocument(wsPath, docRelPath);
      setDocument(docResult.state);
      if (!docResult.error) {
        setStatusMessage(`已恢复工作区与文档: ${docResult.state.title}`);
      } else {
        const docDisplay = getAppErrorDisplay(docResult.error);
        setStatusMessage(
          `已恢复工作区，${docDisplay?.statusMessage ?? "文档打开失败"}`,
        );
      }

      // All restore operations complete — allow persistence saves now
      restoreAttemptedRef.current = true;
    })();
  }, []);

  // ── Persist settings on workspace / document / mode change ────

  useEffect(() => {
    if (!restoreAttemptedRef.current) return; // skip initial mount

    const settings: AppSettings = {
      recentWorkspacePath: workspace?.rootPath,
      recentDocumentPath: document.relativePath ?? undefined,
      viewMode,
      theme,
    };
    saveAppSettings(settings);
  }, [workspace?.rootPath, document.relativePath, viewMode, theme]);

  // ── Helper: refresh index after save-as/new-save ─────────────

  const refreshIndex = useCallback(async () => {
    if (!workspace) return;
    const result = await refreshWorkspaceIndex(workspace.rootPath);
    if (result.state === "ready") {
      setWorkspaceState("ready");
      setWorkspaceError(null);
      setWorkspace(result.workspace);
      setFileCount(result.fileCount);
      setIndexTree(result.indexTree);
      return;
    }

    if (result.error) {
      const errorDisplay = getAppErrorDisplay(result.error);
      setStatusMessage(errorDisplay?.statusMessage ?? "工作区刷新失败");
    }
  }, [workspace]);

  // ── Startup: auto-check for updates (mount-once, silent failure) ─
  const updateCheckAttemptedRef = useRef(false);

  useEffect(() => {
    if (updateCheckAttemptedRef.current) return;
    updateCheckAttemptedRef.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setUpdateStatus({ type: "idle" });
    }, 30_000);

    (async () => {
      setUpdateStatus({ type: "checking" });
      const response = await checkForUpdates();
      if (controller.signal.aborted) return;
      clearTimeout(timeout);

      if (response.result?.available) {
        setUpdateStatus({
          type: "available",
          version: response.result.version ?? "未知",
          notes: response.result.notes,
          date: response.result.date,
        });
      } else {
        setUpdateStatus({ type: "unavailable" });
      }
    })();

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  // ── Window close guard ───────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen("app://close-requested", async () => {
        if (document.isDirty) {
          const action = await requestUnsavedConfirm();
          if (action === "save") {
            const saved = await handleSaveDocument();
            if (!saved) return;
          }
          if (action === "cancel") return;
        }
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().destroy();
      });
    })();
    return () => { unlisten?.(); };
  }, [document.isDirty]);

  // ── Workspace watcher event listener ──────────────────────────
  // Listens for "workspace://index-changed" events emitted by the Rust
  // file-system watcher after a debounced rebuild. Validates rootPath
  // to prevent cross-talk when switching workspaces rapidly.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<IndexChangedPayload>("workspace://index-changed", async (event) => {
        // Verify the event is for the current workspace (prevents cross-talk
        // during workspace switching — stale events from old watcher are ignored)
        if (!workspace || event.payload.rootPath !== workspace.rootPath) {
          return;
        }
        await refreshIndex();
      });
    })();
    return () => { unlisten?.(); };
  }, [workspace?.rootPath]);

  // ── Save (regular) ──────────────────────────────────────────

  const handleSaveDocument = useCallback(async (): Promise<boolean> => {
    if (document.isNew) {
      return await handleSaveAs();
    }
    if (!workspace || !document.relativePath || !document.isDirty) return false;

    setDocument((prev) => ({ ...prev, isSaving: true }));
    setSaveError(null);
    setStatusMessage("正在保存…");

    const result = await saveDocument(
      workspace.rootPath,
      document.relativePath,
      document.content,
    );

    if (result.success) {
      setDocument((prev) => ({
        ...prev,
        isSaving: false,
        isDirty: false,
        lastSavedContent: prev.content,
      }));
      setSaveError(null);
      setStatusMessage(`已保存: ${document.title}`);
      return true;
    } else {
      setDocument((prev) => ({ ...prev, isSaving: false }));
      const error = result.error ?? withAppErrorContext(null, {
        domain: "document",
        operation: "save-document",
        fallbackMessage: "暂时无法保存当前文档",
        recoveryAction: "retry-save-document",
        recoverable: true,
      });
      const errorDisplay = getAppErrorDisplay(error);
      setSaveError(error);
      setStatusMessage(errorDisplay?.statusMessage ?? "保存失败");
      return false;
    }
  }, [workspace, document]);

  // ── Save As ──────────────────────────────────────────────────

  const handleSaveAs = useCallback(async (): Promise<boolean> => {
    if (!workspace) return false;
    const defaultName = document.isNew
      ? "未命名.md"
      : document.title || "document.md";

    const picked = await pickSavePath(workspace.rootPath, defaultName);
    if (picked.cancelled) {
      setSaveError(null);
      setStatusMessage("已取消另存为");
      return false;
    }
    if (picked.error) {
      const errorDisplay = getAppErrorDisplay(picked.error);
      setSaveError(picked.error);
      setStatusMessage(errorDisplay?.statusMessage ?? "保存路径选择失败");
      return false;
    }
    if (!picked.path) return false;

    const targetPath = picked.path.absolutePath;
    const isWithin = picked.path.isWithinWorkspace;
    const relPath = picked.path.relativePath;

    setDocument((prev) => ({ ...prev, isSaving: true }));
    setSaveError(null);
    setStatusMessage("正在保存…");

    const result = await saveDocumentAs(workspace.rootPath, targetPath, document.content);

    if (result.success) {
      setDocument({
        path: relPath || targetPath,
        relativePath: relPath,
        title: relPath || targetPath,
        content: document.content,
        lastSavedContent: document.content,
        isDirty: false,
        isSaving: false,
        isNew: false,
      });
      setSaveError(null);
      if (isWithin) {
        await refreshIndex();
        setStatusMessage(`已另存为: ${relPath || targetPath}（索引已刷新）`);
      } else {
        setStatusMessage(`已另存为: ${targetPath}（工作区外路径）`);
      }
      return true;
    } else {
      setDocument((prev) => ({ ...prev, isSaving: false }));
      const error = result.error ?? withAppErrorContext(null, {
        domain: "document",
        operation: "save-document-as",
        fallbackMessage: "暂时无法完成另存为",
        recoveryAction: "retry-save-document",
        recoverable: true,
      });
      const errorDisplay = getAppErrorDisplay(error);
      setSaveError(error);
      setStatusMessage(errorDisplay?.statusMessage ?? "另存为失败");
      return false;
    }
  }, [workspace, document.content, document.isNew, document.title, refreshIndex]);

  // ── New Document ─────────────────────────────────────────────

  const handleNewDocument = useCallback(async () => {
    if (document.isDirty) {
      const action = await requestUnsavedConfirm();
      if (action === "save") {
        const saved = await handleSaveDocument();
        if (!saved) return;
      }
      if (action === "cancel") return;
    }
    history.clear();
    setDocument({
      path: null, relativePath: null, title: "未命名",
      content: "", lastSavedContent: "",
      isDirty: false, isSaving: false, isNew: true,
    });
    setSaveError(null);
    setStatusMessage("新建文档 — 输入内容后保存以落盘");
  }, [document.isDirty, handleSaveDocument, history]);

  // ── Undo / Redo ──────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    const prev = history.undo(document.content);
    if (prev !== null) {
      setDocument((cur) => ({ ...cur, content: prev, isDirty: prev !== cur.lastSavedContent }));
    }
  }, [history, document.content]);

  const handleRedo = useCallback(() => {
    const next = history.redo(document.content);
    if (next !== null) {
      setDocument((cur) => ({ ...cur, content: next, isDirty: next !== cur.lastSavedContent }));
    }
  }, [history, document.content]);

  // ── Theme toggle ─────────────────────────────────────────────

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  // ── Image retry (bump renderNonce to force re-render) ─────────

  const handleRetryImage = useCallback((_src: string) => {
    setRenderNonce((n) => n + 1);
  }, []);

  // ── Workspace selection ──────────────────────────────────────

  const handleSelectWorkspace = useCallback(async () => {
    if (document.isDirty) {
      const action = await requestUnsavedConfirm();
      if (action === "save") {
        const saved = await handleSaveDocument();
        if (!saved) return; // save failed or cancelled
      }
      if (action === "cancel") return;
      // action === "discard": fall through
    }
    history.clear();
    setWorkspaceState("loading");
    setStatusMessage("正在扫描 Markdown 文件…");
    const result = await selectWorkspace();
    setWorkspaceState(result.state);
    setWorkspace(result.workspace);
    setWorkspaceError(result.error);
    setFileCount(result.fileCount);
    setIndexTree(result.indexTree);
    setSaveError(null);
    setDocument({
      path: null, relativePath: null, title: "", content: "",
      lastSavedContent: "", isDirty: false, isSaving: false, isNew: false,
    });
    if (result.state === "ready" && result.workspace) {
      setStatusMessage(`已加载工作区: ${result.workspace.displayName}（${result.fileCount} 个 Markdown 文件）`);
    } else if (result.state === "error" && result.error) {
      const errorDisplay = getAppErrorDisplay(result.error);
      setStatusMessage(errorDisplay?.statusMessage ?? "工作区加载失败");
    } else {
      setStatusMessage("就绪");
    }
  }, [document.isDirty, history]);

  const [isDocumentOpening, setIsDocumentOpening] = useState(false);
  const [pendingDocumentPath, setPendingDocumentPath] = useState<string | null>(null);
  const openReqCounterRef = useRef(0);

  const handleOpenDocument = useCallback(
    async (relativePath: string) => {
      // Same-path fast path: skip if already viewing this document
      if (relativePath === document.relativePath && document.path && !document.openError) {
        return;
      }

      if (document.isDirty) {
        const action = await requestUnsavedConfirm();
        if (action === "save") {
          const saved = await handleSaveDocument();
          if (!saved) return;
        }
        if (action === "cancel") return;
      }
      if (!workspace) { setStatusMessage("未选择工作区"); return; }

      // Track request for latest-request-wins
      const requestId = ++openReqCounterRef.current;

      setIsDocumentOpening(true);
      setPendingDocumentPath(relativePath);
      setStatusMessage(`正在打开: ${relativePath}…`);

      const result = await openDocument(workspace.rootPath, relativePath);

      // latest-request-wins: discard stale responses
      if (requestId !== openReqCounterRef.current) {
        return;
      }

      setIsDocumentOpening(false);
      setPendingDocumentPath(null);
      history.clear();
      setDocument(result.state);
      setSaveError(null);
      if (result.error) {
        const errorDisplay = getAppErrorDisplay(result.error);
        setStatusMessage(errorDisplay?.statusMessage ?? "文档打开失败");
      } else {
        setStatusMessage(`已打开: ${result.state.title}`);
      }
    },
    [workspace, document.isDirty, document.relativePath, document.path, document.openError],
  );

  // ── Item A: Close current document ──────────────────────────────

  const doCloseDocument = useCallback(() => {
    history.clear();
    setDocument({
      path: null, relativePath: null, title: "", content: "",
      lastSavedContent: "", isDirty: false, isSaving: false, isNew: false,
    });
    setSaveError(null);
    setStatusMessage("已关闭当前文档");
  }, [history]);

  const handleCloseDocument = useCallback(() => {
    if (document.isDirty) {
      requestUnsavedConfirm().then((action) => {
        if (action === "save") {
          handleSaveDocument().then((saved) => {
            if (saved) doCloseDocument();
          });
        } else if (action === "discard") {
          doCloseDocument();
        }
        // cancel → 不关
      });
      return;
    }
    doCloseDocument();
  }, [document.isDirty, handleSaveDocument, doCloseDocument]);

  // ── Content change ───────────────────────────────────────────

  const handleContentChange = useCallback((newContent: string) => {
    setDocument((prev) => {
      if (prev.content !== newContent) {
        history.push(prev.content);
      }
      return {
        ...prev,
        content: newContent,
        isDirty: newContent !== prev.lastSavedContent,
      };
    });
    setSaveError(null);
  }, [history]);

  // ── View mode toggle ─────────────────────────────────────────

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setStatusMessage(
      mode === "immersive-preview" ? "已切换至无感预览模式" : "已切换至双栏编辑模式",
    );
  }, []);

  // ── Updater callbacks ────────────────────────────────────────────

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateStatus({ type: "checking" });
    setStatusMessage("正在检查更新…");
    const response = await checkForUpdates();
    if (response.result?.available) {
      setUpdateStatus({
        type: "available",
        version: response.result.version ?? "未知",
        notes: response.result.notes,
        date: response.result.date,
      });
      setStatusMessage(`发现新版本 v${response.result.version}`);
    } else if (response.error) {
      setUpdateStatus({ type: "error", message: response.error.message });
      setStatusMessage("检查更新失败");
    } else {
      setUpdateStatus({ type: "unavailable" });
      setStatusMessage("当前已是最新版本");
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    setUpdateStatus({ type: "installing" });
    setStatusMessage("正在下载并安装更新…");
    const response = await installUpdate();
    if (response.result?.success) {
      setStatusMessage("更新安装完成，应用即将重启");
      // The app will restart automatically after install
    } else if (response.error) {
      setUpdateStatus({ type: "error", message: response.error.message });
      setStatusMessage("更新安装失败");
    } else {
      setUpdateStatus({ type: "idle" });
      setStatusMessage("更新安装未完成");
    }
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────
  // Must come after handleUndo/handleRedo/handleViewModeChange/handleSelectWorkspace

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        handleSaveAs();
      } else if (meta && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        handleSaveDocument();
      } else if (meta && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        handleNewDocument();
      } else if (meta && e.shiftKey && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        handleRedo();
      } else if (meta && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        handleUndo();
      } else if (meta && e.key === "1") {
        e.preventDefault();
        handleViewModeChange("immersive-preview");
      } else if (meta && e.key === "2") {
        e.preventDefault();
        handleViewModeChange("split-editor");
      } else if (meta && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        handleSelectWorkspace();
      } else if (meta && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        handleCloseDocument();
      } else if (meta && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setIsFindBarOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSaveDocument, handleSaveAs, handleNewDocument, handleUndo, handleRedo, handleViewModeChange, handleSelectWorkspace, handleCloseDocument, setIsFindBarOpen]);

  // ── Derived state ───────────────────────────────────────────
  const hasWorkspace = workspaceState === "ready";
  const hasDocument = document.path !== null || document.isNew || Boolean(document.openError);
  const isLoading = workspaceState === "loading";
  const renderErrorCount =
    renderErrorsRef.current.length +
    imageErrors.length +
    mathErrors.length;
  const docStatus = getDocumentStatusDescriptor({
    isDirty: document.isDirty,
    isSaving: document.isSaving,
    hasDocument,
    isNew: document.isNew,
    saveError,
  });
  const handleRetrySave =
    saveError?.operation === "save-document"
      ? handleSaveDocument
      : saveError?.operation
        ? handleSaveAs
        : undefined;

  // ── Render ──────────────────────────────────────────────────
  return (
    <>
      <MainLayout
        toolbar={
          <Toolbar
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            onSelectWorkspace={handleSelectWorkspace}
            onSave={handleSaveDocument}
            onSaveAs={handleSaveAs}
            onNewDocument={handleNewDocument}
            onCloseDocument={handleCloseDocument}
            hasWorkspace={hasWorkspace}
            hasDocument={hasDocument}
            isDirty={document.isDirty}
            isLoading={isLoading}
            isSaving={document.isSaving}
            isNew={document.isNew}
            workspaceState={workspaceState}
            theme={theme}
            onToggleTheme={handleToggleTheme}
          />
        }
        sidebar={
          <Sidebar
            workspace={workspace}
            workspaceState={workspaceState}
            workspaceError={workspaceError}
            fileCount={fileCount}
            indexTree={indexTree}
            onOpenDocument={handleOpenDocument}
            activeDocumentRelativePath={document.relativePath}
            onSelectWorkspace={handleSelectWorkspace}
          />
        }
        content={
          <ContentArea
            document={document}
            viewMode={viewMode}
            hasWorkspace={hasWorkspace}
            onContentChange={handleContentChange}
            renderedHtml={renderedHtml}
            isRenderPending={isRenderPending}
            hasRenderErrors={renderErrorCount > 0}
            onOpenDocument={handleOpenDocument}
            onImageError={(src) => {
              reportImageError(src);
            }}
            isOpening={isDocumentOpening}
            openingPath={pendingDocumentPath}
            onRetryImage={handleRetryImage}
            isFindBarOpen={isFindBarOpen}
            onCloseFindBar={() => setIsFindBarOpen(false)}
          />
        }
        statusBar={
          <StatusBar
            message={statusMessage}
            workspace={workspace}
            workspaceState={workspaceState}
            fileCount={fileCount}
            docStatus={docStatus}
            renderErrorCount={renderErrorCount}
            viewMode={viewMode}
            documentTitle={document.title}
            versionSummary={VERSION_SUMMARY}
            versionDetails={VERSION_DETAILS}
            onRetrySave={handleRetrySave}
            updateStatus={updateStatus}
            onCheckForUpdates={handleCheckForUpdates}
            onInstallUpdate={handleInstallUpdate}
          />
        }
      />
      <UnsavedConfirmDialog
        open={isConfirmOpen}
        onAction={handleConfirmAction}
      />
    </>
  );
}

export default App;
