# Delta Specification: Compact Tool-Call Activity

**Change ID:** `compact-tool-call-activity`

This user-approved follow-up modifies tool presentation requirements from `preserve-assistant-turn-stream-order` and `restore-ai-elements-message-visual-parity`. It leaves chronology, transport/persistence contracts and upstream source provenance requirements applicable.

## MODIFIED Requirements

### Requirement: Message composition SHALL match the pinned AI Elements hierarchy

The message area SHALL retain the pinned official AI Elements Conversation, Message, MessageContent, MessageResponse, Reasoning, Task and Sources behavior. Ordinary tool traces SHALL use the approved compact adjacent-call presentation, with existing Tool composition available for on-demand individual details. Grouping SHALL preserve visible Part order and SHALL NOT create a whole-turn process region. This tool grouping, summary geometry and default-closed behavior SHALL be documented Workbench parity exceptions.

#### Scenario: Compare the grouped surface with the pinned reference

- **GIVEN** equivalent ordered Parts rendered by the pinned reference and Workbench
- **WHEN** visual acceptance compares them in light and dark themes
- **THEN** compact tool summaries and grouping SHALL be treated as approved differences
- **AND** all other hierarchy, source provenance and presentation expectations SHALL retain their existing parity contract

### Requirement: Production CSS SHALL preserve upstream visual hierarchy

Production CSS SHALL preserve official Message, Reasoning, Markdown, user-bubble and Conversation hierarchy and styling. Compact tool-group styles SHALL be scoped to the Workbench surface extension. They SHALL NOT change pinned Tool source or globally override its primitive geometry to achieve compact grouping.

#### Scenario: Render an official Tool independently

- **GIVEN** the existing pinned Tool primitive and a compact Workbench group
- **WHEN** each is rendered in its supported fixture
- **THEN** the primitive SHALL retain its upstream border/header contract
- **AND** the Workbench group SHALL use its separately specified compact summary without breaking unrelated components

### Requirement: Mounted disclosures SHALL reflect lifecycle changes

Reasoning SHALL retain its existing streaming/completion disclosure behavior. Ordinary tool groups and individual call details SHALL initially be closed in both active and settled states. Running, completion and appended calls SHALL update summaries/details in place without forcing expansion or resetting a user's explicit disclosure choice. Approval requests SHALL remain directly actionable; failures SHALL remain visible and directly inspectable.

#### Scenario: Complete a call while the user inspects its group

- **GIVEN** the user opened a group and selected a call's details
- **WHEN** that call completes and another adjacent call arrives
- **THEN** both user-selected disclosure states SHALL remain unchanged
- **AND** counts, state and output SHALL update without moving the call or remounting unaffected disclosures

#### Scenario: Keep a running group closed

- **GIVEN** a closed group contains active calls
- **WHEN** input, output or completion events arrive
- **THEN** the summary SHALL visibly reflect the real lifecycle
- **AND** parameters and outputs SHALL remain closed unless the user opens them

## ADDED Requirements

### Requirement: Adjacent ordinary tool calls SHALL occupy one compact summary

The surface SHALL group each maximal run of adjacent ordinary tool-call Parts in visible array order into one summary row, including a run with one call. A group SHALL default to closed and use muted text, a lifecycle icon and a disclosure affordance without an outer card border, filled card background or repeated per-call status badges. Every visible non-tool Part, approval request and user interaction SHALL form a boundary. Grouping SHALL NOT alter stored Parts or span assistant messages.

#### Scenario: Render many adjacent calls

- **GIVEN** an assistant message contains 1, 10 or 50 adjacent ordinary tool calls
- **WHEN** the surface renders in the default state
- **THEN** each case SHALL show exactly one compact summary row
- **AND** call parameters, raw outputs and individual call cards SHALL NOT fill the transcript

#### Scenario: Preserve interleaving and result boundaries

