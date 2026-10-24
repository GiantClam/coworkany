# Delta Specification: Desktop UIMessage Contract

**Change ID:** `preserve-assistant-turn-stream-order`

## ADDED Requirements

### Requirement: Assistant Parts SHALL preserve chronological occurrence boundaries

An assistant `DesktopUIMessage` SHALL preserve the first-occurrence order of reasoning, text, tool, task, source, attachment, media, preview, artifact, report and workflow Parts. Text and reasoning deltas SHALL merge only while they remain adjacent members of the same active segment. A non-text process or output Part SHALL close the active text/reasoning segment, and later text/reasoning SHALL create a new Part identity.

#### Scenario: Continue text after a tool call

- **GIVEN** the runtime emits reasoning, pre-tool text, a tool call and post-tool text
- **WHEN** the events are projected into one assistant message
- **THEN** the message SHALL contain distinct ordered Parts for reasoning, pre-tool text, tool and post-tool text
- **AND** concatenating its text Parts SHALL produce the complete assistant prose

### Requirement: Entity lifecycle updates SHALL retain first position

Tools, tasks, previews, media and artifacts SHALL use stable entity identities. A later lifecycle event SHALL update the existing Part without moving it from the position of its first visible occurrence. Terminal states SHALL NOT regress because of duplicate or late non-terminal events.

#### Scenario: Complete a tool between two text segments

- **GIVEN** a running tool Part appears after the first text segment
- **WHEN** its output arrives before a second text segment
- **THEN** the tool SHALL become completed at its existing array position
- **AND** the second text segment SHALL remain after the tool

### Requirement: Live and replay projection SHALL be equivalent

The same normalized sequenced run events SHALL produce equivalent ordered Parts and terminal metadata whether processed live, replayed from persisted events or restored from message storage. Legacy records without recoverable occurrence boundaries MAY retain their stored array order as a best-effort view.

#### Scenario: Reopen a tool-bearing conversation

- **GIVEN** a completed assistant turn was persisted after streaming through reasoning, text, a tool and more text
- **WHEN** the conversation is reopened
- **THEN** its Part order, visible content and terminal states SHALL match the completed live view
- **AND** no Part SHALL be duplicated or globally regrouped

### Requirement: Conversation rendering SHALL have one live message owner

Conversation surfaces SHALL derive visible assistant Parts from one immutable `DesktopUIMessage` state owner. Page-owned text buffers, mutable Part refs or status arrays MUST NOT act as competing rendered message sources.

#### Scenario: Receive a tool-only update

- **GIVEN** the current assistant turn emits a tool event without a text delta
- **WHEN** the event is accepted
- **THEN** the visible `DesktopUIMessage` SHALL receive a new immutable state immediately
- **AND** rendering SHALL NOT depend on an unrelated page-state update
