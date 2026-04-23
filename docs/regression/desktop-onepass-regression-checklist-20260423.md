# Desktop One-Pass Regression Checklist (2026-04-23)

## Goal

Ensure a user can submit tasks from desktop and pass core flows in one run without manual trial-and-error retries.

## Scenario Set (User-facing)

1. TLS/Certificate failures are surfaced as actionable configuration issues.
2. Approval-chain interruptions can recover via retry/recover flow.
3. Tool evidence missing triggers deterministic retry/failure, no silent hang.
4. Task abnormal termination always lands in explicit failed/recoverable state.
5. Desktop pending/retrying states are visible and consistent.
6. Regular tasks (market lookup, command-execution, read-only flows) are unobstructed.

## Automated Gate

Run from `sidecar/`:

```bash
npm run lint
npm run typecheck
npm run test:risk:acceptance
npm run test:runtime:lifecycle
```

The `test:risk:acceptance` gate now includes a desktop replay suite via fixture-driven execution:

- `../desktop/tests/task-retry-policy.test.ts`
- `../desktop/tests/task-failure-ui.test.ts`
- `../desktop/tests/pending-task-status.test.ts`

## Fixture Source of Truth

- `sidecar/tests/fixtures/risk-regression-suites.json`

Add/adjust desktop manual-acceptance coverage by updating this fixture (not hardcoded script logic).

## CI Enforcement

PR gate (`scripts/test-codex.ts`) includes:

- Sidecar lint + typecheck + risk acceptance replay
- Desktop lint + typecheck + desktop acceptance suite

## Release Readiness Rule

Do not ship desktop/runtime changes unless all above gates pass in the same branch and same commit range.
