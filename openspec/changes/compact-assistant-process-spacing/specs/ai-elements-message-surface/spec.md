# Delta Specification: Compact Assistant Process Spacing

**Change ID:** `compact-assistant-process-spacing`

This follow-up replaces the uniform process-to-content spacing in `unify-assistant-process-hierarchy`. Its grouping boundaries, identity, chronology, typography, disclosure, interaction, scrolling and source-provenance requirements remain applicable. This is not an implementation or acceptance record.

## MODIFIED Requirements

### Requirement: Answer content SHALL take visual priority over process information

Every assistant text Part SHALL use the same readable primary response treatment, at 1rem with line-height 1.65 at default scale. Existing useful results SHALL retain their direct display and actions. Compact process triggers SHALL use .8125rem text with 20px line-height and a 14px disclosure icon, with minimum 32px desktop and 44px coarse-pointer targets. Internal compact steps SHALL use a .25rem gap. Adjacent output blocks SHALL use the contextual gutters specified below instead of a uniform 16px process-to-content gap. Relative typography/gutters SHALL support zoom and font scaling. Normal text SHALL achieve at least 4.5:1 computed foreground/background contrast in both themes; primary styling SHALL NOT introduce heavy answer cards, infer commentary/final roles or rewrite content.

#### Scenario: Measure hierarchy without shrinking controls

- **GIVEN** primary prose and compact process entries under the complete production stylesheet stack
- **WHEN** inspected at the default 16px root in both themes
- **THEN** primary text SHALL be 16px/1.65 and process text SHALL be 13px/20px with a 14px disclosure icon
- **AND** desktop/coarse-pointer targets SHALL retain their 32px/44px minimums while gutters become compact
- **AND** all assistant prose SHALL retain the same primary treatment and normal text contrast SHALL meet 4.5:1

### Requirement: Production CSS SHALL preserve upstream visual hierarchy

Production CSS SHALL preserve unaffected official primitives, user bubbles, Markdown structure/internal paragraph and list spacing, and Conversation behavior. Assistant typography, compact process geometry and contextual row/output gutters SHALL be scoped to the Workbench surface. Surface-owned spacing SHALL eliminate duplicate gap/margin/padding at the same boundary without editing pinned upstream source, globally overriding primitives or changing visible metadata/actions. Standalone official Reasoning/Tool SHALL retain their pinned geometry and behavior.

#### Scenario: Compare isolated primitives and the compact surface

- **GIVEN** standalone official primitives and a Workbench process fixture under production styles
- **WHEN** reasoning/tool entries are closed and then opened
- **THEN** only the Workbench surface SHALL use the new contextual gutter/zero-footprint policy
- **AND** standalone primitives, pinned sources/ports/hashes, user bubbles and unaffected contracts SHALL remain unchanged

## ADDED Requirements

### Requirement: Assistant output gutters SHALL reflect visible block relationships

At a default 16px root, same-message gutters SHALL be .25rem/4px for process → process, .5rem/8px for primary → process, .75rem/12px for process → primary, and 1rem/16px for all other visible output boundaries. Primary includes every assistant text block and directly visible useful results. Process includes an existing compact summary; a group with directly displayed Workflow AI business content SHALL remain a result boundary. Classification SHALL follow existing render paths, not content guesses or new persisted fields. Non-rendered bookkeeping and empty layout-only placeholders SHALL NOT add sibling gutters. Gutters SHALL be owned once at the boundary, without accumulated primitive margins.

#### Scenario: Render the screenshot sequence inside one message

- **GIVEN** prose A, tool activity, reasoning, prose B, further tool/reasoning activity and prose C in their original Part order
- **WHEN** eligible same-message intervals are projected and measured after layout settles
- **THEN** each maximal compatible process interval SHALL retain one default-closed entry and truthful count
- **AND** primary → process and process → primary layout gutters SHALL be 8px and 12px respectively, within 1 CSS pixel rounding tolerance
- **AND** original Parts SHALL remain immutable and visible prose SHALL NOT move into the disclosures

#### Scenario: Preserve separate process and visible result boundaries

