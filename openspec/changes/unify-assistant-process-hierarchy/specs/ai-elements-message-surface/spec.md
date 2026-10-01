# Delta Specification: Unified Assistant Process Hierarchy

**Change ID:** `unify-assistant-process-hierarchy`

This delta extends `compact-tool-call-activity`. It modifies Workbench surface presentation only; chronological Part order, transport/persistence, pinned source integrity and unaffected primitive contracts remain applicable. Completed predecessor evidence is not evidence of this unimplemented change.

## MODIFIED Requirements

### Requirement: Message composition SHALL match the pinned AI Elements hierarchy

The surface SHALL retain official Conversation, Message, MessageContent, MessageResponse, Task, Sources and host-result composition. Eligible reasoning and ordinary tool traces SHALL use compact adjacent process segments; existing Reasoning and Tool composition SHALL remain available for on-demand content. The surface SHALL NOT create a whole-turn process bucket or move content across visible boundaries. Response/process typography, summary spacing/icons/labels, mixed adjacent grouping and default-closed surface reasoning SHALL be explicit Workbench parity exceptions. Ordinary tools inside these segments SHALL retain the default-closed exception from compact-tool-call-activity rather than the older running-tool auto-open requirement. Non-eligible approval/interaction tools SHALL retain existing OrderedTool lifecycle controls, and standalone official primitives SHALL retain pinned prop/default behavior.

#### Scenario: Compare primitives and the unified surface

- **GIVEN** identical ordered Parts in an independent official fixture and a full-production Workbench fixture
- **WHEN** both render in light and dark themes
- **THEN** unified process grouping and documented surface geometry/disclosure differences SHALL be allowed
- **AND** source provenance, standalone primitive behavior, user bubbles, Markdown structure and unaffected contracts SHALL remain unchanged

### Requirement: Production CSS SHALL preserve upstream visual hierarchy

Production CSS SHALL preserve unaffected official primitives, user bubbles, Markdown structure and Conversation behavior. Assistant response typography and compact process geometry SHALL be scoped to the Workbench surface. Surface-owned spacing SHALL eliminate inherited reasoning-margin accumulation, without editing pinned upstream source or globally overriding primitive styles.

#### Scenario: Style reasoning in and outside the surface

- **GIVEN** standalone official Reasoning and a Workbench process segment
- **WHEN** the production stylesheet stack is applied
- **THEN** the surface SHALL use compact process geometry without an extra inherited bottom margin
- **AND** standalone official Reasoning SHALL retain its pinned typography, margin and disclosure behavior

### Requirement: Mounted disclosures SHALL reflect lifecycle changes

Eligible reasoning/tool process segments and individual tool details SHALL initially be closed in active and settled states. Ordinary streaming, completion and appended compatible Parts SHALL update summaries/content without forcing expansion, resetting a user's choice or remounting unaffected tool detail components. Required interaction SHALL remain directly actionable. A merged segment SHALL be open if any existing explicit member/segment choice is open, independent of first-member order; otherwise it SHALL be closed. Directly closing a merged segment SHALL set all current member segment choices closed, and new compatible members SHALL inherit the resolved choice. Individual call choices, copied feedback, focused descendants and bounded-list offsets SHALL survive regrouping. Fresh reloads SHALL default closed without a new persisted field.

#### Scenario: Inspect a mixed segment during appended reasoning

- **GIVEN** the user opened a process segment and a tool's details
- **WHEN** reasoning and another tool are appended and the original call completes
- **THEN** existing manual choices, tool component state, focus and local scroll position SHALL remain intact
- **AND** new reasoning/tool content SHALL appear in its original order without expanding all details

#### Scenario: Keep streaming reasoning collapsed

- **GIVEN** an initially closed reasoning-only segment
- **WHEN** reasoning text streams and completes
- **THEN** its summary SHALL remain visibly active while running and become settled afterward
- **AND** its content SHALL remain closed unless the user opens the segment

#### Scenario: Split and merge around approval

- **GIVEN** a mixed process segment with inspected tool details
- **WHEN** a call requests approval and later returns to an eligible state
- **THEN** its approval SHALL be directly actionable in chronological position
- **AND** unaffected members SHALL retain mounted state and focus/scroll without conversation movement
- **AND** merging independently toggled segments SHALL keep an existing open choice without changing call-level choices

#### Scenario: Merge closed-first and open-second segments

