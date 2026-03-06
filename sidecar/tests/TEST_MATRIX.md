# Sidecar Test Matrix

This directory contains several different classes of tests. They do not all have the same runtime assumptions, so they should not share the same default entrypoint.

## Recommended order

1. `npm run typecheck`
2. `npm test` or `npm run test:stable`
3. Run one explicit higher-level suite only when its prerequisites are satisfied

## Script map

| Command | Scope | Expected stability | Typical prerequisites |
| --- | --- | --- | --- |
| `npm test` | Alias of `test:stable` | High | Bun + local source tree |
| `npm run test:stable` | Deterministic local structural/unit tests | High | None beyond installed deps |
| `npm run test:ci` | CI-safe subset | High | Same as `test:stable` |
| `npm run test:agent:core` | Sidecar-spawn agent flows without browser focus | Medium | Working LLM provider/config |
| `npm run test:agent:scenarios` | Large scenario and OpenClaw comparison suites | Low-Medium | Working LLM provider/config, long runtime budget |
| `npm run test:agent:research` | Search/research/TTS suites | Low-Medium | LLM provider plus search API keys and optional TTS support |
| `npm run test:browser` | Browser automation suites | Low | Browser service, Playwright/Chrome/CDP, possible manual login |
| `npm run test:desktop` | Full desktop GUI launch test | Low | Built desktop binary or GUI-capable environment |
| `npm run test:all` | Every `*.test.ts` file | Very low | Only for deliberate broad sweeps |

## File classification

### Stable local tests

These are the default test surface because they are deterministic and do not depend on external services.

| File | Notes |
| --- | --- |
| `tests/token-usage.test.ts` | Structural/unit validation for token accounting and frontend integration |
| `tests/tool-disable-config.test.ts` | Pure config serialization/filtering checks |
| `tests/command-sandbox.test.ts` | Static command policy coverage |
| `tests/mcp-toolpack.test.ts` | Structural MCP and toolpack checks |
| `tests/rate-limit.test.ts` | Pure retry/backoff behavior |
| `tests/scheduler-heartbeat.test.ts` | Structural scheduler/daemon coverage |

### Agent core integration

These spawn the sidecar and drive task flows. They usually require a valid model provider and can still fail because of provider quotas or missing local config.

| File | Notes |
| --- | --- |
| `tests/llm-core.test.ts` | Basic chat/provider behavior |
| `tests/file-operations.test.ts` | Agent-mediated local file workflows |
| `tests/memory-learning.test.ts` | Memory and self-learning flows |
| `tests/gui-simulation.test.ts` | IPC simulation of desktop to sidecar workflow |

### Agent scenario and comparison suites

These are broader acceptance-style sweeps. They are useful for product validation but too expensive for the default command.

| File | Notes |
| --- | --- |
| `tests/capabilities.test.ts` | Capability checklist spanning many tools |
| `tests/user-scenarios.test.ts` | OpenClaw-style scenario verification |
| `tests/e2e-composite.test.ts` | Multi-tool end-to-end composite scenarios |
| `tests/openclaw-quick.test.ts` | Smaller OpenClaw alignment checks |
| `tests/openclaw-simulation.test.ts` | Simulated OpenClaw user flows |
| `tests/openclaw-extended.test.ts` | Large extended capability sweep |
| `tests/openclow-comparison.test.ts` | Broad feature comparison matrix |

### Research, search, and media suites

These depend more heavily on external services, search providers, or platform features.

| File | Notes |
| --- | --- |
| `tests/websearch.test.ts` | Search providers, fallback, and one E2E summary path |
| `tests/stock-research.test.ts` | Research-heavy E2E |
| `tests/ppt-smart-city.test.ts` | Search plus document-generation workflow |
| `tests/tts-speak.test.ts` | TTS invocation validation |

### Browser-dependent suites

These should only run in environments where browser automation is intentionally configured.

| File | Notes |
| --- | --- |
| `tests/browser-automation.test.ts` | Browser tool E2E and CDP checks |
| `tests/xiaohongshu-posting.test.ts` | Browser login/posting flow |
| `tests/x-following-ai-learning-e2e.test.ts` | Long-running browser learning scenario |
| `tests/e2e-browser-smart.ts` | Direct browser service E2E script |

### Desktop/manual validation

| File | Notes |
| --- | --- |
| `tests/desktop-full.test.ts` | Full desktop GUI launch; not suitable for headless default runs |
| `tests/GUI_TESTS_GUIDE.md` | Manual validation checklist |

## Prerequisite notes

### LLM-backed suites

Expect a working provider configuration for the sidecar. Without it, many tests degrade into provider or quota failures that do not indicate local regressions.

### Search-backed suites

Some tests explicitly look for provider keys such as `SERPER_API_KEY`, `TAVILY_API_KEY`, or `BRAVE_API_KEY`.

### Browser-backed suites

Expect some combination of:

- a running browser automation backend
- Playwright/Chromium availability
- Chrome with a CDP port when CDP reuse is under test
- manual login for sites like X or Xiaohongshu

### Desktop suite

`tests/desktop-full.test.ts` expects a GUI-capable environment and should be treated as an explicit smoke/investigation test, not a default regression gate.
