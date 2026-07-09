import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const versionManifest = JSON.parse(
  readFileSync(new URL("./version-manifest.json", import.meta.url), "utf8"),
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(versionManifest.appVersion),
    __FRONTEND_VERSION__: JSON.stringify(versionManifest.frontendVersion),
    __BACKEND_VERSION__: JSON.stringify(versionManifest.backendVersion),
    __WORKSPACE_SCHEMA_VERSION__: JSON.stringify(versionManifest.workspaceSchemaVersion),
  },

  // Prevent vite from obscuring rust errors
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
