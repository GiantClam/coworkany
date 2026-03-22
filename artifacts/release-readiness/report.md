# Release Readiness Report

Generated: 2026-03-22T03:17:53.591Z
Repository root: /Users/beihuang/Documents/github/coworkany

## Requested Options

- Build desktop: no
- Real E2E: no
- App data dir: not provided
- Startup profile: all available profiles
- Doctor required status: degraded
- Canary evidence path: /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/canary-evidence.json
- Require canary evidence: no
- Control-plane thresholds: /Users/beihuang/Documents/github/coworkany/sidecar/evals/control-plane/readiness-thresholds.json
- Control-plane threshold profile: beta
- Sync production replays: no
- Production replay dataset: default dataset path

## Stage Results

- [x] Control-plane eval suite: passed (5s, exit=0)
  Command: `bun run eval:control-plane --out /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/control-plane-eval-summary.json`
  CWD: `/Users/beihuang/Documents/github/coworkany/sidecar`
- [x] Sidecar typecheck: passed (6s, exit=0)
  Command: `npm run typecheck`
  CWD: `/Users/beihuang/Documents/github/coworkany/sidecar`
- [x] Sidecar stable regression suite: passed (5s, exit=0)
  Command: `npm run test:stable`
  CWD: `/Users/beihuang/Documents/github/coworkany/sidecar`
- [x] Sidecar release gate tests: passed (0s, exit=0)
  Command: `bun test tests/runtime-commands.test.ts tests/capability-commands.test.ts tests/workspace-commands.test.ts tests/task-event-bus.test.ts tests/task-session-store.test.ts tests/execution-runtime.test.ts tests/work-request-runtime.test.ts tests/planning-files.test.ts tests/release-readiness.test.ts`
  CWD: `/Users/beihuang/Documents/github/coworkany/sidecar`
- [x] Desktop typecheck: passed (3s, exit=0)
  Command: `npx tsc --noEmit`
  CWD: `/Users/beihuang/Documents/github/coworkany/desktop`
- [x] Desktop acceptance suite: passed (0s, exit=0)
  Command: `npm test`
  CWD: `/Users/beihuang/Documents/github/coworkany/desktop`
- [x] Sidecar doctor preflight: passed (0s, exit=0)
  Command: `bun run doctor -- --output-dir /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/doctor --readiness-report /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/report.json`
  CWD: `/Users/beihuang/Documents/github/coworkany/sidecar`
- [x] Workspace extension allowlist gate: passed (0s, exit=0) — No enabled third-party extensions detected; workspace allowlist enforcement is not required yet. (mode=off, enabledSkills=0, enabledToolpacks=0)
  Command: `workspace extension allowlist policy check`
  CWD: `/Users/beihuang/Documents/github/coworkany`
- [x] Canary checklist evidence gate: passed (0s, exit=0) — required=no, completedAreas=0, missingAreas=6
  Command: `canary checklist evidence validation (/Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/canary-evidence.json)`
  CWD: `/Users/beihuang/Documents/github/coworkany`

## Control-Plane Eval

- Summary: `/Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/control-plane-eval-summary.json`
- Cases: 8/8 passed
- Clarification rate: 16.7%
- Unnecessary clarification rate: 0.0%
- Freeze expectation pass rate: 100.0%
- Artifact expectation pass rate: 100.0%
- Artifact satisfaction rate: 50.0%
- Runtime replay pass rate: 100.0%
- Production replay coverage (canary): 1/1 passed, runtimeReplay 1/1
- Gate: passed
- Thresholds: `/Users/beihuang/Documents/github/coworkany/sidecar/evals/control-plane/readiness-thresholds.json`
- Threshold profile: beta
- Max unnecessary clarification rate: 5.0%
- Min freeze expectation pass rate: 100.0%
- Min artifact expectation pass rate: 100.0%
- Min runtime replay pass rate: 100.0%
- Require zero failed cases: yes
- Min production replay cases (canary): 1

## Sidecar Doctor

- Report: `/Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/doctor/report.json`
- Markdown: `/Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/doctor/report.md`
- Overall status: degraded
- Failed checks: 0
- Warned checks: 3
- Check (warn): runtime-store — Runtime store not found at /Users/beihuang/Documents/github/coworkany/.coworkany/task-runtime.json
- Check (warn): isolation-contracts — Runtime store not found at /Users/beihuang/Documents/github/coworkany/.coworkany/task-runtime.json
- Check (pass): extension-governance — No enabled third-party extensions detected; governance store has not been created yet.
- Check (pass): memory-source-guards — Guarded runtime sources are free of known global memory bypass patterns (3 file(s) scanned).
- Check (pass): control-plane-readiness — Latest readiness artifact is present and passing.
- Check (warn): observability — Observability coverage has 2 warning(s).
- Check (pass): anomaly-signals — No repeated reopen, clarification, or degraded-output anomalies detected.
- Gate: passed
- Required overall status: degraded

## Canary Evidence

- Evidence file: `/Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/canary-evidence.json`
- Exists: no
- Completed areas: 0
- Missing areas: 6
- Areas missing evidence: Audience, Decision Gate, Fault Injection, Health, Observability, Rollback
- Gate: passed
- Required: no

## Observability

- Startup metrics: no files inspected
- Warning: No appDataDir provided; startup metrics inspection skipped.
- Artifact telemetry: `/Users/beihuang/Documents/github/coworkany/.coworkany/self-learning/artifact-contract-telemetry.jsonl` (0 entries)
- Warning: Artifact telemetry file not found: /Users/beihuang/Documents/github/coworkany/.coworkany/self-learning/artifact-contract-telemetry.jsonl

## Canary Checklist

- [ ] Audience: Restrict initial rollout to named internal testers or a small external beta cohort.
  Evidence: Tester list, install channel, and rollback contact owner documented.
- [ ] Rollback: Keep the previous signed/notarized bundle and matching tag available for immediate rollback.
  Evidence: Previous release asset URLs or archived artifacts attached to the release issue.
- [ ] Observability: Collect startup metrics and artifact telemetry from at least one canary session before widening the rollout.
  Evidence: Startup metrics JSONL path and artifact telemetry JSONL excerpt linked in release notes or issue.
- [ ] Fault Injection: Run the database failure recovery scenario and verify logs show the expected recovery path.
  Evidence: Playwright report or captured logs from the failure-injection run.
- [ ] Health: Check sidecar and managed service health after install and after the first task execution.
  Evidence: Health check output or screenshots from the dependency/service status UI.
- [ ] Decision Gate: Hold rollout expansion until no blocker regression remains in readiness report warnings or failed stages.
  Evidence: Final go/no-go comment referencing the readiness report artifact.
