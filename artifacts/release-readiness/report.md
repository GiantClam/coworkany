# Release Readiness Report

Generated at: 2026-04-07T01:47:15.212Z
Repository: /Users/beihuang/Documents/github/coworkany

## Requested Options
- Build desktop: yes
- Real E2E: yes
- Real model smoke: yes
- Doctor required status: degraded
- Canary evidence path: /Users/beihuang/Documents/github/coworkany/artifacts/release-readiness/canary-evidence.json
- Require canary evidence: no

## Stages
- [PASSED] Control-plane eval suite (3386ms)
- [PASSED] Sidecar typecheck (2299ms)
- [PASSED] Sidecar stable regression suite (139ms)
- [PASSED] Sidecar release gate tests (19310ms)
- [PASSED] Desktop typecheck (3526ms)
- [PASSED] Desktop acceptance suite (single-path compatible) (846ms)
- [PASSED] Desktop production build (6695ms)
- [PASSED] Desktop real E2E acceptance + fault injection (40554ms)
- [PASSED] Sidecar real model provider preflight (19ms)
  - source=llm-config | provider=openai | model=gpt-5.3-codex | requiredKey=OPENAI_API_KEY | keyPresent=yes | Provider openai has required API key available.
- [PASSED] Sidecar real model proxy preflight (455ms)
  - source=llm-config | proxy=http://127.0.0.1:7890 | checked=127.0.0.1:7890 | latency=13ms | connect=passed | connectTarget=aiberm.com:443 | connectLatency=4ms | tls=passed | tlsLatency=426ms | Proxy endpoint TCP reachability check passed.; HTTP CONNECT tunnel probe passed.; TLS handshake through proxy passed.
- [PASSED] Sidecar real model smoke (21436ms)
- [PASSED] Sidecar doctor preflight (1ms)
- [PASSED] Workspace extension allowlist gate (0ms)
  - No enabled third-party extensions detected. (mode=off, enabledSkills=0, enabledToolpacks=0)
- [PASSED] Canary checklist evidence gate (0ms)
  - required=no, completedAreas=0, missingAreas=4

## Control-Plane Eval
- Cases: 86/86 passed
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
- Proxy latency: 13ms
- Proxy CONNECT status: passed
- Proxy CONNECT target: aiberm.com:443
- Proxy CONNECT target source: llm-config
- Proxy CONNECT latency: 4ms
- Proxy TLS status: passed
- Proxy TLS latency: 426ms
- Preflight finding: Proxy endpoint TCP reachability check passed.
- Preflight finding: HTTP CONNECT tunnel probe passed.
- Preflight finding: TLS handshake through proxy passed.

## Canary Checklist
- Completed areas: 0
- Missing areas: 4

## Observability
- No appDataDir provided; startup metrics inspection skipped.
- Artifact telemetry file not found.
- OTEL sampling enabled but no OTLP endpoint configured (set COWORKANY_OTEL_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT).

