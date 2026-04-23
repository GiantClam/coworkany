# Entrypoint Runtime Command Refactor Plan (2026-04-23)

## Scope
Refactor `sidecar/src/mastra/entrypoint.ts` by extracting runtime/state management command handlers into a dedicated module while preserving external protocol behavior.

## Behavior Lock (already in place)
- Existing regression/integration coverage in `sidecar/tests/mastra-entrypoint.test.ts` for:
  - `bootstrap_runtime_context`
  - `get_runtime_snapshot`
  - `get_tasks`
  - `get_task_runtime_state`
  - `get_task_transcript`
  - `rewind_task`
  - `get_policy_decision_log`
  - `get_hook_events`
- Lifecycle regression subset: `npm run test:runtime:lifecycle`

## Planned Refactor Steps
1. Extract command dispatch for runtime/state list/query operations into `entrypointRuntimeCommands.ts`.
2. Keep side effects and dependencies explicit via injected callbacks (no hidden global imports).
3. Keep response payload shapes and error codes unchanged.
4. Add module-level unit tests for extracted handler (happy path + invalid payload + policy denial).
5. Re-run targeted `mastra-entrypoint` tests + new module tests + sidecar typecheck.

## Guardrails
- No dependency additions.
- No behavior changes to protocol event names or payload keys.
- No rewrites of unrelated runtime workflow logic.

## Follow-up Slice: Host Control Command Parsing

### Scope
Extract host-control command derivation helpers from `entrypoint.ts` into a dedicated module while keeping exported API compatibility (`deriveHostControlShellCommand`).

### Behavior Lock
- Existing tests in `sidecar/tests/mastra-entrypoint.test.ts`:
  - `deriveHostControlShellCommand maps recycle-bin cleanup intent to platform command`
  - `deriveHostControlShellCommand maps relative minute shutdown phrasing to delayed shutdown command`
  - `deriveHostControlShellCommand maps relative reboot delay to delayed reboot command`

### Planned Steps
1. Introduce `sidecar/src/mastra/hostControlCommand.ts` with parsing/normalization helpers and regex constants.
2. Import it in `entrypoint.ts`, re-export `deriveHostControlShellCommand` to preserve current test import path.
3. Add focused module-level unit tests for relative delay and fallback behavior.
4. Re-run targeted tests + `typecheck`.

### Execution Status
- [x] `entrypointRuntimeCommands.ts` extracted and wired.
- [x] `hostControlCommand.ts` extracted and wired with API-compatible export from `entrypoint.ts`.
- [x] `entrypointLegacySimpleCommands.ts` extracted and wired.
- [x] Added module-level tests for runtime commands, host control parsing, and legacy simple command bridge.
- [x] Re-ran targeted suites, lifecycle regression, and sidecar typecheck.

## Follow-up Slice: Missing-Tool-Evidence Retry Runner

### Scope
Extract the `runMissingToolEvidenceAutoRetry` inline closure into a dedicated module while preserving retry floors, adaptive retry budget behavior, and emitted protocol events.

### Behavior Lock
- Existing integration coverage in `sidecar/tests/mastra-entrypoint.test.ts`:
  - `send_task_message auto-retries when task turn has no required tool evidence`
  - `send_task_message defaults to two auto-retries for missing required tool evidence when maxRetries is not provided`
  - `send_task_message schedules failed-step retry when timeout follows explicit command failure event`
  - `send_task_message auto-retries workflow missing tool evidence error for command execution tasks`

### Planned Steps
1. Introduce `entrypointMissingToolEvidenceRetry.ts` with dependency-injected runner factory.
2. Replace inline closure in `entrypoint.ts` with factory wiring only.
3. Re-run focused missing-tool-evidence tests, lifecycle regression, and typecheck.

### Execution Status
- [x] `entrypointMissingToolEvidenceRetry.ts` extracted and wired.
- [x] Missing-tool-evidence retry regressions re-run and passing.
- [x] `test:runtime:lifecycle`, `test:ci`, and `typecheck` passing after extraction.

## Follow-up Slice: Task Runtime State Store Helpers

### Scope
Extract task runtime state helper closures from `entrypoint.ts` into a dedicated module while preserving state merge semantics and operation-log behavior.

### Behavior Lock
- Existing integration coverage in `sidecar/tests/mastra-entrypoint.test.ts`:
  - `bootstrap_runtime_context + get_runtime_snapshot return protocol-compatible snapshot payload`
  - `rewind_task` + runtime-state mutation paths already exercised via recovery command tests
