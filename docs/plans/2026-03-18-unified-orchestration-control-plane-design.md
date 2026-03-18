# Unified Orchestration Control Plane Design

**Goal:** Introduce a built-in control plane that converts raw user input into structured work requests before any agent execution, so chat, immediate tasks, scheduled tasks, multi-step jobs, UI output, TTS output, built-in skills, custom skills, and MCP tools all run through one consistent contract.

**Architecture:** Add one built-in orchestration skill plus a small set of built-in control-plane tools. The orchestration skill is always available and is responsible for parsing, clarifying, freezing, planning, reducing, and presenting work. Execution agents no longer interpret raw user text directly for scheduled work; they consume a normalized request object. UI and TTS also stop reading raw model output and instead consume reduced presentation payloads.

**Tech Stack:** Tauri desktop shell, Bun sidecar, built-in skill registry, built-in tool registry, MCP gateway, JSON persistence in app-data, existing scheduled task runner, existing task event bus.

---

## Problem Statement

Today, CoworkAny mixes five concerns in a single natural-language string:

- conversational content
- control instructions such as scheduling and TTS
- executable task definition
- output requirements
- acceptance criteria

This creates repeated classes of bugs:

- the scheduler persists a partially cleaned string instead of a frozen task contract
- background runs ask follow-up questions after the user is gone
- UI bubbles show raw assistant output instead of productized results
- TTS reads low-signal text, markdown, repeated prose, or prompt boilerplate
- multi-step and scheduled tasks are not split deterministically before execution

The root issue is architectural: the system lacks a first-class control plane.

## Proposed Target Architecture

Treat CoworkAny as five stacked layers:

1. `UI Shell`
2. `Base Persistence`
3. `Built-in Orchestration Skill + Built-in Control Tools`
4. `Execution Skills`
5. `Execution Tools` from built-in tools, custom skills, and MCP

The built-in orchestration layer becomes the mandatory front door for every user request. It decides what kind of work exists before any execution agent starts.

### Layer Responsibilities

#### 1. UI Shell

The desktop app remains a shell. Its job is to:

- capture raw user input
- render structured clarifications and approvals
- render task state and result state
- render workspace, sessions, and settings
- play TTS only from a reduced speech payload

It should not interpret the user request itself.

#### 2. Base Persistence

Persist first-class records, not just strings:

- sessions
- workspaces
- normalized work requests
- scheduled jobs
- execution plans
- execution runs
- presentation payloads

All long-lived background work must be resumable from persisted structured state.

#### 3. Built-in Orchestration Skill

Add a built-in skill named `task-orchestrator`.

This is not a user-installable skill. It is part of the platform and always enabled.

Its responsibilities:

- parse raw input into a typed work request
- decide whether clarification is required
- freeze assumptions when clarification is not required
- split one request into one or more executable tasks
- define acceptance criteria
- assign presentation requirements
- choose execution mode: chat, immediate, scheduled-once, scheduled-recurring, scheduled-multi-task
- reduce raw execution output into UI and TTS payloads

This skill should never perform business-domain work itself. It is a coordinator.

#### 4. Execution Skills

Built-in skills, custom skills, and runtime-generated skills continue to exist, but they operate only after the request is normalized.

Examples:

- `stock-research`
- `browser-automation`
- custom team skills

These skills receive task objectives, constraints, assumptions, and acceptance criteria. They do not parse scheduling or TTS directives from raw user text.

#### 5. Execution Tools

Execution tools remain the action plane:

- built-in tools
- custom runtime tools
- MCP tools

The key rule is that execution tools are downstream of the control plane. They should not be used to recover missing intent that should have been parsed earlier.

## Core Data Contracts

### Normalized Work Request

Add a new canonical contract:

```ts
type WorkMode =
  | "chat"
  | "immediate_task"
  | "scheduled_task"
  | "scheduled_multi_task";

type PresentationContract = {
  uiFormat: "chat_message" | "table" | "report" | "artifact";
  ttsEnabled: boolean;
  ttsMode: "summary" | "full";
  ttsMaxChars: number;
  language: string;
};

type TaskDefinition = {
  id: string;
  title: string;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
  preferredSkills: string[];
  preferredTools: string[];
};

type ClarificationDecision = {
  required: boolean;
  reason?: string;
  questions: string[];
  missingFields: string[];
  canDefault: boolean;
  assumptions: string[];
};

type NormalizedWorkRequest = {
  schemaVersion: 1;
  mode: WorkMode;
  sourceText: string;
  workspacePath: string;
  schedule?: {
    executeAt?: string;
    timezone: string;
    recurrence?: null | { kind: "rrule"; value: string };
  };
  tasks: TaskDefinition[];
  clarification: ClarificationDecision;
  presentation: PresentationContract;
  createdAt: string;
};
```

### Execution Plan

Create a second contract downstream:

```ts
type ExecutionPlan = {
  workRequestId: string;
  runMode: "single" | "dag";
  steps: Array<{
    stepId: string;
    taskId: string;
    status: "pending" | "running" | "completed" | "failed" | "blocked";
  }>;
};
```

### Presentation Payload

Do not let UI or TTS consume raw model text.

```ts
type PresentationPayload = {
  canonicalResult: string;
  uiSummary: string;
  ttsSummary: string;
  artifacts: string[];
};
```

## Built-in Control-Plane Tools

Implement the orchestration layer as built-in tools so the framework is uniform.

### `analyze_work_request`

Input:

- raw user text
- workspace path
- session context

Output:

- `NormalizedWorkRequest`

Rules:

- must use structured output
- must classify mode
- must separate control directives from task content
- must extract acceptance criteria and presentation requirements

### `request_clarification`

Input:

- `NormalizedWorkRequest`

Output:

- user-facing clarification packet

Rules:

- only used before task freezing
- must ask only when missing information is truly blocking

### `freeze_work_request`

Input:

- `NormalizedWorkRequest`
- optional user clarification answers

Output:

- immutable frozen request

Rules:

- fills defaults and assumptions
- marks request ready for execution
- background runs may not ask new questions after this point

### `plan_work_execution`

Input:

- frozen request

Output:

- execution plan

Rules:

- split multi-task requests here
- explicit dependencies only
- no execution in this step

### `reduce_execution_result`

Input:

- frozen request
- raw execution output

Output:

- `PresentationPayload`

Rules:

- remove boilerplate, repeated instructions, markdown noise, and follow-up chatter
- create separate UI and TTS views

### `present_work_result`

Input:

- presentation payload
- source task id

Output:

- chat message event
- task finished event
- optional voice event

Rules:

- UI gets `uiSummary`
- TTS gets `ttsSummary`
- canonical result remains available for detail view or export

## Built-in Orchestration Skill Prompt Contract

`task-orchestrator` should always be included ahead of any domain skill.

Required behavior:

- classify raw user input before execution
- ask clarification only if execution would otherwise be unsafe or meaningfully wrong
- if clarification is not required, freeze assumptions immediately
- scheduled work must never ask follow-up questions during execution
- multi-step work must be split before execution starts
- result shaping is mandatory before UI/TTS output

This built-in skill is conceptually different from business-domain skills. It should be treated as platform middleware.

## Routing Rules

### Chat

If mode is `chat`:

- no scheduling
- no execution plan required
- response may be immediate

### Immediate Task

If mode is `immediate_task`:

- clarify or freeze
- plan
- execute
- reduce
- present

### Scheduled Single Task

If mode is `scheduled_task`:

- clarify or freeze at message time
- persist frozen request
- persist execution plan
- scheduler executes frozen request later
- scheduler may not re-enter clarification flow

### Scheduled Multi Task

If mode is `scheduled_multi_task`:

- split into sub-tasks before persistence
- persist DAG plan
- scheduler executes according to dependencies
- failed children surface partial completion explicitly

## Integration With Existing Framework

### UI Shell

Add explicit states:

- `clarification_required`
- `scheduled_frozen`
- `planned`
- `executing`
- `reduced_result_ready`

The UI should render clarification cards from structured payloads, not from freeform assistant prose.

### Base Persistence

New app-data files:

- `work-requests.json`
- `execution-plans.json`
- `execution-runs.json`

Update `scheduled-tasks.json` to store:

- `workRequestId`
- frozen request snapshot or version pointer
- plan id

