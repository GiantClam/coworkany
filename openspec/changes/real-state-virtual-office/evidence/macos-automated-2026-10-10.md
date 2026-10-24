# macOS automated acceptance evidence

Date: 2026-10-10

## Environment

- Host: macOS 26.6.2 (`25G83`)
- Architecture: `arm64`
- Source checkout: `f17ec3ed0ac145250b95fee740598ef01d6577b2` (working tree also contains the current OpenSpec changes)

## Completed checks

- Desktop focused virtual-office/boundary/route/bootstrap/WorkbenchClient tests: 185/185.
- Full desktop tests: 586/586.
- Workbench client tests: 44/44.
- Desktop and workbench-client typechecks: passed.
- Shared package boundary check: passed.
- Virtual-office asset verification: passed; gzip total 16,389 bytes.
- Static bundle closure verification: passed; no Pixi marker in the static closure, dynamic `office-scene` chunk present.
- macOS build: passed (`build:macos`).
- macOS ARM64 Tauri bundle: passed (`tauri:build:macos`); `.app` and `.dmg` produced.
- macOS Rust tests: 77/77 passed.
- OpenSpec strict validation: passed.
- Production Pixi gate and office muted-text contrast regression: passed.
- Clean localhost browser session: virtual-office canvas mounted, fallback notice absent, and console error/warning list empty.

## Not completed in this run

- Native standalone-entry smoke is recorded in `macos-standalone-office-2026-10-10.md`; the broader M1-M14 fault-injection matrix remains incomplete.
- Foreground 60-second renderer frame trace: not captured. The deterministic projector p95 benchmark and frame-policy tests pass, but they do not replace a real WebView frame trace.
- Windows build/test/smoke: deferred by the macOS-only scope amendment; no Windows compatibility claim is made.
