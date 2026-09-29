# Conversation Tool and Token Statistics Design

Date: 2026-09-29

## Summary

Add two related desktop features:

1. Show tool-call and token statistics for every assistant turn.
2. Add a global usage page that summarizes models, tool calls, capability executions, tokens, and reported cost.

The design uses normalized invocation and usage records as the source of truth. The conversation UI presents a compact per-turn summary, while `/dashboard/usage` provides 7-day, 30-day, and all-time analysis. Dify and server-side billing are out of scope.

## Goals

- Make each assistant turn auditable without interrupting conversation reading.
- Distinguish model-initiated tool calls from workflow and capability executions.
- Report only token values supplied by the Provider or runtime.
- Preserve partial statistics for failed, cancelled, and interrupted runs.
- Keep live values, restored conversation history, task evidence, and global statistics consistent.
- Support AI, Agent, Writer/PPT, workflow, media, and PPT capability runs in the desktop application.

## Non-goals

- Dify integration.
- Billing, invoices, credit balances, or quota enforcement.
- Estimating missing token counts.
- CSV export, budget alerts, forecasting, or editable model price tables in the first release.
- Backfilling tool counts from legacy free-form event payloads.

## Product Decisions

### Invocation categories

Statistics expose two independent categories:

- `model_tool`: a tool call initiated by the model, including local file tools, shell tools, search, Skills, and MCP tools.
- `capability`: an actual workflow node, media action, PPT engine, or other capability execution.

A model tool call is counted once per stable `toolCallId`. Its started, completed, failed, blocked, and rejected events are state transitions for the same invocation.

A capability execution is counted by actual attempt. The identity is derived from `runId`, `nodeKey` or capability key, and an attempt or idempotency key. A real retry therefore counts as another execution, while repeated lifecycle events for the same attempt do not.

Failed and rejected invocations remain part of the total. The UI also exposes status breakdowns so totals are not mistaken for successful executions.

### Token and cost semantics

- Input and output tokens are recorded when supplied by the Provider or runtime.
- Cached input and reasoning tokens are recorded only when supplied.
- Missing fields remain unknown and render as `—` or “Not provided”; they are never converted to zero for a per-run detail.
- Provider-reported cost and locally estimated cost remain separate fields and are never summed together.
- Invalid negative, non-finite, or malformed values are rejected and produce a diagnostic warning.

Usage events must declare aggregation semantics:

- `delta`: add the event to the run total. OpenCode `step-finish` usage uses this mode.
- `snapshot`: treat the event as a cumulative value and use the latest snapshot for its scope.

Usage events also declare a scope:

- `step`: usage belongs to one model step.
- `run`: usage describes the whole run.

This prevents double counting when a Provider emits a cumulative run snapshot after individual step deltas.

### Time range

The global page defaults to the previous 30 days and provides 7-day, 30-day, and all-time ranges. Stored timestamps are UTC; grouping and labels use the user's desktop time zone.

## UX Design

### Per-turn compact statistics

The assistant message displays a compact statistics row after its text, artifacts, and previews and before message actions:

```text
GPT-5.6 Sol  ·  Tools 4  ·  Capabilities 1  ·  12.8K tokens  ⌄
```

The row follows these rules:

- Values update during execution with a subtle loading state.
- The completed run replaces live values with the persisted aggregate.
- The entire row is keyboard and pointer actionable.
- Enter, Space, or click expands details.
- No row is rendered when no trustworthy metric is available.
- Unknown values are omitted from the compact row and shown as “Not provided” in details.

Expanded content shows:

- Provider and model.
- Model tool totals grouped by status and tool name.
- Capability totals grouped by status and capability name.
- Input, output, cached input, and reasoning tokens.
- Provider-reported cost and estimated cost as separately labeled values.
- A “View usage details” action that opens `/dashboard/usage` filtered to the current `runId`.

The shared implementation composes the existing AI Elements `Context` component for token details with a new `RunMetrics` component for model, tool, and capability statistics. Route-specific message surfaces must not implement their own statistics UI.

### Global usage page

Add `/dashboard/usage` under the sidebar's Resources section with the localized label “用量统计” / “Usage”.

The approved layout is overview first, followed by trends, distributions, and a detailed ledger.

#### Filters

