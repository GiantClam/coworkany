## Purpose

Add a visual office layer that makes real workload legible without taking ownership of business logic, navigation, accessibility, or task execution. The renderer must be optional, deterministic, and safe to remove when the host cannot load it.

## ADDED Requirements

### Requirement: Pixi SHALL be a lazy renderer-only enhancement

The 2.5D renderer SHALL load lazily after the React office is available. Scene code MUST consume projected state and typed callbacks only; it MUST NOT import WorkbenchClient, Tauri commands, storage, or navigation modules.

#### Scenario: React office loads before Pixi
- **WHEN** the dashboard mounts
- **THEN** the React office and its controls render without waiting for the Pixi chunk
- **AND** Pixi may load afterward as an enhancement

#### Scenario: Renderer initialization fails
- **WHEN** the Pixi dynamic import or initialization rejects
- **THEN** the surface state returns to complete React mode
- **AND** the failure is diagnosable without blocking task execution

### Requirement: Assets SHALL be versioned and integrity checked

Office assets SHALL live under `apps/desktop/public/virtual-office/v1/` and be described by a manifest containing schema version, relative paths, dimensions, frame names, stable character/workstation IDs, and SHA-256 values. Build-time checks SHALL reject missing files, traversal paths, invalid dimensions, empty frames, duplicate IDs, or hash mismatches.

#### Scenario: A manifest path escapes the asset directory
- **WHEN** the build verifier reads a manifest containing a traversal path
- **THEN** verification fails before build output is accepted
- **AND** no runtime fallback can silently turn the invalid asset into a release pass

#### Scenario: Registry references an unknown asset ID
- **WHEN** a role references an asset ID absent from the validated manifest
- **THEN** the asset-registry test fails
- **AND** the role cannot be marked release-ready

### Requirement: Frame policy SHALL respect visibility, idle time, and reduced motion

The renderer SHALL stop its ticker after the page becomes hidden, reduce idle rendering to at most fifteen frames per second after thirty seconds without activity, restore active rendering on visibility/activity, and disable walking or looping environment animation when reduced motion is requested.

#### Scenario: The window becomes hidden
- **WHEN** document visibility changes to hidden
- **THEN** ticker activity stops within one second
- **AND** duplicate visibility events do not add listeners or tickers

#### Scenario: Reduced motion is enabled
- **WHEN** `prefers-reduced-motion: reduce` matches
- **THEN** looping character/environment motion is disabled
- **AND** status changes and navigation remain available through React
