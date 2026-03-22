Sidecar doctor report
Overall: degraded
App data: /Users/beihuang/Documents/github/coworkany/.coworkany
Readiness report: /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/report.json
Thresholds: /Users/beihuang/Documents/github/coworkany/sidecar/evals/control-plane/readiness-thresholds.json (beta)

[WARN] Runtime store integrity: Runtime store not found at /Users/beihuang/Documents/github/coworkany/.coworkany/task-runtime.json
- No persisted runtime store exists yet. This is acceptable for a fresh environment, but incident replay and restart diagnosis will have less context.

[WARN] Session/memory/tenant isolation posture: Runtime store not found at /Users/beihuang/Documents/github/coworkany/.coworkany/task-runtime.json
- No persisted task sessions available to verify isolation contract coverage.

[PASS] Extension governance posture: No enabled third-party extensions detected; governance store has not been created yet.

[PASS] Runtime memory source guards: Guarded runtime sources are free of known global memory bypass patterns (3 file(s) scanned).
- Scanned files: sidecar/src/agent/reactLoop.ts, sidecar/src/agent/autonomousAgent.ts, sidecar/src/main.ts

[PASS] Control-plane readiness posture: Latest readiness artifact is present and passing.
- Control-plane cases: 8/8 passed

[WARN] Observability coverage: Observability coverage has 2 warning(s).
- Startup warning: Startup metrics directory not found: /Users/beihuang/Documents/github/coworkany/.coworkany/startup-metrics
- Artifact telemetry: /Users/beihuang/Documents/github/coworkany/.coworkany/self-learning/artifact-contract-telemetry.jsonl (0 entries)
- Artifact warning: Artifact telemetry file not found: /Users/beihuang/Documents/github/coworkany/.coworkany/self-learning/artifact-contract-telemetry.jsonl

[PASS] Incident anomaly signals: No repeated reopen, clarification, or degraded-output anomalies detected.
- Incident logs scanned: 0 (no incident log roots found)
- Artifact degradation signals: unavailable (/Users/beihuang/Documents/github/coworkany/.coworkany/self-learning/artifact-contract-telemetry.jsonl missing)
