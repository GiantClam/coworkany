# Bounded Capability Acquisition Design

## Goal

When CoworkAny discovers during execution that it lacks a required capability, skill, or runtime tool, it should not either:

- fail immediately and defer all learning until after the task, or
- enter an unbounded self-learning loop that keeps mutating behavior until something works.

Instead, CoworkAny should switch into a bounded capability-acquisition phase, learn only within explicit limits, validate the learned artifact, and then resume the original task from a checkpoint.

This design aligns the current self-learning stack with OpenAI best practices for structured outputs, constrained tool use, long-running agent workflows, and eval-driven development.

## Current Problems

The current codebase already has a substantial self-learning stack:

- `gapDetector`
- `researchEngine`
- `learningProcessor`
- `labSandbox`
- `precipitator`
- `reuseEngine`
- `validate_skill`
- `find_learned_capability`

But the runtime semantics are still wrong for this class of task.

### Problem 1: Learning is mostly post-failure

`AUTONOMOUS_LEARNING_PROTOCOL` currently says self-learning is post-execution, not pre-execution. In practice this means the runtime mostly learns after failure rather than when it first detects a capability gap.

### Problem 2: Capability gaps and user blockers are conflated

The system can already express `auth`, `permission`, and `manual_step` blockers. But "we do not have a tool for this platform" is not a user blocker. It is an internal capability blocker. The user should not see clarification text for that case.

### Problem 3: Free-text still has too much control

The current stack can decide to learn or ask the user based on prompts, heuristics, and fallback text handling. This is brittle and makes high-risk write workflows harder to audit.

### Problem 4: Generated write tools lack a hard approval boundary

For external side effects such as publishing, the system needs a stronger boundary than "the model generated a tool and it passed some tests". Auto-generating a new external write tool and immediately using it on a live account is too permissive.

## Official Guidance Mapped To This Design

This design follows these OpenAI best-practice themes:

1. Use structured outputs with strict schemas for key routing decisions instead of free-text interpretation.
2. Constrain tool use per phase instead of exposing the whole tool surface at once.
3. Treat long-running execution as an explicit state machine, not as a single free-form loop.
4. Use evals on workflow traces and decision outputs, not only on final text.
5. Keep explicit approval gates around high-risk write actions.

References:

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/reasoning-best-practices
- https://developers.openai.com/api/docs/guides/evaluation-best-practices
- https://developers.openai.com/api/docs/guides/agent-evals
- https://developers.openai.com/api/docs/guides/developer-mode

## Chosen Architecture

Add a bounded capability-acquisition loop between planning and execution.

The runtime becomes:

1. freeze task contract
2. derive capability plan
3. if no learning is required, execute normally
4. if learning is required, enter capability-acquisition phase
5. validate generated artifact
6. if validation passes, install or stage it according to risk policy
7. replay the original task from the blocked checkpoint
8. if validation or installation fails within budget, stop and surface a deterministic failure

This preserves the original work request as the source of truth. Learning is a subroutine, not a replacement plan.

## Contract Changes

### New `capabilityPlan`

Add `capabilityPlan` to the frozen work-request contract.

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

type CapabilityReplayStrategy =
  | 'none'
  | 'resume_from_checkpoint'
  | 'restart_execution';

