# Proposal: Unify Desktop Inline Web and Presentation Preview

**Change ID:** `unify-desktop-inline-preview`
**Status:** Approved

## Problem

The desktop workbench can render local artifacts, but web previews and the local preview servers used by `ppt-master` and `dashi-ppt` are not represented as first-class conversation output. Some preview paths can open a separate browser window, which breaks the desktop conversation context and duplicates preview state. Dify is not part of the desktop target and must not be introduced into this change.

## Proposed solution

Add a typed desktop `data-preview` message part and a shared AI Elements preview surface. The local runtime may start and manage a loopback preview server, but it only emits a validated preview descriptor. `@coworkany/workbench-ui` owns inline rendering in the current desktop window through `WebPreview`/WebView-compatible composition. `ppt-master` and `dashi-ppt` both use this contract; export and artifact actions remain host callbacks.

## Scope

In scope:

- `DesktopUIMessage`/`WorkbenchRunEvent` preview contract and persistence.
- Inline preview rendering for local websites, PPT previews, images, video, audio and safe documents.
- Loopback URL validation, loading/error/reconnect states and preview-session cleanup.
- `ppt-master` and `dashi-ppt` preview event integration.
- Removing automatic browser-launch behavior from desktop preview flows.
- Desktop tests, package-boundary checks and Tauri verification.

Out of scope:

- Dify, Dify APIs or Dify message parsing.
- Cloud preview providers or remote web-app embedding.
- Replacing PPT engines or changing their generation/export semantics.
- Removing an explicit user-triggered “open externally” action when the host supports it.

## Success criteria

- AI, Agent and PPT desktop conversations render the same preview part in the current window.
- `ppt-master` and `dashi-ppt` previews are embedded without `window.open` or automatic system-browser launch.
- Preview URLs are restricted to approved loopback/local sources and do not expose arbitrary filesystem paths.
- Closing/replacing a preview releases its session or shows a deterministic unavailable state.
- Preview failure does not block artifact download/export.
- Existing text, reasoning, tool, artifact and media parts remain compatible.

## Affected areas

| Area | Change |
|---|---|
| `packages/workbench-client` | Add preview data and runtime event mapping |
| `packages/workbench-ui` | Add shared Preview/WebPreview composition |
| `apps/desktop` | Resolve local sources and wire lifecycle callbacks |
| Local PPT runtimes | Emit preview descriptor; do not open browser |
| Dify | No changes; explicitly out of scope |
