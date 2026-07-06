# Versioning

- Use Semantic Versioning: `MAJOR.MINOR.PATCH`.
- Keep `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` on the same version.
- `MAJOR`: breaking change.
- `MINOR`: backward-compatible feature.
- `PATCH`: backward-compatible fix, docs-only, or build/test/chore change.
- Release tags use `vMAJOR.MINOR.PATCH`, for example `v0.1.1`.
- Push a matching tag to trigger GitHub Release automation.
