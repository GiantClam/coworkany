# Coworkany Deep Research Control Plane Design

**Goal:** Upgrade Coworkany from a one-shot planner into a `planner + researcher` control plane that investigates user intent, gathers evidence, resolves uncertainty with minimal user interruption, freezes an execution contract only after sufficient research, and re-enters research when execution discovers new facts.

**Architecture:** Extend the existing `work request -> frozen contract -> execution` pipeline with first-class research state instead of replacing it. The analyzer still owns normalization, but it now produces a `goal frame`, `research plan`, `evidence ledger`, `uncertainty registry`, and `strategy selection` before freezing the execution contract. Runtime continues to use the existing suspend/resume and task-event infrastructure, with additive research events and an explicit loop back from execution into research when new evidence invalidates the frozen assumptions.

**Tech Stack:** Bun sidecar, TypeScript orchestration layer, existing work-request store, task event bus, Tauri desktop UI, current planner timeline reducer, effect-gated execution runtime, existing session/workspace/memory retrieval surfaces.

---

## Problem Statement

Coworkany already has the right macro-shape:

- normalize user request
- generate task structure
- gate on clarification
- freeze a contract
- execute
- validate and present

However, it still behaves too much like a planner and not enough like a task owner:

1. `Research is implicit instead of explicit`

The current analyzer infers deliverables and asks for clarification, but it does not model what research should be performed, what sources were checked, what evidence was found, or whether the system exhausted available context before asking the user.

2. `Uncertainty is binary instead of structured`

Current clarification logic mostly handles obvious ambiguity. It does not distinguish:

- confirmed facts
- inferred facts
- defaultable choices
- unresolved blockers

This makes Coworkany ask too early in some cases and proceed too optimistically in others.

3. `Contract freeze happens too early`

The contract currently freezes immediately after lightweight normalization. For many real tasks, especially collaborative and cross-tool tasks, the system should first perform local, session, app, and web research before deciding the final deliverables and checkpoints.

4. `Execution cannot formally invalidate prior assumptions`

The runtime can suspend or fail, but it does not have a first-class way to say:

- new evidence was discovered
- the frozen contract is no longer optimal
- return to research, then refreeze

This gap makes execution overly prompt-driven instead of control-plane-driven.

The product goal is not a separate research engine. The goal is to make research a governed, replayable part of the same control plane that already owns planning and execution.

## Design Principles

1. `Extend, do not replace`

Keep the existing work-request, frozen-contract, artifact-contract, suspend/resume, and plan-timeline mechanisms. Add research as a first-class stage inside them.

2. `Research before interruption`

Coworkany should exhaust system-available sources before asking the user. User clarification is reserved for unresolved blockers, not outsourced investigation.

3. `Evidence over vibe`

Strategy and contract decisions should point to collected evidence, not just model prose. Research artifacts must be serializable and persistence-safe.

4. `Minimal blocking`

Only `blocking_unknown` uncertainty should interrupt the user. `defaultable` uncertainty should be recorded and proceed with an explicit default.

5. `Runtime can re-open the contract`

Execution is allowed to trigger a research return when new facts materially change the best plan. The contract is authoritative until invalidated by evidence, not until the model feels uncertain.

6. `UI shows research state compactly`

Desktop should not expose raw chain-of-thought. It should expose phase, evidence sources checked, outstanding blockers, selected strategy, and current user action if one exists.

## Target Workflow

Coworkany should standardize on this loop:

1. `Goal framing`
2. `Deep research`
3. `Uncertainty resolution`
4. `Contract freeze`
5. `Execution`
6. `Re-plan if new evidence appears`

### Phase 1: Goal Framing

Purpose:

- extract the requested outcome
- capture hard constraints and soft preferences
- identify contextual anchors
- form an initial success hypothesis

Outputs:

- `goalFrame`
- initial `researchPlan`
- initial `uncertaintyRegistry`

### Phase 2: Deep Research

Purpose:

- gather evidence from the best available sources before asking the user

Research classes:

- `domain_research`
- `context_research`
- `feasibility_research`

