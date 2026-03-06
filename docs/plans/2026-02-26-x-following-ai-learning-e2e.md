# X Following AI Learning E2E Implementation Plan

**Goal:** Add and execute an end-to-end CoworkAny test that verifies it can complete the X AI-post extraction task, including automatic skill/tool learning when an intentionally disabled browser capability creates a gap.
**Architecture:** Introduce a deterministic per-task tool-disable mechanism (used to disable `browser_ai_action` during the test), then add a dedicated sidecar scenario test that drives the full task via GUI/browser tools, verifies self-learning evidence (new skill/tool files + tool calls/log evidence), and generates terminal + Markdown outputs. Use iterative fix-and-rerun until assertions pass.
**Tech Stack:** TypeScript, Bun test runner, Sidecar IPC harness, CoworkAny self-learning pipeline, filesystem assertions.

---

### Task 1: Add a deterministic tool-disable hook for tests (TDD)

**Files:**
- Modify: `sidecar/src/main.ts`
- Test: `sidecar/tests/tool-disable-config.test.ts`

**Step 1: Write the failing test**

Create `sidecar/tests/tool-disable-config.test.ts` to assert:
- default tool list includes `browser_ai_action`
- when task config includes `disabledTools: ['browser_ai_action']`, returned tools exclude it
- when multiple tools disabled, all are excluded without breaking other tools

**Step 2: Run test to verify it fails**

Run: `bun test tests/tool-disable-config.test.ts`
Expected: FAIL because `disabledTools` is not yet implemented.

**Step 3: Write minimal implementation**

In `sidecar/src/main.ts`:
- extend task config type to include `disabledTools?: string[]`
- update `getToolsForTask(taskId)` to filter tools by that list (case-sensitive exact name match)
- ensure no behavior change when list is empty/undefined

**Step 4: Run test to verify it passes**

Run: `bun test tests/tool-disable-config.test.ts`
Expected: PASS.

### Task 2: Extend test harness to pass disabledTools in start_task config (TDD)

**Files:**
- Modify: `sidecar/tests/helpers/sidecar-harness.ts`
- Test: `sidecar/tests/tool-disable-config.test.ts`

**Step 1: Write the failing test**

Add assertion in `tool-disable-config.test.ts` that `buildStartTaskCommand(...)` serializes `disabledTools` into `payload.config.disabledTools`.

**Step 2: Run test to verify it fails**

Run: `bun test tests/tool-disable-config.test.ts`
Expected: FAIL because harness builder drops the field.

**Step 3: Write minimal implementation**

In `sidecar/tests/helpers/sidecar-harness.ts`:
- add optional `disabledTools?: string[]` on `buildStartTaskCommand` options
- include it in emitted `payload.config`
- optionally thread this option through `runScenario` helper usage patterns

**Step 4: Run test to verify it passes**

Run: `bun test tests/tool-disable-config.test.ts`
Expected: PASS.

### Task 3: Add dedicated X learning-loop E2E scenario test (TDD)

**Files:**
- Create: `sidecar/tests/x-following-ai-learning-e2e.test.ts`
- Modify: `sidecar/package.json`

**Step 1: Write the failing test**

Create scenario test that:
- starts sidecar task with user query requiring:
  - open Chrome
  - user manual login on X
  - search AI posts from followed people in For You
  - open details and extract only author post text
  - produce 10 latest items
  - output structured response and save Markdown report path
  - if current tools insufficient, auto-learn/create skill+tool and continue
- passes `disabledTools: ['browser_ai_action']`
- asserts evidence:
  - tool call chain includes browser connect/navigate/content extraction calls
  - no `browser_ai_action` calls
  - self-learning tools invoked (`trigger_learning` and/or `find_learned_capability` etc.)
  - `.coworkany/skills` contains newly created or updated skill directory/file
  - agent output includes exactly/at least 10 extracted items
  - Markdown report file exists and is non-empty

Add npm script, e.g. `test:e2e:x-learning`.

**Step 2: Run test to verify it fails**

Run: `bun test tests/x-following-ai-learning-e2e.test.ts`
Expected: FAIL before implementation and reliability refinements.

**Step 3: Write minimal implementation**

Implement scenario in `x-following-ai-learning-e2e.test.ts` using existing harness utilities:
- robust timeout (manual login window)
- artifact capture (`output.txt`, `report.json`, `report.md`, stderr snapshot)
- helper checks for self-learning evidence from events/log text
- markdown report generation in `sidecar/test-results/`

**Step 4: Run test to verify it passes**

Run: `bun test tests/x-following-ai-learning-e2e.test.ts`
Expected: PASS, potentially after iterative fixes below.

### Task 4: Failure diagnosis and iterative repair loop

**Files:**
- Modify as needed: `sidecar/tests/x-following-ai-learning-e2e.test.ts`, `sidecar/src/main.ts`, prompt/config wiring

**Step 1: Run full scenario and capture failure signals**

Run: `bun run test:e2e:x-learning`
Expected: either PASS or concrete failure output with reproducible diagnostics.

**Step 2: Apply minimal targeted fix**

Examples:
- expand timeout/retry windows for login and content loading
- tighten skill-learning evidence detection to avoid false negatives
- adjust user query wording to force deterministic learning path
- ensure disabled tool filtering applies in all task entry paths

**Step 3: Re-run scenario after each fix**

Run: `bun run test:e2e:x-learning`
Expected: eventual PASS with stable assertions.

**Step 4: Confirm report outputs**

Verify:
- terminal includes 10-item summary
- Markdown report exists at `sidecar/test-results/x-following-ai-learning-report.md`
- report includes failure-repair history if retries occurred

### Task 5: Final verification and handoff

**Files:**
- Review generated artifacts under `sidecar/test-results/`

**Step 1: Run focused regression checks**

Run:
- `bun test tests/tool-disable-config.test.ts`
- `bun test tests/x-following-ai-learning-e2e.test.ts`

Expected: both PASS.

**Step 2: Capture concise execution summary for user**

Prepare:
- which files changed
- how tool-disable and auto-learning were verified
- where Markdown report is located