- **GIVEN** existing compatibility rules leave adjacent process entries separate, or activity is followed by a direct business result, approval, question, task, source or warning
- **WHEN** the output renders
- **THEN** process/process gutters SHALL be 4px, process/primary-result gutters 12px and other visible boundary gutters 16px at default scale
- **AND** directly visible boundary content SHALL retain its existing position, actions and interaction semantics

### Requirement: Same-turn row spacing SHALL NOT become cross-message aggregation

The existing message ordering and turn grouping SHALL remain unchanged. Consecutive assistant rows within one existing turn SHALL use 1rem/16px layout gutters. A user row to its first assistant row and successive turn containers SHALL retain 2rem/32px gutters. Row spacing SHALL take precedence at message boundaries; process intervals SHALL NOT span message IDs. Visible metadata/actions SHALL retain their existing behavior. Measurements SHALL distinguish layout gutters from genuine intervening visible content; an entirely non-rendered layout-only row SHALL NOT create an extra gutter, while timestamped content or active feedback SHALL NOT be hidden to satisfy spacing.

#### Scenario: Replay several assistant messages in one turn

- **GIVEN** prose/tool output and reasoning reside in consecutive assistant messages with distinct IDs, followed by another user turn
- **WHEN** the timeline is restored and rendered
- **THEN** consecutive assistant row gutters SHALL be 16px, and the user/first-assistant and turn gutters SHALL be 32px at default scale, within 1 CSS pixel rounding tolerance
- **AND** the original message IDs, ordering, timestamps, action callbacks and separate disclosures SHALL remain intact
- **AND** no summary SHALL collect Parts across those messages

### Requirement: Closed process details SHALL have zero layout footprint

After close animations settle, closed process lists, hidden raw details and non-rendered layout-only wrappers SHALL contribute zero height, margin, padding or extra sibling gutter to transcript layout. Preserved mounted hosts MAY remain outside layout but SHALL retain existing disclosure/component identity and user state. Active feedback SHALL remain visible. Opened process headers SHALL use an .5rem/8px gutter to their detail lists; internal compact step gutters SHALL remain .25rem/4px. Existing scrollable bounds, complete inspection/copy, focus and manual choices SHALL remain applicable.

#### Scenario: Close inspected details without residual whitespace

- **GIVEN** a user opened a process segment and selected call, then closes the segment
- **WHEN** the close transition has settled and compatible content appends/completes
- **THEN** closed details SHALL occupy no layout space and create no additional output gutter
- **AND** reopening SHALL preserve the selected call's choice, copied feedback and bounded-list inspection state
- **AND** keyboard focus and intentional upward conversation reading position SHALL NOT be stolen

### Requirement: Compact spacing SHALL be verified across real composition boundaries

Acceptance SHALL include mounted production-style single-message and multi-assistant-message fixtures, a second user turn, reasoning-only/tool-only/mixed intervals, 1/10/50 unique calls, empty bookkeeping, required interactions and useful results, and Chat/Agent/Writer/Workflow AI consumers. Rendered box measurements after settled layout SHALL prove default gutters and target heights; CSS source matching alone SHALL NOT constitute spacing acceptance. Light/dark/narrow and 200% zoom or increased-root-size reflow SHALL be checked. Rebuilt native macOS replay SHALL verify the delivered renderer; unsupported platform/device limits SHALL be explicit. Previous acceptance and human speech evidence SHALL NOT be presented as new spacing verification.

#### Scenario: Verify a scaled and updated compact transcript

- **GIVEN** the compact transcript in both themes with an inspected process, an upward-scrolled reader and one stable phase-announcement region outside busy ancestors
- **WHEN** the viewport narrows, zoom/text scale increases, and append/completion/split/merge updates occur
- **THEN** text and controls SHALL remain readable without overlap or unintended horizontal overflow
- **AND** focus, disclosures, original order, single-region phase semantics, near-bottom follow/latest return and restored scroll behavior SHALL remain intact
- **AND** DOM announcements or coarse-rule simulation SHALL NOT be reported as actual audible speech or physical touch-device evidence