- Date range: 7 days, 30 days, all time.
- Model.
- Provider.
- Source: conversation, Agent, workflow, media, or PPT.
- Agent or conversation search.
- Optional `runId` supplied by a per-turn deep link.

#### Overview metrics

- Total tokens.
- Model tool calls.
- Workflow/capability executions.
- Provider-reported cost.

For 7-day and 30-day ranges, cards may show comparison with the immediately preceding equal-length period. All-time mode does not show a period comparison.

#### Trends

- Input/output token stacked trend.
- Model-tool/capability invocation trend.
- A date bucket with no records may render as zero. A missing field inside an existing record remains unknown and must not silently become zero.

#### Distributions

- Model table: run count, tokens, tool calls, capabilities, and reported cost.
- Tool ranking: tool name, invocation count, and success rate.
- Capability ranking: capability name, execution count, and success rate.

#### Per-run ledger

Columns are time, conversation or task, source, model, model tools, capabilities, tokens, cost, and status.

- Conversation rows navigate to the originating conversation and anchor the associated assistant message.
- Workflow and media rows without a conversation navigate to Task Center evidence.
- Results are paginated and sorted newest first.

## Architecture

### Alternatives considered

1. Derive all statistics by scanning `run_events`. This minimizes schema changes but is slow, couples metrics to historical event shapes, and makes replay deduplication fragile.
2. Store only one summary JSON per run. This makes reads simple but removes auditability and cannot explain retries, failures, or aggregation mistakes.
3. Store normalized invocation and usage records and derive run/query summaries. This adds a small schema and query layer but provides accurate, testable, and extensible statistics.

Use option 3.

### Data flow

```text
Runtime / Provider events
        ↓
Statistics normalizer
        ↓
Invocation accumulator + usage accumulator
        ↓
SQLite normalized records
        ↓
Run metrics query service
        ├─ Live and restored assistant-turn statistics
        ├─ Global usage page
        └─ Task Center evidence
```

### Invocation records

Add a `run_invocations` table with these logical fields:

| Field | Purpose |
| --- | --- |
| `id` | Local row identity |
| `run_id` | Owning run |
| `invocation_id` | Stable runtime or synthesized invocation identity |
| `category` | `model_tool` or `capability` |
| `name` | Tool or capability display key |
| `status` | `running`, `completed`, `failed`, or `rejected` |
| `attempt` | Actual attempt number, default `1` |
| `started_at` | First observed start time |
| `finished_at` | Terminal time when available |
| `created_at` / `updated_at` | Persistence timestamps |

The unique key is `(run_id, category, invocation_id, attempt)`.

The merge policy is monotonic: a terminal state cannot be overwritten by a delayed running event. Repeated terminal events update only missing metadata and do not create another invocation.

The table must not store tool arguments, tool output, prompts, API keys, file contents, or other sensitive payloads.

### Usage records

Extend the existing `usage_records` table with:

- `usage_id` for idempotent replay handling.
- `reasoning_tokens`.
- `cached_input_tokens`.
- `aggregation`: `delta` or `snapshot`.
- `scope`: `step` or `run`.
- Optional source step identity when supplied by the runtime.

The unique usage identity is scoped to a run. Existing `idempotency_key` remains accepted during migration and maps to `usage_id` when available.

### Query projection

`RunMetrics` is a query projection, not a second source of truth. It contains:

- Run, conversation, source, Provider, and model identity.
- Tool and capability totals plus status breakdowns.
- Grouped counts by tool/capability name.
- Input, output, cached input, and reasoning token totals.
- Provider and estimated cost.
- `complete | partial | unavailable` data completeness.

Add these client boundaries:

```ts
metrics.getRun(runId): Promise<RunMetrics>
metrics.query(filters): Promise<MetricsQueryResult>
```

`metrics.query` returns overview totals, prior-period comparison, time-series buckets, model/tool/capability breakdowns, and one page of run rows. UI code does not parse raw event JSON.

### Message integration

During a live run, an in-memory accumulator updates the assistant's typed metrics projection from normalized events. On terminal status and history restoration, the SQLite aggregate becomes authoritative.

An assistant message retains its `runId` and persists a lightweight typed `data-runMetrics` display snapshot to prevent layout flicker. The snapshot is a cache: history loading requests `metrics.getRun(runId)` and replaces the snapshot when the authoritative result is available.

