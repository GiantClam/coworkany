# Findings

## Repository
- The Tauri app lives in `desktop/`.
- `desktop/package.json` declares wide ranges: `@tauri-apps/api: ^2.0.0`, `@tauri-apps/cli: ^2.0.0`.
- `desktop/package-lock.json` currently resolves those to `@tauri-apps/api 2.10.1` and `@tauri-apps/cli 2.9.6`, so JS-side core packages are not aligned.
- `desktop/src-tauri/Cargo.toml` declares `tauri-build = "2.0"` and `tauri = "2.10"`, which are also broad ranges.
- `desktop/src-tauri/Cargo.lock` currently resolves to:
  - `tauri 2.10.2`
  - `tauri-build 2.5.5`
  - `tauri-runtime 2.10.0`
  - `tauri-runtime-wry 2.10.0`
  - `tauri-utils 2.8.2`
  - `tauri-plugin-store 2.4.2`
  - `tauri-plugin-global-shortcut 2.3.1`
  - `tauri-plugin-shell 2.3.5`
- `@tauri-apps/plugin-store` JS `2.4.2` already matches the Rust crate `tauri-plugin-store 2.4.2`.
- The Rust updater plugin has already been intentionally removed from the app, while JS `@tauri-apps/plugin-updater 2.10.0` remains in use.

## Official Compatibility
- Tauri v2 migration/config docs state `@tauri-apps/api` and Rust `tauri` only need to stay on the same minor version, and recommend using the latest release in that minor line.
- Tauri docs also state plugin JS packages and Rust plugin crates should use exactly matching versions when both sides are present.
- Registry checks in this environment show the latest installable stable versions are:
  - npm: `@tauri-apps/api 2.10.1`, `@tauri-apps/cli 2.10.1`, `@tauri-apps/plugin-store 2.4.2`, `@tauri-apps/plugin-updater 2.10.0`
  - crates.io: `tauri 2.10.3`, `tauri-build 2.5.6`, `tauri-plugin-store 2.4.2`, `tauri-plugin-global-shortcut 2.3.1`, `tauri-plugin-shell 2.3.5`
- Conservative target set for this repo:
  - Pin JS core packages to exact versions: `@tauri-apps/api 2.10.1`, `@tauri-apps/cli 2.10.1`
  - Pin Rust core crates to exact versions: `tauri 2.10.3`, `tauri-build 2.5.6`
  - Leave plugin packages/crates at their current latest exact versions.

## Beta Readiness
- CI and packaging workflows previously used Node 20 while the repo now declares `>=22.22.1 <23`; this was corrected to use `.nvmrc`.
- The desktop app previously used `csp: null` and `shell.open: true`; `csp` has now been replaced with a concrete beta-safe policy and the extra shell-open plugin config was removed.
- `desktop/src-tauri/src/process_manager.rs` previously fell back to an absolute development path for `rag-service` and force-killed any process listening on port `8787`; both behaviors are unsafe for external beta users.
- `sidecar/src/main.ts` already receives `COWORKANY_APP_DATA_DIR` from Rust, so runtime logs and self-learning state can live in a stable app data location instead of `process.cwd()`.
- Tracked delivery residue included `desktop/src-tauri/build_err.txt` and `desktop/src/stores/useTaskEventStore.ts.old`; both have now been removed from the working tree.

## Beta Release Branch
- The app-facing version is still `0.1.0` across `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`, and `sidecar/package.json`; for an external beta cut these should move together to `0.1.0-beta.1`.
- The release workflow already supports prerelease tags through `workflow_dispatch`, so a beta cut can use a tag like `v0.1.0-beta.1` without changing the workflow shape.
- The repository contains obvious local-only state that should not be part of a beta branch snapshot, including root `workspaces.json`, `.tmp/`, `tmp/`, `sidecar/workspace/`, and `sidecar/src/main.ts.broken.bak`.
- `package-desktop.yml` is present and valid for manual packaging, but it is currently untracked in the working tree; it belongs with the beta release toolchain.
