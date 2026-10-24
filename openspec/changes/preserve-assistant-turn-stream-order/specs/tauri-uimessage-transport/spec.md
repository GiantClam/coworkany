# Delta Specification: Tauri UI Message Transport

**Change ID:** `preserve-assistant-turn-stream-order`

## ADDED Requirements

### Requirement: Transport SHALL segment text and reasoning at visible barriers

The desktop transport SHALL emit valid UI Message Stream start, delta and end chunks for each contiguous text or reasoning segment. Before emitting a tool, task, approval, source, attachment, media, preview, artifact, report or workflow output Part, it SHALL close the active text/reasoning segment. Text/reasoning that resumes after the barrier SHALL use a new Part id.

#### Scenario: Run a tool between two text segments

- **GIVEN** the Host emits pre-tool text, a tool lifecycle and post-tool text
- **WHEN** `DesktopChatTransport` converts the events
- **THEN** it SHALL end the pre-tool text stream before the tool Part
- **AND** it SHALL start the post-tool text with a different Part id after the tool

### Requirement: Transport SHALL normalize visible event order once

One explicit adapter SHALL assign or preserve monotonic sequence and creation-time metadata before events enter the assistant-turn projection. Live conversation rendering and persisted replay SHALL use the same projection rules. Route code MUST NOT independently convert the same raw event into another visible message representation.

#### Scenario: Process an event without a runtime sequence

- **GIVEN** a valid visible Host event has no explicit sequence
- **WHEN** the desktop adapter accepts it
- **THEN** the adapter SHALL assign a monotonic arrival sequence for that run
- **AND** live rendering and persistence SHALL retain that order

### Requirement: Tool lifecycle updates SHALL remain visible during text pauses

The transport SHALL deliver tool started, approval, completed and failed updates without waiting for a subsequent text delta. Tool lifecycle updates SHALL preserve `toolCallId` and SHALL be sufficient to update the current assistant message.

#### Scenario: Wait for a long-running tool

- **GIVEN** the assistant has stopped emitting text while a tool is running
- **WHEN** the Host emits tool lifecycle updates
- **THEN** each accepted update SHALL reach the visible assistant message promptly
- **AND** the message SHALL remain active until a terminal run event arrives

### Requirement: Stream termination SHALL finalize open segments without losing partial output

Successful, failed and cancelled terminal events SHALL close open text/reasoning segments, preserve already received Parts and set the appropriate message terminal metadata. Cancellation MUST NOT create an implicit replacement response.

#### Scenario: Cancel after partial text and a running tool

- **GIVEN** an assistant turn contains partial text and a running tool
- **WHEN** the user cancels the run
- **THEN** the text SHALL remain visible, the message SHALL become cancelled and no segment SHALL remain streaming
- **AND** replay SHALL reconstruct the same partial turn
