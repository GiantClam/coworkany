# 对话工具调用与 Token 统计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在桌面端每轮助手消息中展示模型工具、能力执行和真实 Token 统计，并新增可筛选、可下钻的全局用量统计页。

**架构：** Runtime 先把工具、能力和用量事件归一化为稳定契约；SQLite 使用标准化 invocation/usage 明细作为事实来源；Workbench Client 暴露运行聚合与全局查询；共享 AI Elements 消息表面消费 `data-runMetrics`；桌面端独立 `UsageDashboard` 页面展示概览、趋势、分布和明细。

**技术栈：** TypeScript 5.8、React 19、AI SDK UIMessage、AI Elements、Tauri 2、Rust、rusqlite、Node test runner、Cargo test。

## 全局约束

- 桌面端实现，不接入 Dify。
- 模型工具与工作流/能力执行分开统计。
- 同一个 `toolCallId` 的生命周期事件只计一次；能力真实重试按 attempt 分别计数。
- Token 仅采用 Provider/运行时真实返回值；缺失字段保持未知，不本地估算。
- Provider 返回成本与本地估算成本分开存储和展示。
- 统计表不保存工具参数、工具输出、Prompt、凭据或文件内容。
- 不新增第三方依赖。
- 所有新 UI 提供中英文文案、键盘操作与空状态。
- 旧历史记录保留原值并标记为 partial，不反推旧工具调用次数。

---

### 任务 1：共享统计类型与纯聚合器

**文件：**
- 新建：`packages/workbench-client/src/run-metrics.ts`
- 修改：`packages/workbench-client/src/index.ts`
- 测试：`packages/workbench-client/test/run-metrics.test.ts`

**接口：**
- 产出：`InvocationMetricEvent`、`UsageMetricEvent`、`RunMetrics`、`MetricsQueryFilters`、`MetricsQueryResult`。
- 产出：`createRunMetricsAccumulator(runId)`、`applyRunMetricsEvent(state, event)`、`toRunMetrics(state)`。
- 扩展：`WorkbenchUsage` 增加 `usageId`、`cachedInputTokens`、`reasoningTokens`、`aggregation` 和 `scope`，旧调用方通过可选字段保持兼容。
- 后续任务只通过这些类型和函数汇总统计，不自行扫描 UI 文本。

- [ ] **步骤 1：编写失败的聚合测试**

