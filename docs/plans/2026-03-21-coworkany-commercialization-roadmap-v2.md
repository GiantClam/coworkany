# Coworkany Commercialization Roadmap v2

**Goal:** Turn the current deep-research control plane from a strong beta candidate into a commercially credible product by closing the highest-value gaps in evaluation, safety, operability, extension governance, and tenant isolation.

**Scope:** This roadmap builds on the already implemented control-plane loop:

- `goal framing`
- `deep research`
- `uncertainty resolution`
- `contract freeze`
- `execution with re-planning`

It does **not** replace that architecture. It adds the missing production layers around it.

---

## Current Position

Coworkany is now ahead of many agent products in one important respect: the core loop is already contract-centric rather than prompt-centric.

That is a strong foundation.

What is still missing for commercial quality is not “more agent magic”. The missing layers are:

- measurable control-plane quality
- explicit safety defaults
- extension and connector governance
- tenant/session isolation
- operability and incident handling
- trustworthy user-visible change control

Compared with:

- general official best practices from OpenAI / Anthropic / LangGraph
- OpenClaw’s local-first gateway, onboarding, safety checks, and channel governance
- nanobot’s minimal runtime discipline, deny-by-default posture, and MCP/tool restriction model

the main gaps fall into 7 workstreams.

---

## Workstream 1: Eval-Driven Control Plane

### Why it matters

The current test suite is strong on engineering regressions, but still weak on product-quality measurement. Commercial systems need to know whether they are:

- asking too many questions
- freezing the wrong contract
- choosing weak strategies
- reopening too late or too often
- hallucinating evidence or skipping available context

### Required additions

- A formal control-plane eval harness
- Gold datasets for:
  - framing quality
  - minimal-blocking clarification
  - strategy selection
  - contract correctness
  - reopen correctness
  - artifact satisfaction
- Production log replay into offline evals
- Judge metrics separated by stage, not a single “task passed” score

### Deliverables

- `sidecar/src/evals/controlPlaneEvalRunner.ts`
- `sidecar/evals/control-plane/*.jsonl`
- dashboard for:
  - clarification rate
  - unnecessary clarification rate
  - reopen rate
  - refreeze success rate
  - contract-to-artifact success rate

### Release gate

- top 20 recurring tasks have eval coverage
- unnecessary clarification rate stays below agreed threshold
- reopen reasons are classifiable and stable across releases

---

## Workstream 2: Risk-Tiered Human-in-the-Loop

### Why it matters

Current collaboration is mostly “block and ask”. That is necessary, but not enough.

Commercial systems need several levels of human control:

- approve
- reject
- edit and continue
- answer one blocking question
- accept degraded result

### Required additions

- Risk-tier taxonomy on checkpoints and actions
- Review-mode actions instead of only blocking actions
- Editable contract fields in desktop:
  - deliverables
  - strategy
  - defaults
  - blocked assumptions
- Explicit “accept degraded output” path

### Deliverables

- richer `userActionsRequired` schema with `riskTier`
- desktop contract-review UI
- execution policy mapping:
  - `auto`
  - `review_required`
  - `hard_block`

### Release gate

- all write/delete/external-side-effect actions map to a review policy
- user can modify a replanned contract without restarting the whole task

---

## Workstream 3: Safe-by-Default Runtime and Connector Isolation

### Why it matters

OpenClaw and nanobot both lean much harder into safe defaults than most agent products do.

Coworkany needs the same production posture:

- deny by default
- explicit allowlists
- minimal tool exposure
- isolated untrusted input

### Required additions

- Connector and tool exposure allowlists per task
- Default read-only mode for external connectors
- Stronger separation between:
  - raw web/app/browser content
  - normalized evidence
  - planner/executor prompt input
- Policy-driven tool surface by contract phase

### Deliverables

- task-scoped tool capability filter
- structured evidence ingestion layer
- prompt-sanitized evidence summaries
- connector permission descriptors

### Release gate

- no raw external content enters core prompts without normalization
- every task freeze records the exact tool set exposed to execution

---

## Workstream 4: Extension and Supply-Chain Governance

### Why it matters

OpenClaw and nanobot both treat skills/MCP/extensions as first-class product surfaces. That means the product is only as safe as its extension model.

Coworkany currently has install and execution support, but still lacks full governance.

### Required additions

- Skill provenance and publisher identity
- Permission manifests for skills and MCP servers
- First-install quarantine / review
- Update diff review for capability expansion
- Signed or trusted-source install modes

### Deliverables

- `skill trust policy`
- `connector trust policy`
- install-time risk summary
- update-time permission delta summary
- optional workspace-level extension allowlist

### Release gate

- no new extension gains broad permissions silently
- user can see why a skill/tool is trusted and what it can access