Research sources:

- current conversation
- workspace/local files
- persisted memory / prior sessions
- connected apps
- web / community best practices
- templates / historical task patterns

Outputs:

- `researchRuns[]`
- `researchEvidence[]`
- updated `uncertaintyRegistry`
- `strategyOptions[]`

### Phase 3: Uncertainty Resolution

Purpose:

- classify what is known and what still blocks safe execution

Required output groups:

- `confirmed_facts`
- `inferred_facts`
- `blocking_unknowns`
- `defaultable_items`

Behavior rules:

- ask the user only for `blocking_unknowns`
- automatically apply `defaultable_items`
- keep `inferred_facts` visible in the contract as assumptions

### Phase 4: Contract Freeze

Purpose:

- freeze the best currently supported execution contract

Required contract content:

- deliverables
- checkpoints
- user actions
- success criteria
- resume strategy
- recommended strategy
- alternatives
- selection rationale
- known risks

### Phase 5: Execution With Re-Planning

Purpose:

- execute the frozen contract
- detect evidence that invalidates it
- re-enter research when necessary

Re-entry triggers:

- required resource unavailable
- better local context discovered
- user answer changes task scope
- connected app state differs from assumption
- web facts invalidate chosen strategy
- execution failure indicates the plan is infeasible under current permissions/tools

## Contract Model Changes

The current `NormalizedWorkRequest` should be extended rather than replaced.

### New Types

```ts
type GoalFrame = {
  objective: string;
  constraints: string[];
  preferences: string[];
  contextSignals: string[];
  successHypothesis: string[];
  taskCategory:
    | "research"
    | "coding"
    | "browser"
    | "workspace"
    | "app_management"
    | "mixed";
};

type ResearchSource =
  | "conversation"
  | "workspace"
  | "memory"
  | "connected_app"
  | "web"
  | "template";

type ResearchKind =
  | "domain_research"
  | "context_research"
  | "feasibility_research";

type ResearchQuery = {
  id: string;
  kind: ResearchKind;
  source: ResearchSource;
  objective: string;
  required: boolean;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
};

type ResearchEvidence = {
  id: string;
  kind: ResearchKind;
  source: ResearchSource;
  summary: string;
  confidence: number;
  uri?: string;
  artifactPath?: string;
  collectedAt: string;
};

type FactStatus =
  | "confirmed"
  | "inferred"
  | "blocking_unknown"
  | "defaultable";

type UncertaintyItem = {
  id: string;
  topic: string;
  status: FactStatus;
  statement: string;
  whyItMatters: string;
  question?: string;
  defaultValue?: string;
  supportingEvidenceIds: string[];
};

type StrategyOption = {
  id: string;
  title: string;
  description: string;
  pros: string[];
  cons: string[];
  feasibility: "high" | "medium" | "low";
  supportingEvidenceIds: string[];
  selected: boolean;
  rejectionReason?: string;
};

type ReplanPolicy = {
  allowReturnToResearch: boolean;
  triggers: Array<
    | "new_scope_signal"
    | "missing_resource"
    | "permission_block"
    | "contradictory_evidence"
    | "execution_infeasible"
  >;
};
```

### `NormalizedWorkRequest` Additions

```ts
type NormalizedWorkRequest = {
  // existing fields preserved
  goalFrame?: GoalFrame;
  researchQueries?: ResearchQuery[];
  researchEvidence?: ResearchEvidence[];
  uncertaintyRegistry?: UncertaintyItem[];
  strategyOptions?: StrategyOption[];
  selectedStrategyId?: string;
  knownRisks?: string[];
  replanPolicy?: ReplanPolicy;
};
```

### Why These Fields Belong In The Control Plane

- `goalFrame` makes intent understanding explicit and replayable
- `researchQueries` prevents the system from asking the user before checking obvious sources
- `researchEvidence` anchors contract decisions to concrete findings
- `uncertaintyRegistry` is the minimal structure needed for “ask only blocking questions”
- `strategyOptions` replaces “best plan” hand-waving with traceable choice
- `replanPolicy` lets runtime reopen the loop without inventing a second orchestration system

