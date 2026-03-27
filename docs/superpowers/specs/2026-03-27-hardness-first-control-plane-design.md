# Hardness-First Control Plane Design

## Goal

Refactor the work-request control plane so deterministic policy decisions remain auditable and testable while execution strategy becomes easier to evolve through a hardness-first analysis layer.

## Problem

The current control plane is still primarily rule-first:

- analyzer heuristics classify complexity, browser usage, manual action, and output shape directly from regex and thresholds
- checkpoint and user-action generation are coupled too tightly to those heuristics
- desktop task cards inherit planner vocabulary like `Task center` and generic checkpoint/action wording instead of showing the real task state
- skills are currently prompt-selection hints, not the right place to own blocking or permission decisions

This creates three problems:

1. hard-coded policy and interaction logic are tangled together
2. desktop collaboration states are harder to explain because UI is downstream of legacy planner terms
3. future skill/workflow expansion risks leaking into safety-critical process logic

## Chosen Architecture

Use a layered model:

1. deterministic policy kernel
2. hardness/capability analysis contract
3. policy resolution into checkpoints and user actions
4. runtime state machine
5. desktop hardness-first presentation

## Analysis Contract

Add `executionProfile` to the frozen work-request contract.

Fields:

- `primaryHardness`
  - `trivial`
  - `bounded`
  - `multi_step`
  - `externally_blocked`
  - `high_risk`
- `requiredCapabilities`
  - `browser_interaction`
  - `external_auth`
  - `workspace_write`
  - `host_access`
  - `human_review`
- `blockingRisk`
  - `none`
  - `missing_info`
  - `auth`
  - `permission`
  - `manual_step`
  - `policy_review`
- `interactionMode`
  - `passive_status`
  - `input_first`
  - `action_first`
  - `review_first`
- `executionShape`
  - `single_step`
  - `staged`
  - `exploratory`
  - `deterministic_workflow`
- `reasons`
  - user-visible or developer-visible supporting reasons for the inferred profile

## Policy Boundary

`executionProfile` must not replace the deterministic kernel.

The kernel still owns:

- permission boundaries
- irreversible side-effect gating
- blocking collaboration decisions
- checkpoint transitions
- resume behavior

The new analysis layer should influence policy resolution, but should not be allowed to bypass or silently redefine those boundaries.

## Runtime / Protocol Changes

Keep compatibility by preserving legacy `checkpoints` and `userActionsRequired`.

Transition plan:

- analyzer infers `executionProfile`
- policy generation consumes `executionProfile`
- `TASK_PLAN_READY` includes both the new profile and the legacy planner fields
- canonical task-stream plan-ready events include `executionProfile` in task data

This keeps old clients readable while letting desktop shift to the new semantics immediately.

## Desktop Presentation

Desktop should render task cards around:

- `primaryHardness`
- `activeHardness`

`activeHardness` is derived from current runtime blocker/state:

- external auth or blocking manual step => `externally_blocked`
- review gate => `high_risk`
- otherwise fall back to `primaryHardness`

UI rules:

- hardness is the primary narrative
- capabilities and blocking risk are supporting context
- collaboration controls keep existing tokens and action wiring
- planner wording is no longer the main explanation surface

## First Implementation Slice

The first slice intentionally stops short of a full policy-engine rewrite.

It includes:

- sidecar `executionProfile` schema and inference
- compatibility passthrough in `TASK_PLAN_READY` and canonical stream data
- desktop session storage for `executionProfile`, `primaryHardness`, `activeHardness`
- hardness-first task-card summary and execution-profile section

It does not yet include:

- a fully isolated policy resolver module
- event-level explicit `activeHardness` payloads
- removal of legacy checkpoint/user-action fields
- full skill/workflow policy re-architecture

## Risks

- Some current heuristics still exist; they are now better isolated but not fully removed.
- Desktop active-hardness transitions are currently derived locally from blocker state rather than emitted directly by sidecar.
- Existing task-card titles outside the generic `Task center` path are preserved to avoid unnecessary churn.

## Follow-Up Work

1. Extract checkpoint and user-action generation into a dedicated policy resolver module.
2. Decide whether sidecar should emit explicit `activeHardness` on blocker/status events.
3. Migrate more analyzer heuristics into capability-first helpers instead of direct event wording branches.
4. Revisit local workflows and skills as execution-policy inputs after the kernel boundary is fully isolated.
