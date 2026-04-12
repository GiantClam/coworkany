# coworkany — Overview

> **Navigation aid.** This article shows WHERE things live (routes, models, files). Read actual source files before implementing new features or making changes.

**coworkany** is a javascript project built with raw-http.

## Scale

3 API routes · 11 middleware layers · 184 environment variables

## Subsystems

- **[Http](./http.md)** — 1 routes — touches: auth, db
- **[PlaywrightServer](./playwrightServer.md)** — 1 routes — touches: db
- **[Infra](./infra.md)** — 1 routes — touches: auth, db

## High-Impact Files

Changes to these files have the widest blast radius across the codebase:

- `desktop/node_modules.bak-20260319-2215/enhanced-resolve/lib/Resolver.js` — imported by **128** files
- `desktop/node_modules.bak-20260319-2215/playwright-core/lib/utils.js` — imported by **63** files
- `desktop/src/types/index.ts` — imported by **48** files
- `desktop/node_modules.bak-20260319-2215/autoprefixer/lib/declaration.js` — imported by **45** files
- `desktop/node_modules.bak-20260319-2215/playwright/lib/util.js` — imported by **38** files
- `desktop/node_modules.bak-20260319-2215/playwright-core/lib/utilsBundle.js` — imported by **32** files

## Required Environment Variables

- `ALL_PROXY` — `sidecar/src/main-mastra.ts`
- `ANTHROPIC_API_KEY` — `desktop/tests/coworkany-self-management-update-config-e2e.test.ts`
- `APPDATA` — `desktop/src-tauri/target/aarch64-apple-darwin/release/sidecar/coworkany-sidecar-node.mjs`
- `AWS_ACCESS_KEY_ID` — `desktop/src-tauri/target/aarch64-apple-darwin/release/sidecar/coworkany-sidecar-node.mjs`
- `AWS_DEFAULT_REGION` — `desktop/src-tauri/target/aarch64-apple-darwin/release/sidecar/coworkany-sidecar-node.mjs`
- `AWS_REGION` — `desktop/src-tauri/target/aarch64-apple-darwin/release/sidecar/coworkany-sidecar-node.mjs`
- `AWS_SECRET_ACCESS_KEY` — `desktop/src-tauri/target/aarch64-apple-darwin/release/sidecar/coworkany-sidecar-node.mjs`
- `AWS_SESSION_TOKEN` — `desktop/src-tauri/target/aarch64-apple-darwin/release/sidecar/coworkany-sidecar-node.mjs`
- `BRAVE_API_KEY` — `desktop/src-tauri/target/aarch64-apple-darwin/release/sidecar/coworkany-sidecar-node.mjs`
- `BROWSER_USE_HOST` — `desktop/src-tauri/target/aarch64-apple-darwin/release/browser-use-service/main.py`
- `BROWSER_USE_LLM_MODEL` — `desktop/src-tauri/target/aarch64-apple-darwin/release/browser-use-service/main.py`
- `BROWSER_USE_PORT` — `desktop/src-tauri/target/aarch64-apple-darwin/release/browser-use-service/main.py`
- _...166 more_

---
_Back to [index.md](./index.md) · Generated 2026-04-08_