# Delta Specification: Restore AI Elements Message Visual Parity

**Approved follow-up (2026-09-30):** `compact-tool-call-activity` supersedes the surface-level running-tool expansion and per-call card geometry requirements below. Upstream source integrity and primitive-level parity remain applicable; compact grouping is an explicit Workbench surface exception.

## ADDED Requirements

### Requirement: Message primitives SHALL derive from verifiable official source

Message, Reasoning, Tool and Conversation SHALL retain the pinned upstream markup, classes and disclosure lifecycle through deterministic documented dependency/import adaptations. Original source hashes SHALL be checked locally. Workbench-specific props SHALL be handled by thin adapters.

#### Scenario: Audit the visual implementation
- **WHEN** the source provenance check runs
- **THEN** the upstream files SHALL match the recorded commit and hashes
- **AND** compatible ports SHALL match the documented adaptation rules
- **AND** raw tool call IDs SHALL appear only in machine-readable metadata

### Requirement: Production CSS SHALL preserve upstream visual hierarchy

The desktop SHALL define semantic Tailwind theme tokens and SHALL NOT override official message flex layout, reasoning/tool header geometry, typography, user bubble shape or Markdown rendering with legacy message CSS. Brand colors, shell clearance, role avatars, timestamps and business actions MAY differ.

#### Scenario: Compare core components under both themes
- **GIVEN** identical fixture content and viewport
- **WHEN** independent official and full-production views render in light and dark themes
- **THEN** core layout, spacing, font sizes, icon sizes and disclosure geometry SHALL match
- **AND** any remaining difference SHALL be an explicitly documented allowed exception

### Requirement: Mounted disclosures SHALL reflect lifecycle changes

Reasoning SHALL auto-open while streaming and close once after completion using the pinned behavior. A running tool SHALL visibly indicate activity and successful completion SHALL close its automatic expansion. A user's explicit expansion choice SHALL be preserved. Approvals and errors SHALL remain keyboard accessible.

#### Scenario: Complete a tool in the existing message
- **GIVEN** an automatically expanded running tool
- **WHEN** its existing part receives a successful output
- **THEN** its status badge SHALL update and its disclosure SHALL close without remounting
- **AND** a user-selected open disclosure SHALL remain open

### Requirement: Visual acceptance SHALL use independent rendered views

Acceptance SHALL render the official port directly without Workbench CSS and SHALL render WorkbenchMessageSurface with the complete production desktop stylesheet stack. Both SHALL consume the same ordered fixture and run mounted interactions. SSR slot checks and Workbench-only screenshots SHALL NOT establish parity.

#### Scenario: Exercise conversation interaction
- **WHEN** fixture activity advances, the user scrolls upward, returns to latest and reloads
- **THEN** bottom following, reading-position preservation, keyboard toggles and chronological rendering SHALL remain functional
- **AND** evidence SHALL include computed styles, state assertions, screenshots and a rebuilt desktop WebView