- New focused unit tests will lock:
  - `upsertTaskState` merge behavior and explicit-field overwrite semantics
  - checkpoint version fallback
  - operation-log dedupe + max-length trimming

### Planned Steps
1. Introduce `taskRuntimeStateStore.ts` with dependency-injected factory.
2. Replace inline helpers in `entrypoint.ts` with factory wiring only.
3. Add unit tests for extracted helpers and re-run targeted runtime regressions + typecheck.

### Execution Status
- [x] `taskRuntimeStateStore.ts` now contains extracted helper factory (`createTaskRuntimeStateStore`).
- [x] `entrypoint.ts` now wires task state helper responsibilities via factory injection.
- [x] Added `sidecar/tests/task-runtime-state-store.test.ts` to lock merge, checkpoint fallback, and operation-log semantics.
- [x] Preserved `MastraTaskRuntimeStateStore` export contract in same module for runtime persistence usage.
- [x] Re-ran `typecheck`, targeted runtime suites, `test:runtime:lifecycle`, and `test:ci` successfully.

## Follow-up Slice: Legacy Bootstrap Hydration and Runtime Snapshot Collector

### Scope
Extract legacy runtime bootstrap hydration and runtime snapshot assembly from `entrypoint.ts` into dedicated modules while preserving payload shapes and bootstrap side effects.

### Behavior Lock
- Existing integration coverage in `sidecar/tests/mastra-entrypoint.test.ts`:
  - `bootstrap_runtime_context + get_runtime_snapshot return protocol-compatible snapshot payload`
  - `get_runtime_snapshot includes delegated agent task lifecycle records`
  - `hydrates persisted task states and reuses stored thread/resource for follow-up messages`
  - `downgrades persisted running status to interrupted during bootstrap recovery`
- New focused unit tests:
  - `sidecar/tests/entrypoint-legacy-runtime-bootstrap.test.ts`
  - `sidecar/tests/entrypoint-runtime-snapshot.test.ts`

### Planned Steps
1. Introduce `entrypointLegacyRuntimeBootstrap.ts` for `task-runtime.json` hydration/sanitization flow.
2. Introduce `entrypointRuntimeSnapshot.ts` for snapshot aggregation (tasks, remote sessions, channel deliveries, policy stats).
3. Replace `entrypoint.ts` inline blocks with factory wiring.
4. Re-run targeted + lifecycle + CI subset tests.

### Execution Status
- [x] Added `entrypointLegacyRuntimeBootstrap.ts` and wired `createLegacyRuntimeBootstrapHydrator` in `entrypoint.ts`.
- [x] Added `entrypointRuntimeSnapshot.ts` and wired `createRuntimeSnapshotCollector` in `entrypoint.ts`.
- [x] Added module tests for bootstrap hydration and snapshot aggregation.
- [x] Re-ran `typecheck`, targeted snapshot/bootstrap regressions, `test:runtime:lifecycle`, and `test:ci`.

## Follow-up Slice: Remote Session Fallback Index Helpers

### Scope
Extract local remote-session fallback mapping helpers from `entrypoint.ts` into a dedicated module while preserving remote session command behavior and store-backed precedence.

### Behavior Lock
- Existing integration coverage in `sidecar/tests/mastra-entrypoint.test.ts`:
  - `bind_remote_session + inject_channel_event form external-event to task loop`
  - `open/list/heartbeat/close remote session lifecycle commands work`
  - `sync_remote_session replays pending deliveries and can ack replayed events`
  - `managed channel commands enforce tenant context when strict governance is enabled`
- New focused unit tests:
  - `sidecar/tests/entrypoint-remote-session-index.test.ts`

### Planned Steps
1. Introduce `entrypointRemoteSessionIndex.ts` for bind/unbind/resolve/list helpers.
2. Replace `entrypoint.ts` inline remote-session map logic with injected helper methods.
3. Keep store-backed behavior (`list/get`) precedence unchanged.
4. Re-run targeted remote-session regressions + lifecycle + CI subset.

### Execution Status
- [x] Added `entrypointRemoteSessionIndex.ts` and wired it into `entrypoint.ts`.
- [x] Replaced direct `remoteSessionToTaskId` map usage in command wiring and fallback heartbeat/close paths.
- [x] Added `entrypoint-remote-session-index.test.ts` to lock fallback/store-backed behavior.
- [x] Re-ran `typecheck`, remote-session unit/integration regressions, `test:runtime:lifecycle`, and `test:ci`.

