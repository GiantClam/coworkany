# Tasks: Unify Desktop Inline Preview

## Phase 1: Contract

- [x] 1.1 Add `DesktopPreviewData` and `data-preview` to `packages/workbench-client`.
- [x] 1.2 Add `preview` to `WorkbenchRunEvent` and map it in UIMessage conversion.
- [x] 1.3 Preserve stable ids, sequence, deduplication and terminal/session metadata.
- [x] 1.4 Add persistence round-trip tests for preview parts.

Phase 1 quality gate: `@coworkany/workbench-client` tests and typecheck pass.

## Phase 2: Shared AI Elements surface

- [x] 2.1 Add a shared Preview/WebPreview composition under `packages/workbench-ui`.
- [x] 2.2 Render web and PPT descriptors inline in `WorkbenchMessageSurface`.
- [x] 2.3 Add loading, unavailable, reload, close, download and PPT export states.
- [x] 2.4 Add source validation and host resolver callback boundaries.
- [x] 2.5 Add component and security tests.

Phase 2 quality gate: `@coworkany/workbench-ui` tests and typecheck pass; raw descriptor URLs are not rendered without a host resolver.

## Phase 3: Desktop host and PPT runtimes

- [x] 3.1 Add desktop loopback/local source resolver with allowlisted schemes and ports.
- [x] 3.2 Track preview sessions by run/conversation and implement cleanup/reconnect.
- [x] 3.3 Map `ppt-master` local server readiness to `data-preview`.
- [x] 3.4 Map `dashi-ppt` local server readiness to `data-preview`.
- [x] 3.5 Keep export/download as explicit host callbacks keyed by session/artifact id.
- [x] 3.6 Remove automatic browser opening from desktop preview flows.
- [x] 3.7 Associate a unique PPTX artifact in the same assistant message with its `ppt-master` preview so preview actions target the correct file.
- [x] 3.8 Return preview export failures to the shared surface so it can show an inline error.
- [x] 3.9 Wire desktop home, chat/writer and workflow AI preview entry points to the same resolver and error-reporting callbacks.

## Phase 4: Removal and verification

- [x] 4.1 Verify AI Chat, Agent, PPT, home and Workflow AI surfaces use the same preview surface after the follow-up wiring.
- [x] 4.2 Verify preview survives refresh/reconnect or shows a recoverable unavailable state.
- [x] 4.3 Re-verify preview failure and export/download error presentation after the follow-up fixes.
- [x] 4.4 Verify no Dify imports, routes or parsers are introduced in the desktop path.
- [x] 4.5 Re-run workbench-client/UI/runtime-contracts tests and typechecks, desktop typecheck/tests, lint, boundary checks, Vite build, Tauri cargo check and OpenSpec validation after the follow-up fixes.
- [ ] 4.6 Run manual Tauri acceptance and confirm no automatic system-browser launch.