---

## Workstream 5: Session, Memory, and Tenant Isolation

### Why it matters

The more Coworkany succeeds at reopen, resume, and follow-up continuity, the higher the risk of context pollution.

nanobot’s minimal runtime discipline is a useful reminder here: keep memory boundaries explicit.

### Required additions

- Memory class separation:
  - task memory
  - workspace memory
  - user preference memory
  - global system memory
- Superseded-contract tombstones
- Context compaction and stale-evidence eviction
- Per-workspace and per-user isolation policy
- Session poisoning detection

### Deliverables

- memory retention rules
- compaction pipeline
- evidence supersession markers
- tenant-safe runtime/session boundaries

### Release gate

- follow-up continuity works without stale evidence dominating current execution
- one workspace/user cannot leak action state or memory into another

---

## Workstream 6: Operability, Doctor, and Incident Recovery

### Why it matters

OpenClaw’s `doctor` is a good product lesson: production systems need self-diagnosis, not just logs.

Coworkany now has strong runtime persistence and restart recovery, but still needs operator-grade health tooling.

### Required additions

- `doctor/preflight` command
- runtime store integrity checks
- connector health checks
- research adapter health and latency checks
- stuck-task detector
- reopen loop anomaly detector
- incident replay tooling

### Deliverables

- `sidecar doctor`
- health report schema
- replay tool for failed tasks
- anomaly alerts for:
  - repeated reopen
  - repeated clarification
  - repeated degraded outputs

### Release gate

- one command can explain whether the environment is safe to run
- top failure classes can be replayed locally from saved runtime state

---

## Workstream 7: User-Visible Contract Diff and Governance UX

### Why it matters

The better Coworkany gets at replanning, the more important it is that users can tell what changed.

Without that, contract reopening feels random even if it is technically correct.

### Required additions

- explicit contract diff on reopen:
  - deliverables added/removed/changed
  - strategy changed
  - blocker changed
  - risk changed
  - tool scope changed
- visible evidence reasons for the change
- “why this strategy” panel
- resume/reopen audit trail

### Deliverables

- desktop contract diff card
- timeline annotations for refreeze causes
- research-evidence summary panel

### Release gate

- every reopen visible in UI has a readable before/after explanation
- users can tell whether the system changed scope, target, strategy, or only execution details

---

## Priority Plan

### P0: Must Have Before Commercial Claims

- Workstream 1: Eval-driven control plane
- Workstream 2: Risk-tiered HITL
- Workstream 3: Safe-by-default runtime and connector isolation
- Workstream 6: Operability / doctor / incident recovery

### P1: Needed for Sustainable Product Scale

- Workstream 4: Extension and supply-chain governance
- Workstream 5: Session, memory, and tenant isolation
- Workstream 7: User-visible contract diff and governance UX

### P2: Useful After the Above

- more advanced model routing by phase
- automatic evidence confidence calibration
- canary / shadow planning against prior planner versions

---

## Specific Comparison Additions vs OpenClaw

OpenClaw suggests Coworkany should additionally strengthen:

- onboarding and safety preflight
- channel/account/source governance
- per-agent isolation
- extension lifecycle controls
- operator-facing “doctor” posture

Coworkany is already stronger in contract-centric replanning. OpenClaw is currently stronger in operational surface hardening.

---

## Specific Comparison Additions vs nanobot

nanobot suggests Coworkany should additionally strengthen:

- deny-by-default source policy
- restricted tool registration per task
- workspace confinement as a hard default
- minimal runtime assumptions
- cleaner session-history and anti-poisoning discipline

Coworkany is already stronger in planning and governed collaboration. nanobot is currently stronger in minimalism and runtime surface discipline.

---

## Recommended Execution Order

1. Build control-plane eval harness and production replay
2. Add risk-tiered HITL and editable contract review
3. Add tool/connector isolation and untrusted-content normalization
4. Add doctor/preflight and replay diagnostics
5. Add extension governance
6. Add memory/tenant isolation hardening
7. Add desktop contract diff UX

This order gives the fastest path to a credible small commercial pilot:

- first make quality measurable
- then make risky actions governable
- then make runtime safer
- then make failures operable

---

## Commercial Readiness Definition

Coworkany should only be described as commercially ready when all of the following are true:

- control-plane quality is measured continuously, not inferred from anecdotes
- risky execution paths have explicit review policies
- external evidence is normalized before influencing execution
- extensions and connectors have trust and permission governance
- cross-task and cross-workspace context pollution is bounded
- restart, reopen, and incident flows are diagnosable by operators
- users can understand why a contract changed

Until then, the right label is:

`strong beta candidate with a production-worthy orchestration core, but still missing full commercial guardrails and operations maturity`
