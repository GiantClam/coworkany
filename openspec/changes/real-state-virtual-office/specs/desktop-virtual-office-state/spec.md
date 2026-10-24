## Purpose

Provide a truthful, accessible office view of repeatable Coworkany work while reusing existing execution facts, pages, and navigation paths. The capability makes activity visible without creating a second task database or autonomous office behavior.

## ADDED Requirements

### Requirement: The office SHALL project only persisted work facts

The office SHALL derive role activity from existing conversations, runs, run details, events, recoverable attempts, artifacts, provider health, and the local Agent directory. It MUST NOT create an office-only task record, start an autonomous model call, or fabricate activity for visual effect.

#### Scenario: An active conversation and workflow coexist
- **WHEN** one ordinary conversation run and one workflow run are active
- **THEN** only the AI chat and workflow roles show active devices
- **AND** each run appears exactly once under its source adapter

#### Scenario: No persisted activity exists
- **WHEN** the source snapshot contains no active or recent work
- **THEN** enabled roles remain visible and idle
- **AND** no activity animation or fake task is created

### Requirement: The registry SHALL define seven stable office roles

The registry SHALL define AI chat, Agent, PPT expert, workflow, writer, image, and video roles with stable IDs, exact home routes, source adapter IDs, health source IDs, artifact kinds, and a three-device limit. A role SHALL remain visible while its registered route exists. Runtime, feature, provider, and Agent-directory capabilities SHALL control the role's availability and whether its workspace action is enabled.

#### Scenario: Capabilities gate role availability
- **WHEN** text runtime and workflow routes are available but the Agent directory is unavailable
- **THEN** AI chat and workflow roles are visible and available
- **AND** Agent remains visible with unavailable status and a disabled workspace action

#### Scenario: Media provider is explicitly unavailable
- **WHEN** the image or video provider reports `unavailable`
- **THEN** the corresponding role reports offline health when enabled
- **AND** a normal read rejection reports unknown while preserving the last-good snapshot

### Requirement: Source reads SHALL have one lifecycle owner

One read-only source SHALL own channel reads, cache, subscriptions, last-good snapshots, and cleanup. Refreshes SHALL be single-flight and generation-safe; source failure SHALL preserve the last-good record snapshot and expose unknown health, while explicit unavailability SHALL expose offline health.

#### Scenario: A source read fails after a good snapshot
- **WHEN** conversations fail during a later refresh after a successful snapshot
- **THEN** the previous conversation records remain available
- **AND** the dependent role is marked unknown or pending synchronization
- **AND** unrelated workflow records may continue advancing

#### Scenario: The office is stopped during an in-flight read
- **WHEN** the dashboard unmounts before a source promise resolves
- **THEN** the old promise MUST NOT update the new snapshot, health, timers, or listeners

### Requirement: Status and terminal feedback SHALL be deterministic

Status SHALL respect terminal runs, user permission waits, provider recovery evidence, queued/running state, and unknown evidence in that order. A live-to-terminal transition SHALL occupy a device for exactly eight seconds, duplicate transitions MUST NOT reset the timer, startup terminal records MUST go directly to recent work, and recent work SHALL be capped at twenty items.

#### Scenario: A permission request remains open
- **WHEN** a run has an unpaired permission request or blocked node
- **THEN** the role shows `waiting` with user attention
- **AND** the device remains navigable to the existing approval surface

#### Scenario: A completed run is observed after restart
- **WHEN** the first loaded snapshot already contains a completed run
- **THEN** it appears in recent work
- **AND** it does not occupy a device or replay terminal feedback

### Requirement: Device and role navigation SHALL use stable composite keys

Clicking a role SHALL open its anchored status card. The card's workspace action SHALL open the registered home route when the role is available. Clicking a device or recent item SHALL resolve `{sourceAdapterId, workItemId}` to its persisted entry path, conversation route, artifact/preview route, or role home route through the existing navigation adapter. Missing items SHALL return a typed not-found result without opening a new window.

#### Scenario: Two adapters use the same work item ID
- **WHEN** two work items share a raw ID but have different source adapters
- **THEN** clicking either device opens the matching item
- **AND** neither click resolves to the other adapter's item

#### Scenario: No persisted route exists
- **WHEN** a work item has no route target
- **THEN** activation returns a typed route-unavailable result or role home route according to the role contract
- **AND** no `window.open` call is made

### Requirement: React SHALL remain a complete accessible office surface

The React surface SHALL expose role titles, localized status and attention text, metrics, three device buttons, overflow count, recent twenty items, and role/home navigation with keyboard-accessible names. The canvas MUST NOT be the only way to access work.

#### Scenario: Pixi is unavailable
- **WHEN** the scene manifest, asset load, or renderer initialization fails
- **THEN** the React office still renders all enabled role cards and buttons
- **AND** the left menu, quick input, task execution, approval, and existing pages remain usable

#### Scenario: User switches locale
- **WHEN** the user changes between Chinese and English
- **THEN** role labels, statuses, and attention text change language
- **AND** stable IDs, routes, work item keys, and task state remain unchanged