- **GIVEN** approval split an interval into segment A before segment B, and the user closed A but opened B and one of its tool details
- **WHEN** the approval boundary is removed and A/B merge
- **THEN** the merged segment SHALL remain open despite A being first
- **AND** the selected tool detail, focus and scroll SHALL remain intact
- **AND** a subsequent direct merged-segment close SHALL stay closed through compatible append/completion without resetting the selected call's own choice

### Requirement: Adjacent ordinary tool calls SHALL occupy one compact summary

Every maximal eligible adjacent process interval SHALL occupy one compact summary, including tool-only intervals with one call. Eligible reasoning SHALL have non-whitespace text or be streaming in an active message. Eligible ordinary tools SHALL exclude approval-requested calls and normalized question/ask_user/request_user_input tools, and SHALL require workflowAi=false. Reasoning SHALL be compatible with those ordinary tool traces within the same interval. Visible text, required interaction, standalone tasks/sources/warnings/results, workflowAi=true tool runs and other visible non-process Parts SHALL form boundaries. Normal settled summaries SHALL use muted text and a disclosure affordance without an outer card/background or repeated leading completion/brain icons. Grouping SHALL NOT span messages or alter stored Parts.

#### Scenario: Render many calls and intervening reasoning

- **GIVEN** one assistant message contains 1, 10 or 50 eligible tools interspersed with reasoning and no visible boundary
- **WHEN** the default surface renders
- **THEN** each case SHALL show exactly one closed process summary
- **AND** repeated thinking headers, per-call cards and raw input/output SHALL NOT fill the transcript

#### Scenario: Preserve interleaving and useful results

- **GIVEN** Parts contain reasoning, text A, two tools, reasoning, three tools, text B and an artifact in that order
- **WHEN** the surface renders
- **THEN** the visible order SHALL be process 1, text A, process 2, text B and artifact
- **AND** opening process 2 SHALL show the original two-tools, reasoning, three-tools sequence
- **AND** text A, text B and the artifact SHALL remain outside process disclosures

### Requirement: Compact tool feedback SHALL preserve activity and accessibility

The process summary SHALL own actual current reasoning/tool feedback and suppress duplicate trailing labels for that same phase. Waiting, writing, approval and other required independent feedback SHALL remain available. Active assistant messages SHALL expose busy state and one concise polite phase-announcement region, without per-token/count/elapsed-second announcements. Disclosures SHALL expose accurate aria-expanded, localized accessible names, keyboard controls and visible focus. Updates SHALL preserve the near-bottom follow policy, intentional upward reading position and latest-activity control. Reduced motion SHALL retain readable phase state without decorative motion.

#### Scenario: Advance through reasoning, tools and writing

- **GIVEN** an assistant progresses from reasoning to tools to text generation
- **WHEN** activity changes within the same mounted message
- **THEN** the current reasoning/tool phase SHALL have one visible feedback path, not a duplicate trailing label
- **AND** writing feedback and bounded polite phase announcements SHALL remain available
- **AND** completion SHALL NOT steal focus or move a reader who scrolled upward

## ADDED Requirements

### Requirement: Answer content SHALL take visual priority over process information

Every assistant text Part SHALL use the same readable primary response treatment, at 1rem with line-height 1.65 at default scale. Existing useful results SHALL retain their direct display and actions. Compact process triggers SHALL use .8125rem text with 20px line-height and a 14px disclosure icon, with minimum 32px desktop and 44px coarse-pointer targets. Internal compact steps SHALL use a 4px gap; process-to-text/result spacing SHALL be 16px at default scale, without accumulated primitive margins. Relative typography SHALL support zoom/font scaling. Normal text SHALL achieve at least 4.5:1 computed foreground/background contrast in both themes; primary styling SHALL NOT introduce heavy answer cards or rewrite content.

#### Scenario: Measure production hierarchy

- **GIVEN** a fixture with reasoning, tools and assistant text under the full production stylesheet stack
- **WHEN** computed styles are inspected at default scale in both themes
- **THEN** response text SHALL be 16px and process trigger text SHALL be 13px with the specified line-height, icon size and target minimums
- **AND** process-to-content spacing SHALL be 16px without additional reasoning bottom margin
- **AND** normal response/process text contrast SHALL meet 4.5:1 against its rendered background

#### Scenario: Preserve all assistant prose without role heuristics

