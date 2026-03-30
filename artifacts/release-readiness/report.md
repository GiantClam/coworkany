# Release Readiness Report

Generated at: 2026-03-30T08:44:34.825Z
Repository: /Users/beihuang/Documents/github/coworkany

## Requested Options
- Build desktop: no
- Real E2E: no
- Real model smoke: no
- Doctor required status: degraded
- Canary evidence path: /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/canary-evidence.json
- Require canary evidence: no

## Stages
- [PASSED] Control-plane eval suite (1114ms)
- [PASSED] Sidecar typecheck (1895ms)
- [PASSED] Sidecar stable regression suite (133ms)
- [PASSED] Sidecar release gate tests (1056ms)
- [PASSED] Desktop typecheck (3198ms)
- [PASSED] Desktop acceptance suite (single-path compatible) (297ms)
- [PASSED] Sidecar doctor preflight (1ms)
- [PASSED] Workspace extension allowlist gate (0ms)
  - No enabled third-party extensions detected. (mode=off, enabledSkills=0, enabledToolpacks=0)
- [PASSED] Canary checklist evidence gate (0ms)
  - required=no, completedAreas=0, missingAreas=4

## Control-Plane Eval
- Cases: 36/36 passed
- Runtime replay pass rate: 100.0%
- Threshold source: /Users/beihuang/Documents/github/coworkany/sidecar/evals/control-plane/readiness-thresholds.json
- Threshold profile: beta
- Production replay coverage (canary): 1/1 passed, runtimeReplay 1/1

## Sidecar Doctor
- Overall status: degraded
- Required overall status: degraded

## Canary Checklist
- Completed areas: 0
- Missing areas: 4

## Observability
- No appDataDir provided; startup metrics inspection skipped.
- Artifact telemetry file not found.

