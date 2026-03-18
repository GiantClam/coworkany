# Release Readiness Report

Generated: 2026-03-18T05:17:33.107Z
Repository root: /Users/beihuang/Documents/github/coworkany

## Requested Options

- Build desktop: yes
- Real E2E: no
- App data dir: not provided
- Startup profile: all available profiles

## Stage Results

- [x] Sidecar typecheck: passed (21s, exit=0)
  Command: `npm run typecheck`
  CWD: `/Users/beihuang/Documents/github/coworkany/sidecar`
- [x] Sidecar stable regression suite: passed (5s, exit=0)
  Command: `npm run test:stable`
  CWD: `/Users/beihuang/Documents/github/coworkany/sidecar`
- [x] Sidecar release gate tests: passed (0s, exit=0)
  Command: `bun test tests/runtime-commands.test.ts tests/capability-commands.test.ts tests/workspace-commands.test.ts tests/task-event-bus.test.ts tests/task-session-store.test.ts tests/execution-runtime.test.ts tests/work-request-runtime.test.ts tests/planning-files.test.ts tests/release-readiness.test.ts`
  CWD: `/Users/beihuang/Documents/github/coworkany/sidecar`
- [x] Desktop typecheck: passed (6s, exit=0)
  Command: `npx tsc --noEmit`
  CWD: `/Users/beihuang/Documents/github/coworkany/desktop`
- [x] Desktop acceptance suite: passed (1s, exit=0)
  Command: `npm test`
  CWD: `/Users/beihuang/Documents/github/coworkany/desktop`
- [x] Desktop production build: passed (10s, exit=0)
  Command: `npm run build`
  CWD: `/Users/beihuang/Documents/github/coworkany/desktop`

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