Do not persist only `taskQuery`.

### Built-in Skills

Built-in domain skills continue to exist, but `task-orchestrator` is injected first.

Recommended rule:

- orchestration built-in skill cannot be disabled
- domain built-in skills can be enabled or disabled as today

### Custom Skills

Custom skills should receive normalized task definitions through context rather than raw user prose.

Recommended additions:

- provide `task.objective`
- provide `task.constraints`
- provide `task.acceptanceCriteria`
- provide `request.assumptions`

This reduces prompt fragility and makes custom skills predictable.

### MCP

MCP remains purely an execution substrate.

Recommended boundary:

- MCP never decides request classification
- MCP never owns user clarification logic
- MCP can be selected by planner as a preferred tool source

This keeps MCP replaceable and avoids pushing product semantics into servers.

## Recommended Implementation Shape In This Repository

### New Modules

- `sidecar/src/orchestration/workRequestSchema.ts`
- `sidecar/src/orchestration/workRequestAnalyzer.ts`
- `sidecar/src/orchestration/workRequestFreezer.ts`
- `sidecar/src/orchestration/executionPlanner.ts`
- `sidecar/src/orchestration/resultReducer.ts`
- `sidecar/src/orchestration/workRequestStore.ts`
- `sidecar/src/orchestration/executionPlanStore.ts`
- `sidecar/src/tools/controlPlane.ts`

### Existing Modules To Refactor

- `sidecar/src/main.ts`
- `sidecar/src/scheduling/scheduledTasks.ts`
- `sidecar/src/scheduling/scheduledTaskPresentation.ts`
- `sidecar/src/storage/skillStore.ts`
- `sidecar/src/tools/registry.ts`
- `desktop/src-tauri/src/ipc.rs`

### Existing Flow Changes

#### `start_task`

Current:

- raw input enters `executeFreshTask`

Target:

- raw input enters `analyze_work_request`
- if clarification required, emit clarification payload and stop
- else freeze request and continue

#### `scheduleTaskInternal`

Current:

- stores `taskQuery: string`

Target:

- stores `workRequestId`
- optionally stores frozen request snapshot for replay safety

#### `runScheduledTaskRecord`

Current:

- replays string query into execution loop

Target:

- loads frozen request
- loads execution plan
- executes deterministic task definition

## Clarification Policy

Make this a product rule, not a prompt hint.

Ask clarification only when one of these is true:

- an external side effect target is unknown
- the workspace or resource target is ambiguous
- the acceptance criteria are mutually inconsistent
- a scheduled task would otherwise produce meaningfully different results

Otherwise freeze defaults.

Examples of safe defaults:

- language defaults to current UI locale
- result format defaults to chat message
- TTS defaults to summary mode
- research time range defaults to recent six months unless constrained

## Testing Strategy

### Unit Tests

- work request parsing
- clarification decisions
- task splitting
- frozen request persistence
- result reduction

### Integration Tests

- chat request bypasses scheduler
- scheduled request asks clarification before scheduling, not after
- scheduled multi-task reconstructs from frozen state after restart
- UI bubble uses `uiSummary`
- TTS uses `ttsSummary`

### Desktop Acceptance Tests

- clean-machine first-run with orchestration layer enabled
- real UI scheduled request with mixed control directives and content constraints
- restart recovery using persisted frozen request

## Rollout Plan

### Phase 1

- add schema and analyzer
- keep existing execution loop
- persist normalized request beside raw text for observability

### Phase 2

- switch scheduled tasks to frozen request execution
- enforce no-clarification-after-freeze

### Phase 3

- add multi-task DAG planning
- add presentation reducer and UI clarification cards

### Phase 4

- migrate custom skills to normalized task context
- expose planner hooks for MCP preference selection

## Decision Summary

The best long-term shape is not “more prompt rules in the executor.” The correct fix is a platform-level control plane implemented as:

- one mandatory built-in orchestration skill
- a small set of built-in control-plane tools
- structured work request persistence
- deterministic execution planning
- separate presentation reduction for UI and TTS

This preserves the current product layering:

- UI shell
- base persistence
- built-in skill
- custom skill
- MCP

while giving all layers one shared contract instead of freeform strings.
