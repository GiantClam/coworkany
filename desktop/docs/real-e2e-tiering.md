# Desktop Real E2E Tiering

This document defines the real-chain desktop E2E tiers used to control runtime cost while keeping end-to-end coverage.

## Tier 1 (`@critical`, PR gate)

Run on every PR. Focused on the shortest critical chains:

- sidecar spawn reuse
- message protocol rendering
- failure surfacing + retry continuity
- approval invoke wiring

Command:

```bash
npm run test:e2e:tier1
```

## Tier 2 (regression depth)

Run on branch/nightly when deeper UI/state regressions need coverage:

- assistant thinking -> response transition
- follow-up final-result rendering
- assistant-ui visual snapshots
- shell authorization regression
- markdown compact layout regression (list markers + paragraph rhythm)

Command:

```bash
npm run test:e2e:tier2
```

## Tier 3 (release and long scenarios)

Run for release candidates and periodic broad sweeps:

- clean-machine onboarding full chain
- database failure recovery
- interrupted task resume
- mac shell smoke
- stock-research + browser concurrent scenarios

Command:

```bash
npm run test:e2e:tier3
```

## Input Unlock Contract

Critical full-chain suites enforce a shared contract:

- when active task reaches terminal (`finished`, `failed`, `cancelled`, `idle`)
- chat input must become editable again (not disabled, not readonly)

Shared helper:

- `tests/utils/chatInputAssertions.ts`
