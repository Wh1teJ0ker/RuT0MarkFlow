/**
 * RuT0MarkFlow — Shared TypeScript type definitions.
 *
 * These types mirror the Rust-side models and define the contract
 * between the Tauri backend and the React frontend.
 *
 * All interfaces are MVP-placeholder ready;
 * fields marked TODO are deferred beyond the initial skeleton phase.
 */

// ── Workspace state machine ─────────────────────────────────────

export type WorkspaceState = "idle" | "loading" | "ready" | "error";

export interface WorkspaceLoadResult {
  workspace: WorkspaceInfo;
  indexTree: IndexTreeNode[];
  flatEntries: IndexEntry[];
  restoredDocumentPath?: string;
}

// ── Workspace ──────────────────────────────────────────────────

export interface WorkspaceInfo {
  rootPath: string;
  displayName: string;
  isAvailable: boolean;
  fileCount: number;
  lastIndexedAt?: string;
}

// ── Index ──────────────────────────────────────────────────────

export interface IndexEntry {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  parentRelativePath: string;
  extension: "md" | "markdown";
  updatedAt?: string;
  size?: number;
}

export interface IndexTreeNode {
  id: string;
  name: string;
  type: "directory" | "file";
  relativePath: string;
  children?: IndexTreeNode[];
  entry?: IndexEntry;
}

// ── Document ───────────────────────────────────────────────────

export interface DocumentState {
  path: string | null;
  relativePath: string | null;
  title: string;
  content: string;
  lastSavedContent: string;
  isDirty: boolean;
  isSaving: boolean;
  isNew: boolean;
  openError?: AppErrorPayload;
}

// ── View / Render ──────────────────────────────────────────────

export type ViewMode = "immersive-preview" | "split-editor";

export interface RenderOptions {
  documentDir?: string;
  rootPath?: string;
  onOpenDocument?: (relativePath: string) => void;
  /** Tauri convertFileSrc for resolving local file paths to asset URLs. */
  convertFileSrc?: (path: string) => string;
  /** Called when an <img> in the rendered output fails to load. */
  onImageError?: (src: string) => void;
}

export interface RenderResult {
  html: string;
  errors: string[];
  hasDegradedBlocks: boolean;
  imageErrors: string[];
  mathErrors: string[];
}

export interface RenderState {
  html: string;
  lastSourceHash: string;
  isRendering: boolean;
  hasDegradedBlocks: boolean;
  imageErrors: string[];
  mathErrors: string[];
}

// ── Settings ───────────────────────────────────────────────────

export type DialogAction = "save" | "discard" | "cancel";

export interface AppSettings {
  recentWorkspacePath?: string;
  recentDocumentPath?: string;
  theme: "light" | "dark";
  viewMode: ViewMode;
}

// ── Watcher Events ────────────────────────────────────────────

/** Payload of the `workspace://index-changed` event emitted by the Rust watcher. */
export interface IndexChangedPayload {
  rootPath: string;
}

// ── Tauri Command Responses ────────────────────────────────────

export interface CommandResponse<T> {
  success: boolean;
  data: T | null;
  error: AppErrorPayload | null;
}

export interface AppErrorPayload {
  code: string;
  message: string;
  detail?: string;
  recoverable: boolean;
  domain?: AppErrorDomain;
  operation?: AppErrorOperation;
  recoveryAction?: AppRecoveryAction;
}

export type AppErrorDomain = "document" | "workspace" | "system";

export type AppErrorOperation =
  | "open-document"
  | "save-document"
  | "save-document-as"
  | "pick-save-path"
  | "select-workspace"
  | "load-workspace"
  | "restore-workspace"
  | "refresh-workspace"
  | "invoke-command";

export type AppRecoveryAction =
  | "retry-open-document"
  | "retry-save-document"
  | "reselect-workspace"
  | "none";

export interface AppErrorDisplay {
  title: string;
  description: string;
  statusMessage: string;
  actionLabel: string | null;
  canRetry: boolean;
}

export interface DocumentStatusDescriptor {
  label: string;
  tone: "default" | "dirty" | "saving" | "error";
  retryable: boolean;
  retryLabel?: string;
}

// ── Command result payloads (placeholder) ──────────────────────

export interface HealthCheckResult {
  status: string;
  version: string;
}

export interface VersionInfo {
  releaseTag: string;
  appVersion: string;
  frontendVersion: string;
  backendVersion: string;
  workspaceSchemaVersion: string;
  tauriVersion: string;
}

export interface DocumentOpenResult {
  path: string;
  relativePath: string;
  content: string;
  updatedAt: string;
}

export interface DocumentSaveResult {
  path: string;
  updatedAt: string;
  contentHash: string;
}

export interface PickSavePathResult {
  absolutePath: string;
  relativePath: string | null;
  isWithinWorkspace: boolean;
}