interface CapabilityPlan {
  missingCapability: MissingCapabilityKind;
  learningRequired: boolean;
  canProceedWithoutLearning: boolean;
  learningScope: LearningScope;
  replayStrategy: CapabilityReplayStrategy;
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
    maxRounds: number;
    maxResearchTimeMs: number;
    maxValidationAttempts: number;
  };
  reasons: string[];
}
```

### Semantics

- `userAssistRequired=false` means desktop must not show input-request copy or input controls.
- `learningRequired=true` means the runtime must switch phase before attempting the blocked work.
- `sideEffectRisk='write_external'` means any generated runtime tool requires an approval or policy-install gate before live use.
- `replayStrategy='resume_from_checkpoint'` means the original task must continue from the last blocked step rather than replan from scratch.

## New Runtime State Machine

The current task lifecycle needs explicit capability states.

### New active runtime phases

- `capability_gap_detected`
- `capability_researching`
- `capability_generating`
- `capability_validating`
- `capability_install_pending_review`
- `capability_replay_ready`
- `execution_resumed`

### Hardness / blocker mapping

- `activeHardness=multi_step` for research, generation, validation, and replay preparation
- `blockingReason=capability_gap` when the system is internally blocked by missing capability
- `TASK_USER_ACTION_REQUIRED` is not emitted for `capability_gap`
- `TASK_USER_ACTION_REQUIRED` is only emitted for `auth`, `captcha`, `permission`, `policy`, or genuinely ambiguous user goals

This preserves the rule that only real user dependencies should produce request-assistance UI.

## Tool Visibility Model

OpenAI best practice is to constrain tools per phase. The runtime should stop exposing the full tool surface during capability acquisition.

### Allowed tools by phase

#### Normal execution

Existing execution tools remain visible according to the frozen request and current policy.

#### Capability-acquisition phase

Only these categories should be exposed:

- `find_learned_capability`
- search / docs retrieval
- code/file authoring inside the isolated lab
- `validate_skill`
- precipitation / installation preparation
- confidence and reuse recording

The following should be hidden during capability acquisition:

- external publish tools
- browser write tools against live sites
- host-destructive tools
- general-purpose external side-effect tools unrelated to validation

### Tool-calling constraints

For capability-acquisition steps:

- use strict structured outputs for planner decisions
- set `parallel_tool_calls=false`
- require the next tool or no-tool decision from a narrow schema

This reduces planner drift and makes traces easier to evaluate.

## Learning Budget And Stop Conditions

The runtime should never "learn until success" without limit.

### Default limits

- `maxRounds = 2`
- `maxResearchTimeMs = 60000`
- `maxValidationAttempts = 2`

### Stop conditions

Stop capability acquisition immediately when:

- the generated artifact fails validation twice
- the learning plan requires unsupported external credentials
- the blocker is actually `auth`, `captcha`, `permission`, or `policy`
- the proposed generated tool would perform external writes without passing install policy
- the learning loop exceeds time or round budget

### Outcomes

- if validation succeeds and install policy passes: resume the original task
- if validation succeeds but install approval is required: surface a review gate
- if validation fails within budget: deterministic task failure with capability-gap diagnosis

## Approval Policy For Generated Tools

Not all learned artifacts should be treated equally.

### Auto-usable artifacts

These can be installed and reused automatically when confidence is high enough:

- knowledge entries
- read-only procedures
- internal skills with no external side effects

### Approval-gated artifacts

These require review before live use:

- generated runtime tools that write to external platforms
- browser workflows that can publish, submit, or mutate external state
- tools that require host access or write to sensitive local paths

For example, a generated `wechat_official_post` tool can be researched and validated in a controlled environment, but should enter `capability_install_pending_review` before it is allowed to publish against a live account.

## Runtime Integration

### `gapDetector`

Upgrade `detectGaps()` so it produces a structured decision that can distinguish:

- internal capability gap
- reusable existing capability
- real user blocker
- safe-to-proceed partial knowledge

Do not let prompt text decide this late in the loop.

### `SelfLearningController`

Add a dedicated method:

```ts
acquireCapabilityForTask(
  preparedWorkRequest: PreparedWorkRequest,
  capabilityPlan: CapabilityPlan,
  context: CapabilityAcquisitionContext
): Promise<CapabilityAcquisitionResult>
```

This should:

1. search for reusable capabilities
2. research only if reuse is insufficient
3. generate a skill or runtime tool candidate
4. validate it
5. install or stage it based on risk policy
6. return a replay-ready artifact reference

### `execution/runtime.ts`

Add a gate before normal tool execution:

- if `capabilityPlan.learningRequired=false`, continue
- if `capabilityPlan.learningRequired=true`, suspend execution and run capability acquisition

After successful capability acquisition:

- inject the new capability reference into the resumed execution context
- resume from the blocked checkpoint
- preserve original task identity and user-visible history

### `main.ts`

Capability-acquisition events from `SelfLearningController` should be translated into task events so desktop can display progress without pretending the user needs to type anything.

## Desktop Semantics

Desktop should treat capability acquisition as internal work in progress.

### UI rules

- show task is still active
- show `activeHardness=multi_step`
- show `blockingReason=capability_gap` as informational status
- do not show input box or "please confirm" copy unless `userAssistRequired=true`
- if install approval is required for a generated external write tool, show review UI rather than open text clarification

### Copy guidance

Allowed:

- "CoworkAny is acquiring the missing publishing capability."
- "Validating generated workflow before resuming the task."
- "Generated external publishing tool is ready for review."

Disallowed unless there is a real user blocker:

- "Please clarify..."
- "Can you confirm..."
- "Do you want me to..."
- "Are you referring to..."

## Migration Plan

### Slice 1: Contract and event model

- add `capabilityPlan` schema
- add `blockingReason=capability_gap`
- add runtime phases and event payloads
- desktop renders capability acquisition as internal status, not user input

### Slice 2: Runtime gate

- add pre-execution capability gate in `execution/runtime.ts`
- route capability gaps to `SelfLearningController.acquireCapabilityForTask(...)`
- preserve original task checkpoint and replay metadata

### Slice 3: Validation and approval

- classify generated artifacts by risk
- auto-install safe internal artifacts
- stage external write tools for explicit approval

### Slice 4: Eval coverage

Add evals and tests for:

- decision correctness: gap vs user blocker
- tool-visibility correctness during capability acquisition
- validation-gated replay
- approval requirement for generated external write tools
- no user-assistance copy when `userAssistRequired=false`

## Recommended Test Matrix

### Unit

- `gapDetector` returns `learningRequired=true` for missing platform tool
- `gapDetector` returns `userAssistRequired=true` for auth/captcha blockers
- install policy classifies generated external write tools as approval-gated

### Integration

- publish task with missing platform tool enters capability phase, validates generated tool, then resumes
- missing capability plus auth blocker does not enter learning loop and instead emits user action
- failed validation twice ends task deterministically

### Trace / eval

- agent never emits user-input-seeking final text when `userAssistRequired=false`
- capability-acquisition phase never calls live publish tools
- replay resumes from blocked checkpoint rather than replanning the whole task

## Rejected Alternatives

### 1. Keep post-execution-only learning

Rejected because it guarantees at least one avoidable failure for capability-gap tasks.

### 2. Unlimited self-learning until success

Rejected because it is operationally unsafe, especially for external write workflows, and violates bounded-agent best practice.

### 3. Let desktop hide the bad text while runtime stays unchanged

Rejected because it treats the symptom, not the control-plane bug.

## Recommendation

Implement bounded capability acquisition as a first-class runtime phase.

This preserves the strong parts of the existing self-learning stack, fixes the current "post-failure only" weakness, separates internal capability gaps from real user blockers, and adds the missing risk boundary for generated external write tools.
