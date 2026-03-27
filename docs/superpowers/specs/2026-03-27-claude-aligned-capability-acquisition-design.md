# Claude-Aligned Capability Acquisition Design

## Goal

Refine the bounded capability-acquisition design using Anthropic's official best practices so CoworkAny can:

- detect internal capability gaps without confusing them with user blockers
- acquire missing capabilities in a bounded and auditable way
- validate learned artifacts before resuming execution
- preserve hard safety and approval boundaries for external write actions

This document supersedes the generic bounded-capability design when Anthropic-specific guidance suggests a better mechanism or a tighter constraint.

## Source Of Truth

This design is based on Anthropic's official documentation:

- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
- [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)
- [Increase output consistency](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/increase-consistency)
- [Define your success criteria](https://platform.claude.com/docs/en/test-and-evaluate/define-success)
- [Using the Evaluation Tool](https://platform.claude.com/docs/en/test-and-evaluate/eval-tool)
- [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)

## Important Corrections To The Prior Draft

The earlier Claude-inspired draft had the right direction but overstated a few mechanisms. These corrections matter for production design.

### 1. Do not model this as literal Claude Code subagents or Agent Skills

Anthropic's official Claude Code guidance strongly recommends focused subagents with limited tools and clear responsibilities. That is a useful architectural pattern for CoworkAny.

But CoworkAny is not Claude Code. Therefore:

- we should adopt the pattern of focused capability specialists
- we should not couple CoworkAny's runtime contract to Claude Code-only product primitives

In CoworkAny, the equivalent should be:

- internal capability packages
- focused capability-acquisition workers
- tool-limited execution phases

not a hard dependency on Claude Code subagent files.

### 2. Do not rely on a generic public "Think Tool" API primitive

Anthropic's official docs support extended thinking and interleaved thinking. Claude Code also documents that "think" can trigger basic extended thinking in some workflows.

However, for CoworkAny's runtime design, the stable official primitive is:

- extended thinking
- structured outputs
- tool use with schema-defined tools

So the capability-gap classifier should be designed as a structured reasoning stage, not as a mandatory custom "think" tool dependency.

### 3. Do not assume a universal Tool Search Tool API

Anthropic documents MCP Tool Search in Claude Code as a deferred tool-loading pattern that keeps context usage low by loading only relevant tool definitions.

That is a strong design inspiration.

But for CoworkAny, the safe translation is:

- internal deferred capability registry
- phase-scoped tool exposure
- capability search before capability generation

rather than assuming a public Anthropic API tool called directly from CoworkAny.

### 4. Structured outputs are now strong enough to be the core routing primitive

Anthropic's current structured outputs docs explicitly state:

- JSON outputs via `output_config.format`
- strict tool use via `strict: true`
- guaranteed schema conformance in the normal case

This is stronger than prompt-only JSON mode and should be the main contract mechanism for `capabilityPlan`.

## Claude-Aligned Design Principles

The final design should follow these principles.

### 1. Structured decisions first

Capability routing must be emitted as structured output, not inferred from free text.

Anthropic explicitly recommends structured outputs for guaranteed schema conformance, and the consistency guide says to use structured outputs when you need schema-level guarantees rather than prompt-only formatting techniques.

### 2. Focused specialists with limited tools

Anthropic's subagent guidance recommends:

- single, clear responsibilities
- limited tool access
- separate context windows

CoworkAny should mirror this by isolating capability acquisition into a dedicated worker phase with a narrow tool surface.

### 3. Tool definitions matter as much as prompts

Anthropic's tool docs emphasize:

- extremely detailed tool descriptions
- meaningful namespacing
- `input_examples` for complex tools
- consolidating related operations into fewer tools

This means CoworkAny should prefer a smaller number of well-described learning and validation tools rather than a broad, ambiguous tool surface.

### 4. Use extended thinking only where it materially improves decisions

Anthropic's extended thinking docs show that interleaved thinking is valuable when Claude needs to reason between tool calls and react to intermediate results.

CoworkAny should therefore use extended thinking selectively:

- yes for gap classification
- yes for validation and replay decisions
- no by default for simple research or deterministic generation steps

### 5. Preserve explicit review gates for external writes

Anthropic's computer-use guidance warns that login workflows and prompt injection raise the risk of bad outcomes, and recommends end-to-end verification for long-running agents.

So generated tools that can publish or mutate external systems must remain approval-gated even if they validate successfully in a sandbox.

## Chosen Architecture

CoworkAny should implement a Claude-aligned bounded capability-acquisition loop with four major layers:

1. structured capability classification
2. focused capability-acquisition worker
3. validation and install policy gate
4. checkpoint replay into the original task

## Layer 1: Structured Capability Classification

### New `capabilityPlan`

`capabilityPlan` remains the right abstraction, but it should now be generated through Anthropic structured outputs rather than prompt-only conventions.

Suggested shape:

```ts
type MissingCapabilityKind =
  | 'none'
  | 'existing_skill_gap'
  | 'existing_tool_gap'
  | 'new_runtime_tool_needed'
  | 'workflow_gap'
  | 'external_blocker';

type LearningScope = 'none' | 'knowledge' | 'skill' | 'runtime_tool';

type ComplexityTier = 'simple' | 'moderate' | 'complex';

interface CapabilityPlan {
  missingCapability: MissingCapabilityKind;
  learningRequired: boolean;
  canProceedWithoutLearning: boolean;
  learningScope: LearningScope;
  replayStrategy: 'none' | 'resume_from_checkpoint' | 'restart_execution';
  sideEffectRisk: 'none' | 'read_only' | 'write_external';
  userAssistRequired: boolean;
  userAssistReason:
    | 'none'
    | 'auth'
    | 'captcha'
    | 'permission'
    | 'policy'
    | 'ambiguous_goal';
  boundedLearningBudget: {
    complexityTier: ComplexityTier;
    maxRounds: number;
    maxResearchTimeMs: number;
    maxValidationAttempts: number;
  };
  reasons: string[];
}
```

### Anthropic-specific implementation guidance

Use either:

- JSON structured outputs via `output_config.format`, or
- strict tool use with `strict: true`

to force the classifier to emit a valid `capabilityPlan`.

Recommended preference:

- use `strict: true` when the classifier is already framed as a tool-routing decision
- use JSON structured outputs when `capabilityPlan` is the final result of the classification step

### Dynamic budgets instead of fixed global defaults

The capability budget should be part of the structured output rather than a hardcoded constant.

Default mapping:

- `simple`
  - `maxRounds = 1`
  - `maxResearchTimeMs = 15000`
  - `maxValidationAttempts = 1`
- `moderate`
  - `maxRounds = 2`
  - `maxResearchTimeMs = 60000`
  - `maxValidationAttempts = 2`
- `complex`
  - `maxRounds = 4`
  - `maxResearchTimeMs = 180000`
  - `maxValidationAttempts = 3`

This keeps the budget explainable while allowing more headroom for truly novel capabilities.

## Layer 2: Focused Capability-Acquisition Worker

Anthropic's subagent guidance translates well here even though CoworkAny is not literally Claude Code.

### Design rule

Capability acquisition should run in a focused worker context with:

- its own prompt or system contract
- a reduced tool set
- separate progress events
- no access to the full execution tool surface

This worker should do one thing only:

- acquire or validate the missing capability needed to resume the original task

### Worker responsibilities

1. search reusable capabilities first
2. research only if reuse fails
3. generate or refine a capability artifact
4. validate the artifact
5. produce an install or review decision

### Why this is better

It applies Anthropic's focused-specialist pattern:

- clearer role
- less context pollution
- lower chance of accidental wrong-tool selection
- easier trace evaluation

## Layer 3: Tool Visibility And Deferred Loading

Anthropic's MCP Tool Search docs show the value of deferring tool definitions until they are relevant. CoworkAny should adopt this principle internally.

### Normal execution phase

Expose the normal task tools allowed by the frozen contract.

### Capability-acquisition phase

Expose only:

- capability search and reuse lookup
- web/docs retrieval
- isolated file/code generation
- validation tools
- precipitation/install-prep tools

Hide:

- external publish tools
- browser write tools against live systems
- host-destructive tools
- unrelated high-power tools

### Tool design guidance

Per Anthropic's tool docs:

- use strong namespacing
- write long, precise descriptions
- provide `input_examples` for complex nested inputs
- consolidate related operations into fewer tools where possible

For CoworkAny this means:

- prefer `capability_generate_artifact` over many overlapping generation tools
- prefer `capability_validate_artifact` over a loose collection of one-off validation tools

## Layer 4: Extended Thinking Where It Matters

Anthropic documents interleaved thinking as the right mechanism when the model needs to:

- reason after tool results
- chain multiple tool calls with reasoning in between
- make nuanced decisions from intermediate evidence

### Use extended thinking in these phases

- `capability_gap_detected`
- `capability_validating`
- `capability_replay_ready`

### Do not default to extended thinking in these phases

- straightforward capability search
- deterministic code generation
- simple registry lookups

### Important Anthropic constraints

When extended thinking is enabled with tool use:

- `tool_choice` can only be `auto` or `none`
- you must preserve and pass back the full unmodified `thinking` blocks when continuing the tool-use turn
- long thinking workflows should consider 1-hour prompt caching

This changes the runtime design in one important way:

CoworkAny must not rely on forced tool selection during thinking-enabled validation turns.

Instead, it should:

- constrain the available tool set tightly
- let Claude choose among that narrow tool set
- validate the resulting trace

## New Runtime State Machine

The state machine from the earlier design still stands, but it should be interpreted through Anthropic's phase-specific model and reasoning guidance.

### Runtime phases

- `capability_gap_detected`
- `capability_researching`
- `capability_generating`
- `capability_validating`
- `capability_install_pending_review`
- `capability_replay_ready`
- `execution_resumed`

### User-visible semantics

- `blockingReason=capability_gap` is informational, not a request for user input
- `TASK_USER_ACTION_REQUIRED` only appears when `userAssistRequired=true`
- no clarification copy is shown when the system is internally acquiring capability

### Model allocation by phase

Anthropic's tool-use docs recommend stronger models for complex tools and ambiguous queries, and lighter models for straightforward steps.

Recommended baseline:

- `capability_gap_detected`
  - model: strongest available Claude reasoning model
  - thinking: enabled
- `capability_researching`
  - model: mid-tier Claude model
  - thinking: off
- `capability_generating`
  - model: mid-tier Claude model
  - thinking: off
- `capability_validating`
  - model: strongest available Claude reasoning model
  - thinking: enabled
- `capability_install_pending_review`
  - no model call required unless preparing human-readable review
- `execution_resumed`
  - existing task execution model policy

Do not encode exact model IDs into the contract. Keep them in runtime policy so they can evolve without contract churn.

## Validation Standard

The previous design needed a sharper definition of "validation passed". Anthropic's evaluation docs emphasize measurable success criteria, multidimensional evaluation, and the importance of well-defined examples.

### Validation must pass three layers

#### 1. Structural validation

Must pass:

- schema-conformant output
- valid install manifest
- no unauthorized external calls during sandbox validation

#### 2. Behavioral validation

Must pass:

- positive examples pass at the target rate
- negative examples reject at the target rate

Recommended initial thresholds:

- positive pass rate: `>= 0.90`
- negative reject rate: `>= 0.95`

#### 3. Replay suitability

For artifacts that can influence live external state:

- deterministic enough to replay
- idempotence or duplicate-risk handling defined
- rollback or safe-abort strategy documented

Validation is not complete until all three layers pass.

## Approval Policy For External Write Artifacts

Anthropic's computer-use guidance is clear that login and live external actions are risky. CoworkAny should therefore split generated artifacts into two classes.

### Auto-installable

- knowledge entries
- internal procedures
- internal read-only skills

### Approval-gated

- external publishing tools
- browser workflows that can submit or mutate external state
- tools requiring sensitive host or credential access

A generated `wechat_official_post` capability can be researched and validated, but if it can publish to a live account it must enter `capability_install_pending_review` before it can be used in `execution_resumed`.

## End-To-End Verification Rule

Anthropic's computer-use guidance specifically recommends end-to-end verification at the start of each session for agents that span multiple sessions.

CoworkAny should adopt the equivalent rule:

- before replaying a learned external capability against a live platform, run a lightweight end-to-end readiness check
- do not rely only on previous successful validation artifacts

For browser-backed publish capabilities, readiness checks should include:

- session/login state
- target surface reachability
- presence of expected editor or action elements

## Migration Plan

### Slice 1: Claude-aligned contract

- add `capabilityPlan`
- generate it with structured outputs
- add `complexityTier` and dynamic budget fields
- add `blockingReason=capability_gap`

### Slice 2: Focused capability worker

- create a dedicated capability-acquisition worker flow
- narrow its visible tools
- add distinct progress events

### Slice 3: Anthropic-aware validation flow

- use extended thinking only in gap detection and validation
- preserve thinking blocks correctly across tool turns
- add validation thresholds and negative-example tests

### Slice 4: Approval and replay

- classify generated artifacts by external side-effect risk
- approval-gate external write artifacts
- add pre-replay readiness verification

## Rejected Alternatives

### 1. Prompt-only JSON planning

Rejected because Anthropic now offers structured outputs with stronger guarantees.

### 2. Unlimited learning until success

Rejected because it conflicts with bounded, auditable workflows and creates unacceptable risk for live external writes.

### 3. Treating capability acquisition as a user-action blocker

Rejected because internal capability gaps are not user dependencies and should not trigger clarification UI.

### 4. Directly adopting Claude Code product primitives in CoworkAny runtime

Rejected because Claude Code subagents and MCP tool search are valuable patterns, but CoworkAny needs product-independent internal equivalents.

## Recommendation

Adopt a Claude-aligned bounded capability-acquisition design with these concrete choices:

- structured outputs for `capabilityPlan`
- focused capability-acquisition workers inspired by Anthropic subagent best practices
- deferred, phase-scoped tool visibility inspired by MCP Tool Search
- extended thinking only for the phases that truly need reasoning between tool calls
- explicit approval gates for generated external write tools
- measurable validation criteria with both positive and negative examples

This gives CoworkAny a tighter and more production-ready architecture than either:

- the current post-failure-only self-learning path, or
- an unbounded "learn until it works" loop.
