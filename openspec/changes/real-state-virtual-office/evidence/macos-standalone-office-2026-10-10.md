# macOS standalone virtual-office acceptance

Date: 2026-10-10

## Environment

- macOS 26.6.2 (`25G83`), Apple Silicon `arm64`.
- Source branch: `codex/add-workflow-ai-authoring-skill` at `cd2c8f293`, with the current virtual-office working-tree changes.
- Native bundle: `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/CoworkAny.app`.

## Automated evidence

- Full desktop suite: 586/586 passed.
- Desktop and `@coworkany/workbench-ui` typechecks: passed.
- macOS frontend build: passed (`build:macos`).
- Current macOS `.app` bundle: passed (`tauri build --bundles app`).
- Virtual-office assets: passed; 16,389 gzip bytes.
- Bundle boundary: passed; static closure clean and dynamic `office-scene-1UtqyVav.js` present.
- Browser acceptance fixture: standalone stage height 614px; role card, Escape close, language toggle, invalid-manifest fallback, and restore all passed with no console errors. Headless Chromium emitted only known WebGL `ReadPixels` performance warnings.
- Current shell browser smoke: home contained no office heading; sidebar opened `/dashboard/office`; seven route-backed role cards rendered; status-card close button received focus; viewport resize preserved a valid anchored card.

## Native macOS evidence

- Home showed the normal CoworkAny workspace without an embedded virtual office.
- Sidebar showed the independent `虚拟办公室` entry under `工作空间`.
- Selecting the entry opened `tauri://localhost/dashboard/office`.
- The production renderer gate used the complete React view and retained the enlarged office stage.
- All seven route-backed roles were visible. Image and video roles remained visible with `不可用` status because their Providers were not configured.
- Selecting `查看 AI 对话 状态` opened the adjacent status card with live counts, current tasks, recent work, and the single `进入工作区` action.
- Focus moved to `关闭状态卡`; pressing Escape closed the card and restored focus to `查看 AI 对话 状态`.

Native UI observations and screenshots were captured through Codex Computer Use in the acceptance session. Browser screenshots are stored at:

- `.artifacts/virtual-office-shell-home-current.png`
- `.artifacts/virtual-office-current-route.png`
- `.artifacts/virtual-office-fallback-status-card.png`
- `.artifacts/virtual-office-standalone-browser.png`

## Scope limits

- No Windows build, smoke, or compatibility claim was made; the current validated platform is macOS only.
- The existing M1-M14 matrix still has open fault-injection, restart-recovery, reduced-motion, background ticker, and foreground 60-second frame-trace cases. This standalone-entry acceptance does not close those broader release tasks.