## Follow-up Slice: Remote Session Governance Evaluators

### Scope
Extract remote-session governance evaluators from `entrypoint.ts` into a dedicated module while preserving tenant/endpoint arbitration and managed-command tenant checks.

### Behavior Lock
- Existing integration coverage in `sidecar/tests/mastra-entrypoint.test.ts`:
  - `managed remote session can require tenant id via governance policy`
  - `managed remote session can require endpoint id via governance policy`
  - `tenant isolation blocks cross-tenant remote session takeover`
  - `takeover_if_stale arbitration can transfer active remote session to new task`
  - `managed channel commands enforce tenant context when strict governance is enabled`
- New focused unit tests:
  - `sidecar/tests/entrypoint-remote-session-governance.test.ts`

### Planned Steps
1. Introduce `entrypointRemoteSessionGovernance.ts` with dependency-injected evaluator factory.
2. Replace inline evaluators in `entrypoint.ts` with factory wiring.
3. Re-run governance-focused unit/integration regressions and lifecycle/CI subsets.

### Execution Status
- [x] Added `entrypointRemoteSessionGovernance.ts` and wired `createEntrypointRemoteSessionGovernanceEvaluator` in `entrypoint.ts`.
- [x] Added `entrypoint-remote-session-governance.test.ts` to lock evaluator behavior.
- [x] Re-ran `typecheck`, governance-focused remote-session suites, `test:runtime:lifecycle`, and `test:ci`.

## Follow-up Slice: Remote Session Record + Delivery Event Facade

### Scope
Extract remote-session record mutations and channel-delivery fallback/store-bridged operations from `entrypoint.ts` into a dedicated module while preserving command response semantics.

### Behavior Lock
- Existing integration coverage in `sidecar/tests/mastra-entrypoint.test.ts`:
  - `bind_remote_session + inject_channel_event form external-event to task loop`
  - `open/list/heartbeat/close remote session lifecycle commands work`
  - `sync_remote_session replays pending deliveries and can ack replayed events`
  - `managed channel commands enforce tenant context when strict governance is enabled`
- New focused unit tests:
  - `sidecar/tests/entrypoint-remote-session-records.test.ts`

### Planned Steps
1. Introduce `entrypointRemoteSessionRecords.ts` for upsert/heartbeat/close and channel delivery enqueue/list/ack/get/mark operations.
2. Replace inline closures in `entrypoint.ts` with factory wiring.
3. Preserve startup cache warmup behavior through an explicit `hydrateChannelDeliveryEvents` helper.
4. Re-run targeted remote-session regressions + lifecycle + CI subset.

### Execution Status
- [x] Added `entrypointRemoteSessionRecords.ts` and wired it into `entrypoint.ts`.
- [x] Replaced inline remote-session record and delivery-event closures with extracted helpers.
- [x] Added `entrypoint-remote-session-records.test.ts` for fallback/store delegation coverage.
- [x] Re-ran `typecheck`, remote-session unit/integration regressions, `test:runtime:lifecycle`, and `test:ci`.

## Follow-up Slice: High-Risk Acceptance Regression Gate

### Scope
Add a deterministic high-risk acceptance gate that maps production/manual failure scenarios to targeted automated suites and fails when filtered runs match too few tests.

### Behavior Lock
- New gate script:
  - `sidecar/scripts/run-risk-regression.mjs`
- New package command:
  - `npm run test:risk:acceptance`
- New risk matrix:
  - `docs/regression/coworkany-risk-regression-matrix-20260423.md`

### Planned Steps
1. Encode high-risk suites (TLS trust, approval chain, retry/recovery, tool fallback, remote-session governance full chain).
2. Enforce per-suite `minPass` to prevent false-green "all skipped" pattern runs.
3. Execute risk gate and baseline CI checks (`typecheck`, `test:ci`).

### Execution Status
- [x] Added `run-risk-regression.mjs` with minimum pass-count enforcement.
- [x] Added `test:risk:acceptance` npm script.
- [x] Added scenario-to-suite matrix doc for operator use.
- [x] Executed `npm run test:risk:acceptance`, `npm run typecheck`, and `npm run test:ci` successfully.