## Execution Plan State Machine

The current execution plan kinds should be extended from:

- `analysis`
- `clarification`
- `execution`
- `reduction`
- `presentation`

to:

- `goal_framing`
- `research`
- `uncertainty_resolution`
- `contract_freeze`
- `execution`
- `reduction`
- `presentation`

### Recommended Lifecycle

```ts
type ExecutionPlanStepKind =
  | "goal_framing"
  | "research"
  | "uncertainty_resolution"
  | "contract_freeze"
  | "execution"
  | "reduction"
  | "presentation";
```

Status transitions:

1. `goal_framing -> completed`
2. `research -> running/completed`
3. `uncertainty_resolution -> blocked` if any `blocking_unknown`
4. `contract_freeze -> completed` only when blocking unknowns are cleared
5. `execution -> blocked` if manual checkpoint is hit
6. `execution -> research` when replan trigger fires
7. `reduction -> presentation -> completed`

### Re-Planning Loop

When execution produces a replan trigger:

1. mark current execution step `blocked`
2. append research evidence describing the contradiction or newly discovered fact
3. reopen `research`
4. rerun `uncertainty_resolution`
5. refreeze contract if strategy changed
6. resume execution with preserved completed steps and artifacts where still valid

This keeps resume semantics consistent with the existing `resumeStrategy`.

## Analyzer Responsibilities

`sidecar/src/orchestration/workRequestAnalyzer.ts` should evolve from a lightweight normalizer into a two-part control-plane constructor:

1. deterministic extraction
2. research-aware planning

### Deterministic Extraction

Still keep fast heuristics for:

- mode detection
- language detection
- local workflow hints
- artifact/deliverable inference
- obvious manual actions

### New Analyzer Outputs

The analyzer should additionally:

1. build `goalFrame`
2. build initial `researchQueries`
3. seed `uncertaintyRegistry`
4. derive initial `strategyOptions`
5. set `replanPolicy`

### Initial Research Query Heuristics

Examples:

- if task mentions implementation approach, architecture, standards, compliance, or best practice
  - add `domain_research` on `web` or local docs
- if task references current repo, files, existing app state, prior work, or “continue”
  - add `context_research` on `conversation`, `workspace`, and `memory`
- if task depends on tools, auth, permissions, or integrations
  - add `feasibility_research` on `workspace`, `connected_app`, and runtime capabilities

The analyzer should not perform research itself. It should define the research agenda and the initial uncertainty map.

## Research Runtime

Add a dedicated runtime slice that executes `researchQueries` before the contract is frozen.

### Proposed Module

- `sidecar/src/orchestration/researchLoop.ts`

Responsibilities:

- execute pending research queries
- collect findings into `researchEvidence`
- merge duplicate or conflicting evidence
- update uncertainty status from evidence
- decide whether more research is possible before asking the user
- produce strategy recommendations

### Runtime Algorithm

1. Start from analyzer-produced `researchQueries`
2. Execute required queries in source-priority order
3. Append `researchEvidence`
4. Recompute `uncertaintyRegistry`
5. If all blockers are cleared, freeze contract
6. If blockers remain and more system research is possible, schedule another query batch
7. If blockers remain and no more system research is possible, emit user clarification

### Source Priority

Default priority should be:

1. `conversation`
2. `workspace`
3. `memory`
4. `connected_app`
5. `template`
6. `web`

Rationale:

- local context is cheaper and usually more authoritative for user-specific work
- web/domain research is often useful, but should not outrank project facts

### Tooling Constraints

The research runtime should respect the same governance rules as execution:

- workspace access remains policy-gated
- connected app access requires existing auth and capability checks
- web browsing should be opt-in by task need, not automatic for every request
- research artifacts must remain user-safe and serializable

## Clarification Policy

The new clarification layer should be a pure transformation of `uncertaintyRegistry`.

### Ask The User Only If

- the item is `blocking_unknown`
- no remaining system research can resolve it
- defaulting would change scope, cost, risk, or irreversibility

