export interface VersionCatalog {
  appVersion: string;
  frontendVersion: string;
  backendVersion: string;
  workspaceSchemaVersion: string;
  releaseTag: string;
}

const FALLBACK_RELEASE_VERSION = "0.1.1";
const FALLBACK_WORKSPACE_SCHEMA_VERSION = "1.0.0";

function readVersion(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const VERSION_CATALOG: VersionCatalog = {
  appVersion: readVersion(
    typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
    FALLBACK_RELEASE_VERSION,
  ),
  frontendVersion: readVersion(
    typeof __FRONTEND_VERSION__ !== "undefined" ? __FRONTEND_VERSION__ : undefined,
    FALLBACK_RELEASE_VERSION,
  ),
  backendVersion: readVersion(
    typeof __BACKEND_VERSION__ !== "undefined" ? __BACKEND_VERSION__ : undefined,
    FALLBACK_RELEASE_VERSION,
  ),
  workspaceSchemaVersion: readVersion(
    typeof __WORKSPACE_SCHEMA_VERSION__ !== "undefined" ? __WORKSPACE_SCHEMA_VERSION__ : undefined,
    FALLBACK_WORKSPACE_SCHEMA_VERSION,
  ),
  releaseTag: `v${readVersion(
    typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
    FALLBACK_RELEASE_VERSION,
  )}`,
};

export const VERSION_SUMMARY = `App ${VERSION_CATALOG.appVersion} · UI ${VERSION_CATALOG.frontendVersion} · Core ${VERSION_CATALOG.backendVersion}`;

export const VERSION_DETAILS = [
  `Release: ${VERSION_CATALOG.releaseTag}`,
  `App: ${VERSION_CATALOG.appVersion}`,
  `Frontend: ${VERSION_CATALOG.frontendVersion}`,
  `Backend: ${VERSION_CATALOG.backendVersion}`,
  `Workspace Schema: ${VERSION_CATALOG.workspaceSchemaVersion}`,
].join("\n");
