# Specification: Desktop Preview Contract

## ADDED Requirements

### Requirement: Desktop preview SHALL be a typed UIMessage part

The desktop message contract SHALL represent web, PPT, media and document previews as `data-preview` with a typed descriptor. Renderers MUST NOT parse preview instructions from assistant Markdown.

#### Scenario: Receive a PPT preview

- **GIVEN** a local PPT runtime reports a healthy preview endpoint
- **WHEN** the host emits the run event
- **THEN** the desktop message SHALL contain one `data-preview` part with `kind: ppt`, engine, URL/session identity and title

### Requirement: Preview parts SHALL be idempotent and persistent

Preview parts SHALL have stable identity, preserve stream sequence and round-trip through `parts_json`/`metadata_json`. Repeated readiness events SHALL update one part rather than append duplicates.

#### Scenario: Reconnect after refresh

- **GIVEN** a conversation contains a persisted preview session id
- **WHEN** the desktop reloads the conversation
- **THEN** it SHALL attempt bounded reconnection using that id and render an unavailable recovery state if the server no longer exists

### Requirement: Preview sources SHALL be host-resolved and allowlisted

The renderer MUST NOT construct filesystem URLs or accept arbitrary remote URLs. The host SHALL allow only owned loopback/local preview sources or an allowlisted artifact resolver result.

#### Scenario: Reject unsafe source

- **GIVEN** a preview event contains a `file://` or non-allowlisted remote URL
- **WHEN** the host validates it
- **THEN** it SHALL reject the source and preserve download/export actions
