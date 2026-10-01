# Delta Specification: Shared AI Elements Message Surface

**Change ID:** `preserve-assistant-turn-stream-order`

**Approved follow-up (2026-09-30):** `compact-tool-call-activity` supersedes surface-level tool-card parity and automatic running-tool expansion with compact adjacent-call summaries. Its delta specifies the allowed tool presentation exception; chronological order, transport/persistence and all unaffected requirements below remain applicable.

## ADDED Requirements

### Requirement: Assistant turns SHALL render as one ordered reply stream

`WorkbenchMessageSurface` SHALL render visible `DesktopUIMessage.parts` in array order through one traversal. It MAY combine only adjacent compatible Parts. It MUST NOT globally collect reasoning, tools, text or results into separate regions that change chronology.

#### Scenario: Render an interleaved assistant turn

- **GIVEN** an assistant message contains reasoning, pre-tool text, a tool, post-tool text and an artifact in that order
- **WHEN** the shared surface renders the message
- **THEN** the DOM SHALL preserve that exact order
- **AND** the tool SHALL appear between the two text responses inside the same assistant turn

### Requirement: Active tool phases SHALL provide continuous visible feedback

When an assistant turn is active but no text delta is arriving, the chronological Reasoning, Tool, Task or approval Part SHALL display its current state. A concise trailing activity indicator MAY show waiting, reasoning, tool, approval or writing activity and locally measured elapsed time. The surface MUST NOT fabricate assistant prose.

#### Scenario: Tool execution pauses message text

- **GIVEN** the assistant has emitted pre-tool text and is waiting for a running tool
- **WHEN** no new text arrives for several seconds
- **THEN** the tool Part SHALL remain visibly active with progress and elapsed feedback
- **AND** the user SHALL not see an inert empty message body

### Requirement: Message composition SHALL match the pinned AI Elements hierarchy

The message area SHALL use the pinned official AI Elements Conversation, Message, MessageContent, MessageResponse, Reasoning, Tool, Task and Sources compound behavior as the parity target. Workbench MAY vary its brand color, desktop shell, role avatar, timestamp and typed host actions. It MUST NOT replace that hierarchy with page-owned renderers, globally separated process cards or heavy nested surfaces.

#### Scenario: Compare the shared surface with the pinned reference

- **GIVEN** equivalent text, reasoning and tool Parts and the agreed light/dark desktop viewports
- **WHEN** the Workbench and pinned reference states are captured
- **THEN** message hierarchy, spacing, disclosure behavior, streaming state and tool lifecycle presentation SHALL be materially equivalent
- **AND** every visible difference SHALL fall within the documented Workbench exceptions

### Requirement: Conversation following SHALL react to same-message activity

Conversation bottom-follow behavior SHALL react to new Parts, Part lifecycle changes and text growth within the current message. It SHALL follow while the user remains near the bottom, suspend following after intentional upward scrolling and expose a new-activity/scroll-to-latest control.

#### Scenario: Read earlier content while a tool runs

- **GIVEN** a user scrolls upward during an active assistant turn
- **WHEN** the tool changes state or post-tool text begins
- **THEN** the viewport SHALL preserve the user's reading position
- **AND** a visible control SHALL allow navigation to the latest activity

### Requirement: Streaming announcements SHALL remain accessible and bounded

The active assistant message SHALL expose busy state. A single concise activity region SHALL announce meaningful phase changes politely. Token deltas MUST NOT each create a live-region announcement. Reasoning and Tool disclosures SHALL remain keyboard operable, and approval actions SHALL remain visible and focusable without completion stealing focus.

#### Scenario: Use a screen reader during tool execution

- **GIVEN** an assistant turn moves from reasoning to a tool and then to post-tool writing
- **WHEN** assistive technology observes the message
- **THEN** it SHALL receive bounded phase announcements in chronological order
- **AND** it SHALL NOT receive every streamed token as a separate announcement
