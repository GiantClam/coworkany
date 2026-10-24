# Specification: Local PPT Preview Runtime Integration

## ADDED Requirements

### Requirement: PPT engines SHALL return preview descriptors

`ppt-master` and `dashi-ppt` SHALL start or reuse their local preview server, perform a health check, and emit a typed preview descriptor. They SHALL not own presentation UI or launch an external browser.

#### Scenario: ppt-master is ready

- **GIVEN** ppt-master has rendered a local preview project
- **WHEN** its server health check succeeds
- **THEN** the runtime SHALL emit a `ppt-master` preview descriptor with a loopback URL and session id

#### Scenario: dashi-ppt is ready

- **GIVEN** dashi-ppt has rendered its local preview project
- **WHEN** its server health check succeeds
- **THEN** the runtime SHALL emit a `dashi-ppt` preview descriptor with a loopback URL and session id

### Requirement: Preview sessions SHALL have bounded lifecycle

The host SHALL associate each preview session with its run/conversation, support reconnect while the server is alive, and attempt cleanup when replaced or closed. Failed cleanup SHALL be diagnosable and must not block artifact export.

#### Scenario: Preview is replaced or closed

- **GIVEN** a PPT preview session is attached to a run or conversation
- **WHEN** the user closes it, the message is replaced, or the conversation ends
- **THEN** the host SHALL attempt to clean up the associated session
- **AND** cleanup failure SHALL produce a bounded diagnostic without blocking export or download

#### Scenario: Reopen a conversation with a live session

- **GIVEN** a persisted PPT preview session id has a live local server
- **WHEN** the conversation is reopened
- **THEN** the host SHALL attempt reconnect and render the preview inline
- **AND** if reconnect fails it SHALL render a recoverable unavailable state
