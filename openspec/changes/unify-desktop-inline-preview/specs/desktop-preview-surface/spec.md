# Specification: Shared Desktop Preview Surface

## ADDED Requirements

### Requirement: AI, Agent and Workflow AI conversations SHALL use one inline preview surface

The shared `WorkbenchMessageSurface` SHALL render `data-preview` parts using AI Elements composition. Route code MAY provide typed callbacks but MUST NOT create a separate browser-preview implementation.

#### Scenario: Show a generated website

- **GIVEN** an AI, Agent or Workflow AI message contains a web preview part
- **WHEN** the message is rendered
- **THEN** the website SHALL appear inside the current desktop conversation window

#### Scenario: Expand a preview in the current conversation

- **GIVEN** an inline preview card is attached to an assistant message
- **WHEN** the user selects the card or its expand action
- **THEN** the preview SHALL expand inside the same desktop conversation surface
- **AND** the conversation context and message anchoring SHALL remain available
- **AND** closing the expanded preview SHALL return to the message without opening another window

### Requirement: PPT preview SHALL be interactive and inline

PPT preview parts from `ppt-master` and `dashi-ppt` SHALL be rendered in the same surface with reload/unavailable states and explicit export actions.

#### Scenario: Bind a ppt-master preview to its generated artifact

- **GIVEN** the same assistant message contains a `ppt-master` preview and exactly one PPTX artifact
- **WHEN** the preview surface is rendered
- **THEN** its download and export actions SHALL target that artifact
- **AND** the renderer SHALL not guess an artifact when the message contains zero or multiple PPTX artifacts

#### Scenario: PPT server exits

- **GIVEN** an embedded PPT preview server becomes unavailable
- **WHEN** the surface detects the failure
- **THEN** it SHALL show a bounded unavailable state with retry and export/download actions where available

#### Scenario: Preview is loading or reconnecting

- **GIVEN** a preview descriptor exists but its source is resolving or reconnecting
- **WHEN** the preview surface is rendered
- **THEN** it SHALL show an inline loading or reconnecting state in the current conversation
- **AND** it SHALL not navigate the desktop window away from the conversation

### Requirement: External opening SHALL never be automatic

Preview rendering MUST NOT call `window.open`, system-browser APIs or equivalent host actions automatically. External opening, if exposed, SHALL require an explicit user action.

#### Scenario: User explicitly opens externally

- **GIVEN** the host exposes a safe external-open fallback for a preview
- **WHEN** the user explicitly selects that action
- **THEN** the host MAY open the resolved source externally
- **AND** no external-open action SHALL be triggered by preview creation, message rendering, refresh, reconnect or expansion
