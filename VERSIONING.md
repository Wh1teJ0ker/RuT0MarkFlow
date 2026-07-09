# Versioning

## Release Version

- Use Semantic Versioning: `MAJOR.MINOR.PATCH`.
- `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `version-manifest.json` `appVersion` must stay aligned.
- Release tags use `vMAJOR.MINOR.PATCH`, for example `v0.1.0`.
- Push a matching tag to trigger GitHub Release automation.

## Component Versions

Independent component versions now live in `version-manifest.json`:

- `appVersion`: desktop release version shipped to users.
- `frontendVersion`: React/Vite UI layer version.
- `backendVersion`: Rust/Tauri command and local I/O layer version.
- `workspaceSchemaVersion`: persisted workspace/settings schema version.

Only `appVersion` is required to match the release tag and bundle metadata. The other component versions may evolve independently when the UI, backend contract, or local data format changes on a different cadence.

## Increment Rules

- `MAJOR`: breaking change.
- `MINOR`: backward-compatible feature.
- `PATCH`: backward-compatible fix, docs-only, or build/test/chore change.
- Increase `frontendVersion` when UI behavior or render/runtime contracts change materially.
- Increase `backendVersion` when Tauri commands, filesystem behavior, or Rust-side semantics change materially.
- Increase `workspaceSchemaVersion` when persisted settings/index/document state needs migration logic.

## Verification

- Run `pnpm version:check` before tagging.
- The check validates:
  - release version sync across package/Tauri/Cargo/app manifest
  - semantic version formatting for each component version
  - optional tag match when `--tag vX.Y.Z` is provided
