# Design: Unified Desktop Inline Preview

## Architecture

```text
OpenCode/Tauri/local PPT runtime
        -> WorkbenchRunEvent(type=preview)
        -> DesktopUIMessage(data-preview)
        -> WorkbenchMessageSurface
        -> AI Elements Preview/WebPreview
        -> current desktop WebView
```

The renderer never consumes raw OpenCode events or Provider responses. The host validates and resolves preview sources through typed callbacks. A preview server is an execution dependency, not a UI owner.

## Preview descriptor

```ts
type DesktopPreviewData = {
  kind: "web" | "ppt" | "image" | "video" | "audio" | "document"
  title: string
  url?: string
  relativePath?: string
  artifactId?: string
  mimeType?: string
  previewSessionId?: string
  engine?: "ppt-master" | "dashi-ppt" | "generic-web"
  interactive?: boolean
}
```

`url` is an optional loopback endpoint, not an arbitrary external URL. `relativePath` is resolved by the host and is never concatenated by the renderer. `previewSessionId` identifies the local server/session for reconnect and cleanup.

## Message and event flow

`WorkbenchRunEvent` gains a `preview` variant. The desktop adapter maps it to `data-preview` with a stable part id (`preview:<session-or-artifact-id>`), preserving sequence and creation time. Duplicate events update the existing part. Persisted `parts_json` and `metadata_json` round-trip the descriptor.

`ppt-master` and `dashi-ppt` emit a preview event after their local server health check succeeds. They do not call browser APIs. Export remains a separate host action keyed by `previewSessionId`.

## UI composition

`WorkbenchMessageSurface` collects `data-preview` parts and renders a shared preview component. `web` and `ppt` use `WebPreview`; media and safe documents reuse existing AI Elements media/artifact primitives. The component exposes typed callbacks for refresh, close, download, export and optional explicit external-open.

The surface must render:

- loading while resolving the source;
- inline content in the current desktop window;
- reconnect/reload for a live local server;
- a safe unavailable state when the server exits;
- download/export actions independent from preview availability.

## Source and security policy

The host accepts only `http://127.0.0.1:<port>`, `http://localhost:<port>`, approved local HTTPS equivalents, or an allowlisted host-resolved asset URL. Ports, scheme and session ownership are checked before exposing a source to the WebView. Arbitrary remote URLs, `file://` URLs, absolute filesystem paths and untrusted iframe navigation are rejected. Any external-open action is explicit and user initiated.

## Lifecycle

The desktop host tracks preview sessions by conversation/run. Replacing or closing a preview sends a best-effort stop/cleanup command. If cleanup cannot be confirmed, the UI marks the preview unavailable and records a bounded diagnostic; it must not leave a stale browser tab. Reopening a conversation attempts to reconnect using the persisted session id and otherwise displays a recoverable unavailable state.

## Verification

- Contract tests for event mapping, stable ids, deduplication and persistence.
- Component tests for web/PPT inline rendering, loading, failure and fallback states.
- Security tests for rejected external/file URLs and accepted loopback URLs.
- Runtime tests for `ppt-master` and `dashi-ppt` preview descriptors and cleanup.
- Tauri acceptance confirming no automatic browser launch and visible in-window preview.
