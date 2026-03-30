# Release Readiness Report

Generated at: 2026-03-30T15:45:04.118Z
Repository: /Users/beihuang/Documents/github/coworkany

## Requested Options
- Build desktop: yes
- Real E2E: yes
- Real model smoke: yes
- Doctor required status: degraded
- Canary evidence path: /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/canary-evidence.json
- Require canary evidence: no

## Stages
- [PASSED] Control-plane eval suite (2796ms)
- [PASSED] Sidecar typecheck (1960ms)
- [PASSED] Sidecar stable regression suite (141ms)
- [PASSED] Sidecar release gate tests (7978ms)
- [PASSED] Desktop typecheck (3309ms)
- [PASSED] Desktop acceptance suite (single-path compatible) (91ms)
- [PASSED] Desktop production build (6382ms)
- [PASSED] Desktop real E2E acceptance + fault injection (52083ms)
- [PASSED] Sidecar real model provider preflight (1ms)
  - source=llm-config | provider=openai | model=gpt-5.3-codex | requiredKey=OPENAI_API_KEY | keyPresent=yes | Provider openai has required API key available.
- [PASSED] Sidecar real model proxy preflight (394ms)
  - source=llm-config | proxy=http://127.0.0.1:7890 | checked=127.0.0.1:7890 | latency=3ms | connect=passed | connectTarget=aiberm.com:443 | connectLatency=1ms | tls=passed | tlsLatency=386ms | Proxy endpoint TCP reachability check passed.; HTTP CONNECT tunnel probe passed.; TLS handshake through proxy passed.
- [PASSED] Sidecar real model smoke (10836ms)
- [PASSED] Sidecar doctor preflight (1ms)
- [PASSED] Workspace extension allowlist gate (0ms)
  - No enabled third-party extensions detected. (mode=off, enabledSkills=0, enabledToolpacks=0)
- [PASSED] Canary checklist evidence gate (0ms)
  - required=no, completedAreas=0, missingAreas=4

## Control-Plane Eval
- Cases: 40/40 passed
- Runtime replay pass rate: 100.0%
- Threshold source: /Users/beihuang/Documents/github/coworkany/sidecar/evals/control-plane/readiness-thresholds.json
- Threshold profile: beta
- Production replay coverage (canary): 1/1 passed, runtimeReplay 1/1

## Sidecar Doctor
- Overall status: degraded
- Required overall status: degraded

## Real-Model Gate Diagnosis
- Provider preflight status: passed
- Provider source: llm-config
- Provider: openai
- Model: gpt-5.3-codex
- Required key: OPENAI_API_KEY
- Key present: yes
- Provider finding: Provider openai has required API key available.
- Proxy preflight status: passed
- Proxy source: llm-config
- Proxy URL: http://127.0.0.1:7890
- Proxy checked address: 127.0.0.1:7890
- Proxy latency: 3ms
- Proxy CONNECT status: passed
- Proxy CONNECT target: aiberm.com:443
- Proxy CONNECT target source: llm-config
- Proxy CONNECT latency: 1ms
- Proxy TLS status: passed
- Proxy TLS latency: 386ms
- Preflight finding: Proxy endpoint TCP reachability check passed.
- Preflight finding: HTTP CONNECT tunnel probe passed.
- Preflight finding: TLS handshake through proxy passed.

## Canary Checklist
- Completed areas: 0
- Missing areas: 4

## Observability
- No appDataDir provided; startup metrics inspection skipped.
- Artifact telemetry file not found.

