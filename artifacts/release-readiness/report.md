# Release Readiness Report

Generated at: 2026-04-05T08:48:13.242Z
Repository: /Users/beihuang/Documents/github/coworkany

## Requested Options
- Build desktop: no
- Real E2E: no
- Real model smoke: no
- Doctor required status: degraded
- Canary evidence path: /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/canary-evidence.json
- Require canary evidence: no
- Repo matrix input: /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/repo-matrix.v2.json
- Repo matrix report: /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/repo-matrix-report.run2.json
- Repo matrix evidence: /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/repo-matrix-evidence/run2

## Stages
- [PASSED] Control-plane eval suite (3264ms)
- [PASSED] Sidecar typecheck (2224ms)
- [PASSED] Sidecar stable regression suite (202ms)
- [PASSED] Sidecar release gate tests (19541ms)
- [PASSED] Desktop typecheck (3481ms)
- [PASSED] Desktop acceptance suite (single-path compatible) (196ms)
- [PASSED] Repository matrix verification contract (3358ms)
  - repos=4; out=/Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/repo-matrix-report.run2.json; evidence=/Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/repo-matrix-evidence/run2
- [PASSED] Sidecar doctor preflight (2ms)
- [PASSED] Workspace extension allowlist gate (0ms)
  - No enabled third-party extensions detected. (mode=off, enabledSkills=0, enabledToolpacks=0)
- [PASSED] Canary checklist evidence gate (0ms)
  - required=no, completedAreas=0, missingAreas=4

## Control-Plane Eval
- Cases: 76/76 passed
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
- OTEL sampling enabled but no OTLP endpoint configured (set COWORKANY_OTEL_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT).

