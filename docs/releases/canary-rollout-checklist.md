# Canary Rollout Checklist

## Scope
- Use this checklist after `sidecar/scripts/release-readiness.ts` passes and before widening access beyond the initial beta cohort.
- Treat the generated `artifacts/release-readiness/report.md` as the canonical machine-produced evidence bundle.

## Preflight
- [ ] Run `cd /Users/beihuang/Documents/github/coworkany/sidecar && bun run scripts/release-readiness.ts --build-desktop`.
- [ ] If you have a GUI-capable machine with the required provider credentials, run `cd /Users/beihuang/Documents/github/coworkany/sidecar && bun run scripts/release-readiness.ts --build-desktop --real-e2e`.
- [ ] Attach the generated `artifacts/release-readiness/report.json` and `artifacts/release-readiness/report.md` to the release issue or ship room.

## Real E2E Acceptance
- [ ] Clean-machine onboarding flow passes (`desktop/tests/onboarding-clean-machine-e2e.test.ts`).
- [ ] Desktop acceptance suite passes (`desktop npm test`).
- [ ] Native macOS shell smoke passes when shipping macOS bundles (`desktop/tests/window-shell-mac-smoke.test.ts`).

## Fault Injection
- [ ] Database failure recovery scenario passes (`desktop/tests/database-failure-recovery-e2e.test.ts`).
- [ ] Recovery logs show `ErrorRecovery`, enhanced error formatting, and self-learning trigger evidence.
- [ ] No unrecovered stale scheduled tasks remain after the run.

## Observability
- [ ] Startup metrics JSONL exists under `<appDataDir>/startup-metrics/`.
- [ ] Artifact telemetry JSONL exists under `.coworkany/self-learning/artifact-contract-telemetry.jsonl`.
- [ ] Dependency/service health is checked from the app or Tauri IPC before rollout expansion.
- [ ] Any warnings in the release-readiness report are either resolved or explicitly accepted by the release owner.

## Canary Rollout
- [ ] Limit rollout to named testers first.
- [ ] Keep the previous signed/notarized bundle and release tag available for rollback.
- [ ] Record owner, cohort size, install channel, and rollback trigger in the release issue.
- [ ] Re-check health and telemetry after the first successful canary task execution.
- [ ] Expand rollout only after the release owner posts a go/no-go decision referencing the readiness report.