### Default Automatically If

- the item is presentation-only
- there is a known project convention
- the default is low-risk and reversible
- the choice does not affect external side effects materially

### Surface Inferred Facts

If Coworkany proceeds on inferred facts, those facts must remain visible in the frozen contract:

- as assumptions
- with evidence references
- with an easy path to revise on user follow-up

## Frozen Contract Changes

The frozen contract should continue to be the authoritative execution input, but it now needs richer rationale.

### Required Frozen Fields

- existing deliverables/checkpoints/user actions
- `confirmedFacts[]`
- `inferredFacts[]`
- `defaultedItems[]`
- `selectedStrategy`
- `alternativeStrategies[]`
- `selectionReason`
- `knownRisks[]`

### Example Shape

```ts
type FrozenWorkRequest = NormalizedWorkRequest & {
  id: string;
  frozenAt: string;
  frozenResearchSummary?: {
    evidenceCount: number;
    sourcesChecked: ResearchSource[];
    blockingUnknownCount: number;
    selectedStrategyTitle?: string;
  };
};
```

This keeps the current persistence model intact while making the contract explainable.

## Prompt Construction Changes

`buildWorkRequestExecutionPrompt` should continue to consume the frozen contract, but the prompt needs to explicitly encode research outcomes.

Add sections for:

- `Goal Frame`
- `Research Summary`
- `Confirmed Facts`
- `Inferred Facts`
- `Defaulted Items`
- `Selected Strategy`
- `Known Risks`
- `Re-Planning Rules`

Execution instructions should state:

- do not reopen solved questions unless new evidence appears
- if new evidence contradicts the contract, append evidence and request replan instead of improvising
- preserve deliverables and completed work when re-entering research

## Protocol And Event Changes

Current additive planner events are the right foundation. Extend them instead of replacing them.

### New Events

- `TASK_RESEARCH_STARTED`
- `TASK_RESEARCH_UPDATED`
- `TASK_CONTRACT_REOPENED`

### Suggested Payloads

```ts
type TaskResearchUpdatedPayload = {
  summary: string;
  sourcesChecked: ResearchSource[];
  completedQueries: number;
  pendingQueries: number;
  blockingUnknowns: string[];
  selectedStrategyTitle?: string;
};
```

```ts
type TaskContractReopenedPayload = {
  reason: string;
  trigger:
    | "new_scope_signal"
    | "missing_resource"
    | "permission_block"
    | "contradictory_evidence"
    | "execution_infeasible";
  preservedDeliverables: string[];
};
```

### Event Semantics

- `TASK_PLAN_READY` remains “contract frozen and ready”
- `TASK_RESEARCH_UPDATED` is the compact user-visible research progress event
- `TASK_USER_ACTION_REQUIRED` is still the only event that requests direct user help
- `TASK_CONTRACT_REOPENED` explains why the runtime moved back from execution to research

This preserves backward compatibility while adding phase visibility.

## Desktop Presentation

Desktop does not need a new screen first. The current chat/task surfaces can absorb this in three compact additions.

### 1. Phase Banner

Show the current phase:

- understanding goal
- researching context
- resolving uncertainty
- contract frozen
- executing
- re-planning

### 2. Research Summary Card

Under the existing plan summary, show:

- sources checked
- count of evidence items
- current blockers
- selected strategy title

This should be compact and event-driven, not a raw log dump.

### 3. Contract Reasoning Snippet

When `TASK_PLAN_READY` arrives, render:

- recommended strategy
- alternatives count
- risks count
- whether any defaults were applied

This helps users understand why Coworkany chose the plan without exposing hidden reasoning traces.

## Persistence And Resume

Research state must persist with the work request so restart and resume paths do not lose the investigation history.

Persist:

- `researchQueries`
- `researchEvidence`
- `uncertaintyRegistry`
- `strategyOptions`
- selected strategy
- replan policy

Resume behavior:

- if contract was not yet frozen, resume from `research` or `uncertainty_resolution`
- if contract was reopened during execution, resume from the reopened phase
- preserve already collected evidence and completed research queries

## Implementation Slices

The safest rollout is additive and slice-based.

### Slice 1: Schema And Planner State

Files:

- `sidecar/src/orchestration/workRequestSchema.ts`
- `sidecar/src/orchestration/workRequestAnalyzer.ts`
- `sidecar/src/orchestration/workRequestRuntime.ts`
- `sidecar/tests/work-request-control-plane.test.ts`

Deliver:

- new research-oriented schema types
- analyzer-generated `goalFrame`, `researchQueries`, `uncertaintyRegistry`, `strategyOptions`
- expanded execution plan kinds
- updated plan summary helpers

### Slice 2: Research Loop Runtime

Files:

- `sidecar/src/orchestration/researchLoop.ts`
- `sidecar/src/handlers/runtime.ts`
- `sidecar/src/execution/runtime.ts`
- `sidecar/tests/work-request-runtime.test.ts`
- `sidecar/tests/execution-runtime.test.ts`

Deliver:

- pre-freeze research query execution
- uncertainty classification and clarification gating
- strategy selection before contract freeze
- execution-triggered contract reopen pathway

### Slice 3: Protocol And UI Visibility

Files:

- `sidecar/src/protocol/events.ts`
- `sidecar/src/execution/taskEventBus.ts`
- `desktop/src/types/events.ts`
- `desktop/src/stores/taskEvents/reducers/taskReducer.ts`
- `desktop/src/components/Chat/`
- `desktop/tests/`

Deliver:

- research/update/reopen events
- task reducer support for research state
- compact research banner/card in existing task UI

### Slice 4: Research Connectors

Files depend on source:

- workspace/session/memory retrieval modules
- connected app adapters
- web search integration

Deliver:

- structured source adapters that feed `researchEvidence`
- deterministic mapping from adapter outputs into uncertainty updates

This slice should come after the state model exists. Otherwise research code will be hard to govern.

## Testing Strategy

Add focused tests at each layer.

### Analyzer Tests

Assert that:

- complex requests produce research queries
- current-project tasks produce `context_research`
- environment/tool-constrained tasks produce `feasibility_research`
- uncertainty items are classified into confirmed/inferred/blocking/defaultable buckets

### Runtime Tests

Assert that:

- execution does not freeze contract before required research completes
- user clarification is requested only after research is exhausted
- user answers can move uncertainty from blocking to confirmed
- execution can reopen the contract when new evidence appears

### Desktop Tests

Assert that:

- research phase is rendered
- selected strategy is visible after freeze
- contract reopen state is visible after replan

## Risks

1. `State bloat`

If evidence objects are too verbose, stored work requests will become noisy and expensive to render.

Mitigation:

- store summaries, URIs, and artifact pointers instead of raw payload dumps

2. `Prompt/runtime split confusion`

If research remains half in prompt and half in runtime, behavior will be inconsistent.

Mitigation:

- keep source selection and uncertainty gating in runtime/state, not only in prompt instructions

3. `UI overload`

If every evidence item is rendered, the chat UI becomes a debug console.

Mitigation:

- expose only compact summaries and blockers by default

4. `Over-research`

If every task triggers web/community research, latency and noise will spike.

Mitigation:

- start with deterministic heuristics and source priorities

## Recommendation

Adopt the additive `planner + researcher` upgrade inside the current control plane.

### Recommended Strategy

- add schema for goal/research/uncertainty/strategy
- make runtime run a pre-freeze research loop
- keep current contract freeze and execution architecture
- add compact research visibility in current desktop UI

### Alternative Strategy

Build a separate research subsystem that hands results to the planner.

Why not first:

- duplicates orchestration state
- complicates persistence and resume
- makes contract invalidation harder

### Selection Rationale

The existing Coworkany control plane already has the correct ownership boundary. The missing capability is not another subsystem; it is a stronger pre-freeze state model plus a governed research loop. That gives the product the behavior you described without fragmenting runtime, persistence, or UI semantics.