- **GIVEN** Parts contain tools, text, more tools and a typed artifact in that order
- **WHEN** the surface renders
- **THEN** two tool groups SHALL surround the original text
- **AND** the artifact SHALL remain visible after the second group
- **AND** the original Part array and relative order SHALL remain unchanged

### Requirement: Group summaries SHALL use real operation state

Summaries SHALL derive from distinct toolCallIds and their latest accepted lifecycle state. They SHALL distinguish active calls, successful calls, failures and denials. A tool lifecycle patch SHALL NOT increment invocation counts. Summaries MAY use deterministic localized action labels and actual timing. They SHALL NOT invent planned totals, file counts, durations, percentages or assistant prose, or require an additional model call.

#### Scenario: Update multiple calls with mixed outcomes

- **GIVEN** a group contains successful, failed, denied and active calls
- **WHEN** calls receive repeated or parallel lifecycle updates
- **THEN** summary counts SHALL reflect distinct calls and actual outcomes
- **AND** failures/denials SHALL NOT be reported as successful completion
- **AND** an unknown final call total SHALL NOT be presented as a fixed plan denominator

### Requirement: Tool details SHALL use two levels of user-controlled disclosure

Opening a group SHALL reveal a compact list of calls in original order. Opening one call SHALL reveal its existing input/output details. Large lists and outputs SHALL use bounded scrolling or previews while retaining a complete inspection/copy path. Streaming input/output updates SHALL remain inspectable without expanding every call or silently truncating source data.

#### Scenario: Inspect one call in a large group

- **GIVEN** the user expands a 50-call group
- **WHEN** the user opens one call
- **THEN** only that selected call's parameters/output SHALL expand
- **AND** the remaining calls SHALL stay compact
- **AND** long output SHALL have a complete inspection/copy path without forcing the main transcript to display it all

### Requirement: Required interaction and useful results SHALL remain visible

Approval requests and user questions SHALL remain visible and actionable without opening a trace group. A group containing failures SHALL expose a failure summary and a direct path to the failed call's details. Existing typed artifacts, images, files, tables/reports and previews SHALL remain outside trace disclosures in their chronological position, with existing host actions. Raw tool JSON SHALL NOT itself introduce a new result protocol or duplicate an existing typed result.

#### Scenario: A running call requests approval

- **GIVEN** a previously grouped call transitions to approval-requested
- **WHEN** the surface receives the transition
- **THEN** the approval request and action buttons SHALL become directly visible at that call's original position
- **AND** unaffected calls SHALL preserve relative order and manual disclosure state
- **AND** existing approval callbacks SHALL remain operable

#### Scenario: Locate a failure from a collapsed group

- **GIVEN** a closed group includes a failed call
- **WHEN** the user activates its failure inspection action
- **THEN** the failed call's details SHALL be exposed and located directly
- **AND** successful calls SHALL NOT all auto-expand

### Requirement: Compact tool feedback SHALL preserve activity and accessibility

A grouped tool-only interval SHALL remain visibly active and expose assistant busy state. When a group communicates the current tool-running phase, the surface SHALL avoid a duplicate trailing tool-running label. Existing waiting, reasoning and writing feedback SHALL remain available. Meaningful phase changes SHALL use one concise polite announcement region without announcing every token, count tick or elapsed second. Disclosures SHALL have keyboard controls, visible focus and accurate aria-expanded, respect reduced motion and preserve the existing manual-scroll policy.

#### Scenario: Read earlier messages while tools run

- **GIVEN** a user has scrolled upward during a tool-only interval
- **WHEN** grouped calls update or complete
- **THEN** the surface SHALL retain the user's reading position and expose the existing latest-activity control
- **AND** tool activity SHALL remain visible with no duplicate running label or completion-induced focus movement

#### Scenario: Restore a completed conversation

- **GIVEN** a stored message contains multiple tool calls and interleaved text/results
- **WHEN** the conversation is reloaded
- **THEN** it SHALL render equivalent group boundaries and original Part order
- **AND** ordinary groups and details SHALL default to closed
- **AND** no new transport or persistence schema SHALL be required
