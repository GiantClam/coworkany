# Progress

## 2026-03-11
- Created planning files for the Tauri version audit and upgrade task.
- Inspected `desktop/package.json`, `desktop/package-lock.json`, `desktop/src-tauri/Cargo.toml`, and `desktop/src-tauri/Cargo.lock`.
- Confirmed current mismatch: JS API resolves to `2.10.1`, CLI resolves to `2.9.6`, Rust `tauri` resolves to `2.10.2`, and `tauri-build` resolves to `2.5.5`.
- Verified official compatibility guidance and latest stable installable versions from Tauri docs, npm, and crates.io.
- Pinned Tauri-related npm dependencies to exact versions in `desktop/package.json`.
- Pinned Tauri-related Rust crates to exact versions in `desktop/src-tauri/Cargo.toml`.
- Refreshed `desktop/package-lock.json` and `desktop/src-tauri/Cargo.lock`.
- Validated final versions with `npm ls`, `npx @tauri-apps/cli --version`, and `cargo check --locked`.
- Aligned GitHub Actions workflows to `.nvmrc` so CI/release/package use the same Node major as local development.
- Removed the RAG service absolute-path fallback and replaced the unsafe port-kill behavior with a clear "port already in use" error.
- Moved sidecar runtime logs and self-learning state to `COWORKANY_APP_DATA_DIR` when available, with workspace-local `.coworkany` as development fallback.
- Re-validated with `cargo check --locked`, `npm run typecheck` in `sidecar`, and `npm run build` in `desktop`.
- Tightened Tauri security config by replacing `csp: null` with an explicit CSP and removing the extra `plugins.shell.open` config from `tauri.conf.json`.
- Removed tracked debug/backup residue files that should not ship with beta builds.
- Re-ran `desktop` build and Rust checks after the Tauri config cleanup; both still pass.
- Expanded desktop CI gating from a single Phase 2 test file to the full `desktop` acceptance suite, and updated related tests so the suite reflects the current updater/security posture.
- Confirmed local `desktop` acceptance now passes cleanly: `138` tests, `0` failures.
- Reviewed release workflows and version metadata to prepare a dedicated external beta release branch.
- Bumped release-facing versions to `0.1.0-beta.1` across desktop package metadata, Tauri config, Rust crate metadata, sidecar package metadata, and their lockfiles.
- Added `docs/releases/0.1.0-beta.1.md` with beta release notes, release/tag naming, validation snapshot, and operator checklist.
- Added ignore rules for obvious local-only beta scratch/state files so they do not keep polluting the release branch view.
- Re-validated the beta candidate with `desktop npm test`, `desktop npm run build`, `desktop/src-tauri cargo check --locked`, and `sidecar npm run typecheck`.
- Created and switched to the dedicated branch `release/0.1.0-beta.1`.