```ts
test("deduplicates tool lifecycle events and keeps real capability retries", () => {
  let state = createRunMetricsAccumulator("run-1");
  state = applyRunMetricsEvent(state, { kind: "invocation", runId: "run-1", invocationId: "tool-1", category: "model_tool", name: "read", phase: "started", attempt: 1, createdAt: "2026-09-29T00:00:00Z" });
  state = applyRunMetricsEvent(state, { kind: "invocation", runId: "run-1", invocationId: "tool-1", category: "model_tool", name: "read", phase: "completed", attempt: 1, createdAt: "2026-09-29T00:00:01Z" });
  state = applyRunMetricsEvent(state, { kind: "invocation", runId: "run-1", invocationId: "image", category: "capability", name: "image_generate", phase: "failed", attempt: 1, createdAt: "2026-09-29T00:00:02Z" });
  state = applyRunMetricsEvent(state, { kind: "invocation", runId: "run-1", invocationId: "image", category: "capability", name: "image_generate", phase: "completed", attempt: 2, createdAt: "2026-09-29T00:00:03Z" });
  const metrics = toRunMetrics(state);
  assert.equal(metrics.modelTools.total, 1);
  assert.equal(metrics.modelTools.completed, 1);
  assert.equal(metrics.capabilities.total, 2);
});

test("adds step deltas but does not add a run snapshot twice", () => {
  let state = createRunMetricsAccumulator("run-1");
  state = applyRunMetricsEvent(state, { kind: "usage", runId: "run-1", usageId: "step-1", model: "model-a", inputTokens: 10, outputTokens: 4, aggregation: "delta", scope: "step", createdAt: "2026-09-29T00:00:00Z" });
  state = applyRunMetricsEvent(state, { kind: "usage", runId: "run-1", usageId: "step-2", model: "model-a", inputTokens: 8, outputTokens: 3, aggregation: "delta", scope: "step", createdAt: "2026-09-29T00:00:01Z" });
  state = applyRunMetricsEvent(state, { kind: "usage", runId: "run-1", usageId: "run-final", model: "model-a", inputTokens: 18, outputTokens: 7, aggregation: "snapshot", scope: "run", createdAt: "2026-09-29T00:00:02Z" });
  assert.deepEqual(toRunMetrics(state).tokens, { input: 18, output: 7 });
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`pnpm --filter @coworkany/workbench-client exec tsx --test test/run-metrics.test.ts`

预期：因 `../src/run-metrics` 不存在而失败。

- [ ] **步骤 3：实现稳定类型与纯聚合器**

`run-metrics.ts` 必须定义以下核心形状：

```ts
export type InvocationCategory = "model_tool" | "capability";
export type InvocationPhase = "started" | "completed" | "failed" | "rejected";
export type InvocationMetricEvent = { kind: "invocation"; runId: string; invocationId: string; category: InvocationCategory; name: string; phase: InvocationPhase; attempt: number; createdAt: string };
export type UsageMetricEvent = { kind: "usage"; runId: string; usageId: string; provider?: string; model?: string; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number; providerCost?: number; estimatedCost?: number; aggregation: "delta" | "snapshot"; scope: "step" | "run"; createdAt: string };
export type MetricEvent = InvocationMetricEvent | UsageMetricEvent;
export type RunMetricCount = { total: number; completed: number; failed: number; rejected: number; running: number; byName: readonly { name: string; total: number; completed: number; failed: number; rejected: number; running: number }[] };
export type RunMetrics = { runId: string; provider?: string; model?: string; modelTools: RunMetricCount; capabilities: RunMetricCount; tokens: { input?: number; output?: number; cachedInput?: number; reasoning?: number }; providerCost?: number; estimatedCost?: number; completeness: "complete" | "partial" | "unavailable" };
export type MetricsRange = "7d" | "30d" | "all";
export type RunMetricSource = "conversation" | "agent" | "workflow" | "media" | "ppt";
export type MetricsQueryFilters = { range: MetricsRange; model?: string; provider?: string; source?: RunMetricSource; query?: string; runId?: string; cursor?: string; limit?: number };
export type MetricsSeriesBucket = { date: string; inputTokens: number; outputTokens: number; modelTools: number; capabilities: number };
export type MetricsBreakdownRow = { name: string; runs: number; invocations: number; completed: number; failed: number; tokens?: number; providerCost?: number };
export type MetricsRunRow = { runId: string; conversationId?: string; messageId?: string; title: string; source: RunMetricSource; provider?: string; model?: string; status: string; startedAt: string; metrics: RunMetrics };
export type MetricsQueryResult = { overview: { tokens: number; modelTools: number; capabilities: number; providerCost?: number; previous?: { tokens: number; modelTools: number; capabilities: number; providerCost?: number } }; series: readonly MetricsSeriesBucket[]; models: readonly MetricsBreakdownRow[]; tools: readonly MetricsBreakdownRow[]; capabilities: readonly MetricsBreakdownRow[]; runs: readonly MetricsRunRow[]; nextCursor?: string };
```

聚合器使用 `(category, invocationId, attempt)` 和 `usageId` Map 去重，终态不得被 `started` 覆盖；存在 run snapshot 时 Token/成本采用最新 run snapshot，否则累加 step delta。

- [ ] **步骤 4：运行共享客户端测试**

运行：`pnpm --filter @coworkany/workbench-client test && pnpm --filter @coworkany/workbench-client typecheck`

预期：全部通过。

- [ ] **步骤 5：提交任务 1**

```bash
git add packages/workbench-client/src/run-metrics.ts packages/workbench-client/src/index.ts packages/workbench-client/test/run-metrics.test.ts
git commit -m "Make run metrics deterministic across event replay"
```

---

### 任务 2：扩展 OpenCode 用量事件契约

**文件：**
- 修改：`packages/runtime-contracts/src/opencode.ts`
- 修改：`packages/runtime-contracts/src/index.ts`
- 测试：`packages/runtime-contracts/test/opencode.test.ts`

**接口：**
- 消费：任务 1 的用量语义，但 runtime-contracts 保持无反向 workspace 依赖。
- 产出：OpenCode `usage` 事件增加 `usageId`、Cache/Reasoning Token、`aggregation: "delta"`、`scope: "step"`。
- 产出：`tool_event.toolCallId` 在可用时稳定保留。

- [ ] **步骤 1：补充失败测试**

```ts
test("normalizes cache and reasoning usage with a stable step identity", () => {
  const result = normalizeOpenCodeServeEvent({ payload: { type: "message.part.updated", properties: { sessionID: "s1", part: { id: "usage-1", messageID: "m1", type: "step-finish", tokens: { input: 11, output: 7, cache: 5, reasoning: 3 }, cost: 0.02 } } } }, "run-1", createOpenCodeServeEventState());
  assert.deepEqual(result.events[0], { event: "usage", usageId: "usage-1", inputTokens: 11, outputTokens: 7, cachedInputTokens: 5, reasoningTokens: 3, costUsd: 0.02, aggregation: "delta", scope: "step", runId: "run-1" });
});
```

- [ ] **步骤 2：运行目标测试并确认失败**

运行：`pnpm --filter @coworkany/runtime-contracts exec tsx --test --test-name-pattern="stable step identity" test/opencode.test.ts`

预期：事件缺少新字段而失败。

- [ ] **步骤 3：扩展解析器**

`OpenCodeRuntimeEvent` 的 `usage` 分支增加：

```ts
readonly usageId: string;
readonly cachedInputTokens?: number;
readonly reasoningTokens?: number;
readonly aggregation: "delta" | "snapshot";
readonly scope: "step" | "run";
```

从 `tokens.cache`、`tokens.cachedInput`、`tokens.cacheRead` 读取 Cache；从 `tokens.reasoning` 读取 Reasoning。`part.id` 缺失时使用消息身份和本地事件身份生成稳定 ID，不得使用随机数。

- [ ] **步骤 4：运行 runtime-contracts 全量验证**

运行：`pnpm --filter @coworkany/runtime-contracts test && pnpm --filter @coworkany/runtime-contracts typecheck`

预期：全部通过。

- [ ] **步骤 5：提交任务 2**

```bash
git add packages/runtime-contracts/src/opencode.ts packages/runtime-contracts/src/index.ts packages/runtime-contracts/test/opencode.test.ts
git commit -m "Preserve provider usage semantics in runtime events"
```

---

### 任务 3：SQLite 调用明细、用量迁移与查询服务

**文件：**
- 修改：`apps/desktop/src-tauri/src/storage.rs`
- 修改：`apps/desktop/src-tauri/src/lib.rs`

**接口：**
- 产出 Tauri 命令：`record_run_invocation`、扩展后的 `record_usage`、`get_run_metrics`、`query_metrics`。
- `get_run_metrics(runId)` 返回任务 1 `RunMetrics` 的 snake_case 原始结构。
- `query_metrics(filters)` 返回 overview、series、models、tools、capabilities、runs、next_cursor。

- [ ] **步骤 1：先写存储迁移和幂等失败测试**

在 `storage.rs` 测试模块加入：

```rust
#[test]
fn run_metrics_deduplicate_lifecycle_events_and_keep_real_retries() {
    let root = std::env::temp_dir().join(format!("coworkany-run-metrics-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let path = root.join("app.db");
    create_run(&path, "run-1", None, Some("model-a")).unwrap();
    record_run_invocation(&path, "run-1", "tool-1", "model_tool", "read", "running", 1, Some("2026-09-29T00:00:00Z"), None).unwrap();
    record_run_invocation(&path, "run-1", "tool-1", "model_tool", "read", "completed", 1, Some("2026-09-29T00:00:00Z"), Some("2026-09-29T00:00:01Z")).unwrap();
    record_run_invocation(&path, "run-1", "image", "capability", "image_generate", "failed", 1, None, Some("2026-09-29T00:00:02Z")).unwrap();
    record_run_invocation(&path, "run-1", "image", "capability", "image_generate", "completed", 2, None, Some("2026-09-29T00:00:03Z")).unwrap();
    let metrics = get_run_metrics(&path, "run-1").unwrap();
    assert_eq!(metrics.model_tools.total, 1);
    assert_eq!(metrics.capabilities.total, 2);
}
```

同时补充 usage delta/snapshot、旧数据库升级、日期筛选和分页测试。

- [ ] **步骤 2：运行 Rust 目标测试并确认失败**

运行：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml run_metrics -- --nocapture`

预期：因存储函数和结构不存在而编译失败。

- [ ] **步骤 3：增加 migration 10**

迁移必须创建：

```sql
CREATE TABLE IF NOT EXISTS run_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  invocation_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('model_tool','capability')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','rejected')),
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, category, invocation_id, attempt)
);
```

并向 `usage_records` 增加 `usage_id`、`reasoning_tokens`、`cached_input_tokens`、`aggregation`、`scope`，向 `runs` 增加 `source TEXT NOT NULL DEFAULT 'conversation'` 和 `assistant_message_id TEXT`，创建 run/time/model/provider/category/source 查询索引。旧记录的 `aggregation/scope` 保持 null，由查询层标记 partial。

- [ ] **步骤 4：实现幂等写入和聚合查询**

`record_run_invocation` 使用 upsert，并通过状态优先级 `running < completed|failed|rejected` 防止状态倒退。`record_usage` 拒绝负值，使用 `(run_id, usage_id)` 唯一键。查询通过参数绑定构建固定组合，不拼接用户输入 SQL。

- [ ] **步骤 5：注册 Tauri 命令**

`lib.rs` 增加 Deserialize 输入结构和四个命令，并加入 `tauri::generate_handler!`。查询参数包括 `range`、`model`、`provider`、`source`、`query`、`run_id`、`cursor`、`limit`。同时扩展 `create_run`，在运行创建时写入 `source` 和 `assistant_message_id`，避免统计查询解析 `run_events.payload_json`。

- [ ] **步骤 6：运行 Rust 全量测试**

运行：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

预期：全部通过。

- [ ] **步骤 7：提交任务 3**

```bash
git add apps/desktop/src-tauri/src/storage.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "Persist auditable invocation and token metrics"
```

---

### 任务 4：桌面事件归一化、持久化与客户端 API

**文件：**
- 新建：`apps/desktop/src/run-metrics-events.ts`
- 修改：`apps/desktop/src/workbench-client.ts`
- 修改：`apps/desktop/src/App.tsx`
- 测试：`apps/desktop/test/run-metrics-events.test.ts`
- 测试：`apps/desktop/test/workbench-client.test.ts`

**接口：**
- 消费：任务 1 的 `MetricEvent` 和任务 3 的 Tauri 命令。
- 产出：`normalizeDesktopMetricEvent(event, sequence): MetricEvent | undefined`。
- 产出：`workbenchClient.metrics.getRun(runId)` 与 `workbenchClient.metrics.query(filters)`。

- [ ] **步骤 1：编写事件分类失败测试**

```ts
test("classifies OpenCode tools separately from media capabilities", () => {
  const tool = normalizeDesktopMetricEvent({ event: "tool_event", runId: "r1", tool: "read", toolCallId: "t1", phase: "completed" }, 3);
  assert.equal(tool?.kind, "invocation");
  assert.equal(tool?.invocationId, "t1");
  assert.equal(tool?.category, "model_tool");
  assert.equal(tool?.name, "read");
  assert.equal(tool?.phase, "completed");
  assert.equal(tool?.attempt, 1);
  assert.match(tool?.createdAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  const media = normalizeDesktopMetricEvent({ event: "tool_event", runId: "r1", tool: "media:image_generate", phase: "started", message: JSON.stringify({ nodeKey: "image", idempotencyKey: "r1:image:2" }) }, 4);
  assert.equal(media?.kind, "invocation");
  assert.equal(media?.category, "capability");
  assert.equal(media?.attempt, 2);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`pnpm --filter @coworkany/desktop exec tsx --test test/run-metrics-events.test.ts`

预期：模块不存在。

- [ ] **步骤 3：实现事件归一化器**

分类规则：

```ts
tool.startsWith("media:") || tool.startsWith("workflow:") || tool.startsWith("ppt:")
  ? "capability"
  : "model_tool";
```

`artifact:*`、`run:*` 和纯进度事件不计为调用。permission request/response 使用 `callId` 归入 `model_tool`，拒绝映射为 `rejected`。优先使用显式 `toolCallId` 或 `idempotencyKey`；最后才使用 `${tool}:${sequence}`，保证同一生命周期拥有相同身份的事件必须由 Runtime 提供稳定 ID。

- [ ] **步骤 4：接入 App 事件监听器**

每个可统计事件按顺序执行：归一化 → 更新内存 accumulator → 更新 assistant `data-runMetrics` → 调用 `record_run_invocation` 或扩展后的 `record_usage`。能力事件和模型工具事件继续保留原来的执行过程 UI，不以统计条替代。

- [ ] **步骤 5：实现 Workbench Client metrics API**

映射 Tauri snake_case 响应到共享 camelCase 类型；`runs.start`/`create_run` 同步传入运行来源和 assistant message identity；`conversations.messages` 恢复 assistant 消息时，若存在 `runId`，使用 `metrics.getRun(runId)` 替换缓存的 `data-runMetrics`，查询失败时保留缓存快照。

- [ ] **步骤 6：运行桌面端测试和类型检查**

运行：`pnpm --filter @coworkany/desktop test && pnpm --filter @coworkany/desktop typecheck`

预期：全部通过。

- [ ] **步骤 7：提交任务 4**

```bash
git add apps/desktop/src/run-metrics-events.ts apps/desktop/src/workbench-client.ts apps/desktop/src/App.tsx apps/desktop/test/run-metrics-events.test.ts apps/desktop/test/workbench-client.test.ts
git commit -m "Keep live and restored run metrics consistent"
```

---

### 任务 5：类型化消息快照与共享紧凑统计组件

**文件：**
- 修改：`packages/workbench-client/src/uimessage.ts`
- 新建：`packages/workbench-ui/src/run-metrics.tsx`
- 修改：`packages/workbench-ui/src/index.ts`
- 修改：`packages/workbench-ui/src/desktop-entry.ts`
- 修改：`packages/workbench-ui/src/ai-elements/source.tsx`
- 修改：`packages/workbench-ui/src/workbench-message-surface.tsx`
- 修改：`packages/workbench-ui/src/styles.css`
- 测试：`packages/workbench-client/test/uimessage.test.ts`
- 新建：`packages/workbench-ui/test/run-metrics.test.tsx`
- 修改：`packages/workbench-ui/test/workbench-message-surface.test.tsx`
- 修改：`packages/workbench-ui/test/official-ai-elements.test.tsx`

**接口：**
- 消费：任务 1 的 `RunMetrics`。
- 产出：`DesktopDataParts.runMetrics: RunMetrics` 和 `data-runMetrics`。
- 产出：`WorkbenchRunMetrics` 共享组件。

- [ ] **步骤 1：编写失败的消息映射和渲染测试**

```tsx
test("renders a compact localized run summary with expandable details", () => {
  const count = (total: number) => ({ total, completed: total, failed: 0, rejected: 0, running: 0, byName: [] });
  const metrics = { runId: "run-1", model: "gpt-5.6-sol", modelTools: count(4), capabilities: count(1), tokens: { input: 9600, output: 3200 }, completeness: "complete" as const };
  const markup = renderToStaticMarkup(<WorkbenchRunMetrics metrics={metrics} locale="zh" />);
  assert.match(markup, /gpt-5\.6-sol/);
  assert.match(markup, /工具 4/);
  assert.match(markup, /能力执行 1/);
  assert.match(markup, /12\.8K Token/);
  assert.match(markup, /输入/);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`pnpm --filter @coworkany/workbench-ui exec tsx --test test/run-metrics.test.tsx`

预期：组件不存在。

- [ ] **步骤 3：实现消息类型与组件**

`WorkbenchRunMetrics` 使用原生 `<details>` 或现有 AI Elements disclosure primitive，summary 展示模型、工具、能力和已知 Token 总量；详情复用 `Context` 的 Input/Output/Cache/Reasoning 行，并展示调用状态分布、成本和“查看统计详情”。统计组件自定义 Context trigger，不把 `usedTokens` 同时当作 `maxTokens` 造成虚假的“100% context used”。`Context*Usage` 以 `value !== undefined` 判断已知值，使 Provider 明确返回的 0 与未知值可区分。所有数字使用 `Intl.NumberFormat`，未知值显示“未提供”。

- [ ] **步骤 4：接入统一消息表面**

`WorkbenchMessageSurface` 在 artifacts/previews 之后渲染唯一 `data-runMetrics`。旧消息只有 `data-usage` 时继续显示 Context，但不得同时显示两条 Token 摘要。

- [ ] **步骤 5：增加可访问性和响应式样式**

统计条具备可见 focus、`aria-label`、键盘展开；窄屏允许换行但不把指标拆成独立大卡片。

- [ ] **步骤 6：运行 UI 和客户端全量验证**

运行：`pnpm --filter @coworkany/workbench-client test && pnpm --filter @coworkany/workbench-client typecheck && pnpm --filter @coworkany/workbench-ui test && pnpm --filter @coworkany/workbench-ui typecheck`

预期：全部通过。

- [ ] **步骤 7：提交任务 5**

```bash
git add packages/workbench-client/src/uimessage.ts packages/workbench-client/test/uimessage.test.ts packages/workbench-ui/src/run-metrics.tsx packages/workbench-ui/src/index.ts packages/workbench-ui/src/desktop-entry.ts packages/workbench-ui/src/ai-elements/source.tsx packages/workbench-ui/src/workbench-message-surface.tsx packages/workbench-ui/src/styles.css packages/workbench-ui/test/run-metrics.test.tsx packages/workbench-ui/test/workbench-message-surface.test.tsx packages/workbench-ui/test/official-ai-elements.test.tsx
git commit -m "Show compact auditable metrics on every assistant turn"
```

---

### 任务 6：全局用量统计页

**文件：**
- 新建：`apps/desktop/src/usage-dashboard.tsx`
- 新建：`apps/desktop/src/usage-dashboard-model.ts`
- 修改：`apps/desktop/src/App.tsx`
- 修改：`apps/desktop/src/styles.css`
- 测试：`apps/desktop/test/usage-dashboard-model.test.ts`

**接口：**
- 消费：`workbenchClient.metrics.query(filters)`。
- 产出：`DesktopUsageDashboard`。
- 产出：纯函数 `buildUsageDashboardView(result, locale)`，使统计格式与空状态可单测。

- [ ] **步骤 1：编写筛选和视图模型失败测试**

```ts
test("keeps unknown usage unknown while rendering empty date buckets as zero", () => {
  const emptyCount = { total: 0, completed: 0, failed: 0, rejected: 0, running: 0, byName: [] };
  const result = { overview: { tokens: 10, modelTools: 0, capabilities: 0 }, series: [{ date: "2026-09-28", inputTokens: 0, outputTokens: 0, modelTools: 0, capabilities: 0 }, { date: "2026-09-29", inputTokens: 10, outputTokens: 0, modelTools: 0, capabilities: 0 }], models: [], tools: [], capabilities: [], runs: [{ runId: "run-1", title: "会话", source: "conversation" as const, model: "model-a", status: "completed", startedAt: "2026-09-29T00:00:00Z", metrics: { runId: "run-1", model: "model-a", modelTools: emptyCount, capabilities: emptyCount, tokens: { input: 10 }, completeness: "partial" as const } }] };
  const view = buildUsageDashboardView(result, "zh");
  assert.equal(view.series[0]?.inputTokens, 0);
  assert.equal(view.rows[0]?.reasoningTokensLabel, "未提供");
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`pnpm --filter @coworkany/desktop exec tsx --test test/usage-dashboard-model.test.ts`

预期：模块不存在。

- [ ] **步骤 3：实现视图模型与页面状态**

页面初始 filters 为 `{ range: "30d", limit: 50 }`。筛选变化取消或忽略前一次过期响应。页面必须覆盖 loading、error、empty、data 四种状态。

- [ ] **步骤 4：实现概览、趋势和分布**

不新增图表依赖。使用语义化 SVG 绘制 Input/Output 堆叠趋势和工具/能力折线；每个 SVG 提供标题、可访问描述和旁边的数据表摘要。概览卡展示 Token、模型工具、能力执行、Provider 返回成本；全部历史不展示环比。

- [ ] **步骤 5：实现逐轮明细与分页**

表格列为时间、会话/任务、来源、模型、工具、能力、Token、成本、状态。点击 conversation 行调用 `onNavigate(conversationPathWithMessageAnchor)`；无 conversation 的运行调用 `onOpenTask(runId)`。分页使用 `nextCursor`。

- [ ] **步骤 6：接入 App 并添加样式**

`App.tsx` 只负责路由分支、导航回调和传入 `workbenchClient`，筛选、查询和展示逻辑全部留在新组件中。

- [ ] **步骤 7：运行桌面测试和类型检查**

运行：`pnpm --filter @coworkany/desktop test && pnpm --filter @coworkany/desktop typecheck`

预期：全部通过。

- [ ] **步骤 8：提交任务 6**

```bash
git add apps/desktop/src/usage-dashboard.tsx apps/desktop/src/usage-dashboard-model.ts apps/desktop/src/App.tsx apps/desktop/src/styles.css apps/desktop/test/usage-dashboard-model.test.ts
git commit -m "Add a filterable desktop usage dashboard"
```

---

### 任务 7：导航、深链和全入口一致性

**文件：**
- 修改：`packages/workbench-ui/src/routes.ts`
- 修改：`packages/workbench-ui/test/routes.test.ts`
- 修改：`apps/desktop/src/App.tsx`
- 修改：`apps/desktop/test/routes.test.ts`

**接口：**
- 产出：`/dashboard/usage` 资源入口。
- 产出：`/dashboard/usage?runId=<id>` 和会话消息 anchor 导航。

- [ ] **步骤 1：编写导航失败测试**

```ts
test("exposes usage analytics under resource routes", () => {
  const route = WORKBENCH_ROUTE_MANIFEST.find((item) => item.path === "/dashboard/usage");
  assert.equal(route?.section.zh, "资源入口");
  assert.equal(route?.label.zh, "用量统计");
});
```

- [ ] **步骤 2：运行目标测试并确认失败**

运行：`pnpm --filter @coworkany/workbench-ui exec tsx --test --test-name-pattern="usage analytics" test/routes.test.ts`

预期：找不到路由。

- [ ] **步骤 3：增加路由和深链解析**

统计条的“查看统计详情”跳转 `/dashboard/usage?runId=${encodeURIComponent(runId)}`。明细返回对话时使用 `?message=${encodeURIComponent(messageId)}`；对话加载完成后调用现有滚动容器定位 `[data-message-id="..."]`，定位失败时保留正常会话顶部/恢复位置。

- [ ] **步骤 4：验证所有入口共用统计表面**

增加源代码契约测试，确认 AI、Agent、Writer/PPT 对话均通过 `WorkbenchMessageSurface`，工作流/媒体/PPT 能力都写入 `capability` 调用记录，没有路由自行渲染另一套统计卡。

- [ ] **步骤 5：运行路由与桌面测试**

运行：`pnpm --filter @coworkany/workbench-ui test && pnpm --filter @coworkany/desktop test`

预期：全部通过。

- [ ] **步骤 6：提交任务 7**

```bash
git add packages/workbench-ui/src/routes.ts packages/workbench-ui/test/routes.test.ts apps/desktop/src/App.tsx apps/desktop/test/routes.test.ts
git commit -m "Connect usage analytics to every desktop entry point"
```

---

### 任务 8：全量验证与人工验收清单

**文件：**
- 修改：`docs/superpowers/specs/2026-09-29-conversation-tool-token-statistics-design.md`（仅在实现发现契约偏差时同步明确决策）

**接口：**
- 消费：前七个任务的完整实现。
- 产出：自动化验证证据和仅包含视觉/真实 Provider 的人工验收清单。

- [ ] **步骤 1：运行格式与差异检查**

运行：`git diff --check`

预期：无输出，退出码 0。

- [ ] **步骤 2：运行 TypeScript 全量验证**

运行：

```bash
pnpm --filter @coworkany/runtime-contracts test
pnpm --filter @coworkany/runtime-contracts typecheck
pnpm --filter @coworkany/workbench-client test
pnpm --filter @coworkany/workbench-client typecheck
pnpm --filter @coworkany/workbench-ui test
pnpm --filter @coworkany/workbench-ui typecheck
pnpm --filter @coworkany/desktop test
pnpm --filter @coworkany/desktop typecheck
```

预期：全部退出码 0。

- [ ] **步骤 3：运行 Rust 全量测试**

运行：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

预期：全部通过。

- [ ] **步骤 4：验证生产构建**

运行：`pnpm --filter @coworkany/workbench-ui build && pnpm --filter @coworkany/desktop build`

预期：TypeScript、Vite、Host、Skill 和 Agent 构建全部通过。

- [ ] **步骤 5：检查统计一致性自动化证据**

运行一个 fixture 流程，断言同一 `runId` 的消息 `data-runMetrics`、`get_run_metrics` 和 `query_metrics(runId)` 在工具数、能力数和 Token 上完全一致。

- [ ] **步骤 6：保留人工验收项**

人工验收仅包括：

- 对话内统计条视觉密度和展开可读性。
- 统计页图表在亮色/暗色及窄窗口下的可读性。
- 明细跳转后准确定位原助手消息。
- 使用真实 Provider 核对 Input、Output、Cache、Reasoning 和成本返回值。