- **GIVEN** pre-tool text and post-tool text have no explicit commentary/final role
- **WHEN** the unified surface renders
- **THEN** both SHALL remain outside process segments with identical primary text styling
- **AND** the surface SHALL NOT classify, hide or weaken either using position, regular expressions or content guesses

### Requirement: Process summaries SHALL distinguish reasoning from observed tool operations

Reasoning-only, tool-only and mixed segments SHALL have deterministic localized labels. Reasoning-only segments without measured timing SHALL use a neutral thinking-process label. Tool counts SHALL reflect distinct toolCallIds and latest accepted states; reasoning Parts and lifecycle patches SHALL NOT increment counts. Failures/denials SHALL remain distinguishable with direct failure inspection. Summaries SHALL NOT invent elapsed time, targets, planned totals or generated prose. Settled empty reasoning SHALL NOT create a process entry; an actually streaming empty reasoning Part SHALL retain truthful active feedback.

#### Scenario: Restore unknown reasoning timing

- **GIVEN** a completed stored reasoning segment has no measured duration
- **WHEN** the conversation is restored
- **THEN** its label SHALL be `思考过程` or the corresponding English label
- **AND** the surface SHALL NOT display `思考了几秒`, invented seconds or a restoration timer as execution duration

#### Scenario: Count tools across reasoning and repeated patches

- **GIVEN** an eligible interval contains five distinct calls, multiple reasoning Parts and repeated lifecycle patches
- **WHEN** the summary updates
- **THEN** its observed tool-operation count SHALL remain five
- **AND** failed/denied calls SHALL NOT be reported as successful completion

#### Scenario: Ignore settled empty reasoning without losing active feedback

- **GIVEN** settled reasoning has no non-whitespace text while another empty reasoning Part is actually streaming
- **WHEN** the surface projects their eligible content
- **THEN** settled empty reasoning SHALL NOT produce a phantom summary or detail step
- **AND** the streaming reasoning SHALL have a visible current-phase summary

### Requirement: Expanded process steps SHALL be ordered and bounded

Opening a process segment SHALL reveal original reasoning/tool step order. Reasoning content SHALL remain inspectable without another repeated top-level Thinking header; individual tool input/output SHALL remain a second user-controlled disclosure. The process list SHALL be bounded to min(28rem, 60vh), reasoning content to 200px at default scale, and tool details to min(24rem, 50vh), using scrolling without source-data loss. Existing complete inspection/copy paths SHALL remain available. Bookkeeping metadata MAY be omitted but SHALL NOT reorder visible Parts.

#### Scenario: Inspect a long mixed process

- **GIVEN** the user opens a mixed segment containing long reasoning and 50 tools
- **WHEN** they inspect one selected call
- **THEN** the outer list and long content SHALL have bounded scrollable heights
- **AND** only selected call details SHALL expand while full source output remains inspectable/copyable
- **AND** the original step order SHALL remain unchanged

### Requirement: Visible business content SHALL terminate mixed process grouping

Approval requests, user questions, standalone task/source/warning Parts and useful files/artifacts/media/reports/previews SHALL remain directly visible and form mixed-process boundaries. The projection SHALL receive the existing workflowAi surface flag. When workflowAi=true, all ordinary tool runs SHALL be mixed-process boundaries throughout their lifecycle and SHALL retain the approved tool-only group and WorkflowAiToolSummary path, including existing summary visibility/deduplication and host actions. Eligibility SHALL NOT depend on guessing raw output content or waiting for a business summary to arrive. Unknown visible Parts SHALL also form boundaries. Raw output SHALL NOT be reclassified as a new result protocol.

#### Scenario: Preserve a Workflow AI business summary

- **GIVEN** workflowAi=true and reasoning precedes a Workflow AI tool run and another reasoning Part follows
- **WHEN** the surface renders
- **THEN** the order SHALL be reasoning process, existing Workflow AI tool group/business summary, reasoning process
- **AND** reasoning before and after the tool run SHALL NOT be joined, including while the call is active and its business summary has not arrived
- **AND** available business content SHALL retain existing direct visibility, selected-detail deduplication and host actions

#### Scenario: Keep attention and typed results outside a closed process

- **GIVEN** process activity is interleaved with approval, a user question, a task, a source and a typed preview
- **WHEN** all eligible process segments are closed
- **THEN** those boundary Parts SHALL remain directly visible and operable in their original order
- **AND** existing download/open/approval callbacks SHALL remain intact