The existing `data-usage` rendering remains compatible. The final shared message component combines all usage rows for the run instead of assuming that the last usage event is the whole run total.

## Runtime Event Contract

Normalize runtime events to two stable metric inputs:

```ts
type InvocationMetricEvent = {
  runId: string;
  invocationId: string;
  category: "model_tool" | "capability";
  name: string;
  phase: "started" | "completed" | "failed" | "rejected";
  attempt: number;
  createdAt: string;
};

type UsageMetricEvent = {
  runId: string;
  usageId: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  providerCost?: number;
  estimatedCost?: number;
  aggregation: "delta" | "snapshot";
  scope: "step" | "run";
  createdAt: string;
};
```

Existing OpenCode `tool_call` events map to `model_tool`. Workflow node attempts, media executions, and PPT engine executions map to `capability`. A lifecycle event is normalized once before it reaches message rendering or storage.

## Failure Handling

- Event replay is idempotent through stable invocation and usage identities.
- Out-of-order invocation events use monotonic status merging.
- Failed, cancelled, or interrupted runs retain partial metrics and expose `partial` completeness.
- A statistics query failure never prevents the conversation message from rendering or the Agent from running.
- The per-turn row may show “Statistics unavailable” while preserving the assistant response.
- Unknown Provider/model identity falls back to the model locked at run launch, then to “Unknown model”.
- Aggregation rejects invalid numeric values and emits a diagnostic warning without failing the run.
- Queries aggregate in SQLite and paginate run rows to avoid loading full history into the renderer.

## Migration

- Create `run_invocations` and its unique and query indexes.
- Add usage columns and indexes for timestamp, model, Provider, and run identity.
- Mark legacy usage records as partial.
- Preserve existing input, output, and cost data exactly.
- Do not infer legacy tool or capability counts from unversioned JSON event payloads.
- Keep Task Center as the per-run execution evidence surface; the new page owns cross-run analytics.

## Verification

### Unit tests

- Normalize model tools, capability attempts, usage deltas, and usage snapshots.
- Deduplicate lifecycle transitions and replayed events.
- Count real retries as separate attempts.
- Preserve terminal states when events arrive out of order.
- Aggregate input, output, cached input, reasoning, reported cost, and estimated cost correctly.
- Keep unknown fields unknown.

### Storage and query tests

- Upgrade legacy databases without losing usage data.
- Enforce invocation and usage idempotency.
- Query 7-day, 30-day, all-time, model, Provider, source, conversation, and run filters.
- Validate local-time date bucketing around time-zone boundaries.
- Paginate and sort run rows.

### Protocol and UI tests

- Verify Runtime → Workbench Client → typed message event mapping.
- Render live, completed, partial, failed, and unavailable per-turn statistics.
- Verify keyboard expansion and localized labels.
- Verify deep links to a conversation message or Task Center evidence.
- Verify the global page overview, trends, distributions, filters, empty states, and pagination.

### Integration and regression tests

- Run a conversation with multiple model steps and tool calls; verify no double counting.
- Reload the conversation and compare restored values with live values.
- Compare the per-turn summary, Task Center evidence, and global usage page for the same run.
- Cover AI, Agent, Writer/PPT, workflow, media, and PPT engine entry points.

Manual acceptance is limited to visual density, chart readability, message anchoring, and comparison against a real Provider's reported values.

## Delivery Sequence

1. Add metric contracts, runtime normalization, database migration, aggregation, and query APIs.
2. Add the shared compact per-turn statistics component and history restoration.
3. Add `/dashboard/usage` with overview, trends, distributions, filters, and run ledger.
4. Run cross-entry automated regression and performance verification, then complete the remaining visual and real-Provider manual checks.

## Acceptance Criteria

- Every supported assistant turn with trustworthy metrics shows one compact statistics row.
- Started and completed events for one tool call count once.
- A true capability retry counts as another execution.
- Multiple OpenCode step usage events aggregate without losing earlier steps.
- A run-level snapshot is not added on top of equivalent step deltas.
- Missing token categories display as unavailable rather than zero.
- Live, restored, Task Center, and global totals agree for the same run.
- The usage page defaults to 30 days and supports 7 days and all time.
- Statistics failures do not block conversations, workflows, or media execution.
- No sensitive tool input, output, or credentials are added to metric storage.
