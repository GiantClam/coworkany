# 对话工具调用与 Token 统计设计

日期：2026-09-29

## 概述

在桌面端新增两个相关功能：

1. 在每轮助手回复中展示工具调用与 Token 消耗统计。
2. 新增全局用量统计页，汇总模型、工具调用、能力执行、Token 与 Provider 返回成本。

设计以标准化的调用记录和用量记录为事实来源。对话界面提供紧凑的单轮摘要；`/dashboard/usage` 提供近 7 天、近 30 天和全部历史分析。Dify 和服务端计费不在本次范围内。

## 目标

- 在不打断对话阅读的前提下，让每轮助手执行可审计。
- 区分模型主动发起的工具调用与工作流/能力执行。
- 仅展示 Provider 或运行时实际返回的 Token 数据。
- 保留失败、取消和中断运行的部分统计。
- 保证实时值、恢复后的会话历史、任务证据和全局统计一致。
- 覆盖桌面端 AI、Agent、Writer/PPT、工作流、媒体和 PPT 能力运行。

## 非目标

- 接入 Dify。
- 账单、发票、额度余额或配额限制。
- 估算缺失的 Token 数量。
- 首个版本不提供 CSV 导出、预算告警、消耗预测或可编辑模型价格表。
- 不从旧版自由格式事件载荷中反推工具调用次数。

## 产品决策

### 调用分类

统计展示两个独立类别：

- `model_tool`：模型主动发起的工具调用，包括本地文件工具、Shell、搜索、Skill 和 MCP 工具。
- `capability`：实际执行的工作流节点、媒体动作、PPT 引擎或其他能力。

模型工具调用按稳定的 `toolCallId` 计数一次。其 started、completed、failed、blocked 和 rejected 事件都是同一次调用的状态变化。

能力执行按实际尝试次数计数，身份由 `runId`、`nodeKey` 或能力键，以及 attempt 或 idempotency key 共同确定。因此，真实重试会增加一次执行；同一尝试的重复生命周期事件不会重复计数。

失败和拒绝的调用仍计入总数。界面同时展示状态分布，避免用户把总调用数误认为成功执行数。

### Token 与成本语义

- Provider 或运行时返回 Input、Output Token 时才记录对应数据。
- Provider 返回 Cache、Reasoning Token 时才记录对应数据。
- 缺失字段保持未知，在界面中展示为 `—` 或“未提供”；单次运行详情中不得将其转换为 0。
- Provider 返回成本与本地估算成本保持为两个独立字段，禁止相加。
- 负数、非有限数或格式错误的数值不进入统计，并产生诊断警告。

用量事件必须声明聚合语义：

- `delta`：将本事件累加到运行总量。OpenCode 的 `step-finish` 用量使用此模式。
- `snapshot`：将本事件视为累计值，在对应 scope 内使用最新快照。

用量事件同时声明作用域：

- `step`：用量属于一个模型步骤。
- `run`：用量描述整次运行。

这一设计可避免 Provider 在逐步增量之后又发送整轮累计快照时发生重复计算。

### 时间范围

全局统计页默认展示近 30 天，并提供近 7 天、近 30 天和全部历史。时间戳以 UTC 存储，分桶和界面标签使用用户桌面端所在时区。

## UX 设计

### 每轮紧凑统计条

助手消息在正文、产物和预览之后、消息操作按钮之前展示紧凑统计条：

```text
GPT-5.6 Sol  ·  工具 4  ·  能力执行 1  ·  12.8K Token  ⌄
```

统计条遵循以下规则：

- 执行期间实时更新，并展示轻量加载状态。
- 运行完成后，以持久化聚合结果替换实时值。
- 整条内容支持键盘和指针操作。
- 按 Enter、Space 或点击可展开详情。
- 没有可信统计数据时不渲染统计条。
- 紧凑统计条省略未知字段；展开详情中显示“未提供”。

展开内容包括：

- Provider 与模型。
- 模型工具总数、状态分布和按工具名称分组的数据。
- 能力执行总数、状态分布和按能力名称分组的数据。
- Input、Output、Cache、Reasoning Token。
- 分别标注的 Provider 返回成本和本地估算成本。
- “查看统计详情”操作：打开 `/dashboard/usage` 并按当前 `runId` 自动筛选。

共享实现复用现有 AI Elements `Context` 组件展示 Token 详情，并新增共享 `RunMetrics` 组合组件承载模型、工具和能力统计。各路由消息界面不得自行实现独立统计 UI。

### 全局用量统计页

在侧边栏“资源入口”中新增 `/dashboard/usage`，中文名称为“用量统计”，英文名称为“Usage”。

页面采用已确认的结构：概览优先，其后依次为趋势、分布和逐轮明细。

#### 筛选条件

- 时间范围：近 7 天、近 30 天、全部。
- 模型。
- Provider。
- 来源：对话、Agent、工作流、媒体或 PPT。
- Agent 或会话搜索。
- 每轮统计深链传入的可选 `runId`。

#### 概览指标

- 总 Token。
- 模型工具调用次数。
- 工作流/能力执行次数。
- Provider 返回成本。

近 7 天和近 30 天范围可以展示与前一个同长度周期的变化。全部历史模式不展示环比。

#### 趋势

- Input/Output Token 堆叠趋势。
- 模型工具/能力执行调用趋势。
- 某个日期桶完全没有记录时可以显示为 0；已有记录中的缺失字段仍保持未知，不能被静默转换为 0。

#### 分布

- 模型表：运行次数、Token、工具调用、能力执行和 Provider 返回成本。
- 工具排行：工具名称、调用次数和成功率。
- 能力排行：能力名称、执行次数和成功率。

#### 逐轮明细

列包括：时间、会话或任务、来源、模型、模型工具数、能力执行数、Token、成本和状态。

- 对话记录跳转到原始会话，并定位到对应助手消息。
- 没有对话页面的工作流和媒体记录跳转到任务中心的运行证据。
- 数据分页加载，默认按时间倒序排列。

## 架构设计

### 已评估方案

1. 扫描 `run_events` 动态推导全部统计。此方案数据库变更少，但查询慢、与历史事件格式强耦合，并且事件重放去重容易出错。
2. 每次运行仅保存一个汇总 JSON。此方案读取简单，但缺少审计能力，无法解释重试、失败或聚合错误。
3. 保存标准化调用与用量明细，并由此生成运行和查询汇总。此方案增加少量数据结构和查询层，但统计准确、可测试、可审计，也方便后续扩展。

采用方案 3。

### 数据流

```text
Runtime / Provider 事件
        ↓
统计归一化器
        ↓
调用累加器 + 用量累加器
        ↓
SQLite 标准化记录
        ↓
运行统计查询服务
        ├─ 实时与历史助手消息统计
        ├─ 全局用量统计页
        └─ 任务中心运行证据
```

### 调用记录

新增 `run_invocations` 表，包含以下逻辑字段：

| 字段 | 用途 |
| --- | --- |
| `id` | 本地记录标识 |
| `run_id` | 所属运行 |
| `invocation_id` | 运行时提供或本地合成的稳定调用标识 |
| `category` | `model_tool` 或 `capability` |
| `name` | 工具或能力展示键 |
| `status` | `running`、`completed`、`failed` 或 `rejected` |
| `attempt` | 实际尝试序号，默认为 `1` |
| `started_at` | 首次观察到的开始时间 |
| `finished_at` | 终态时间（如果存在） |
| `created_at` / `updated_at` | 持久化时间戳 |

唯一键为 `(run_id, category, invocation_id, attempt)`。

状态合并必须保持单调：终态不得被迟到的 running 事件覆盖。重复终态事件只能补充缺失元数据，不能创建新的调用记录。

统计表不得保存工具参数、工具输出、Prompt、API Key、文件内容或其他敏感载荷。

### 用量记录

扩展现有 `usage_records` 表，新增：

- `usage_id`：处理事件重放时的幂等身份。
- `reasoning_tokens`。
- `cached_input_tokens`。
- `aggregation`：`delta` 或 `snapshot`。
- `scope`：`step` 或 `run`。
- 运行时提供时记录可选的来源步骤身份。

用量唯一身份在单次运行范围内生效。迁移期间继续接受现有 `idempotency_key`；存在 `usage_id` 时将其映射为新的唯一身份。

### 查询投影

`RunMetrics` 是查询投影，不是第二份事实数据，包含：

- 运行、会话、来源、Provider 和模型身份。
- 工具与能力总数及其状态分布。
- 按工具/能力名称分组的计数。
- Input、Output、Cache、Reasoning Token 总量。
- Provider 返回成本和本地估算成本。
- `complete | partial | unavailable` 数据完整性状态。

新增以下客户端边界：

```ts
metrics.getRun(runId): Promise<RunMetrics>
metrics.query(filters): Promise<MetricsQueryResult>
```

`metrics.query` 返回概览总量、前一周期对比、时间序列桶、模型/工具/能力分布，以及一页运行明细。UI 不直接解析原始事件 JSON。

### 消息集成

运行期间，内存累加器根据标准化事件更新助手消息的类型化统计投影。运行进入终态或历史恢复时，以 SQLite 聚合结果为准。

助手消息保留 `runId`，并持久化一个轻量的类型化 `data-runMetrics` 展示快照，避免历史加载时发生布局闪烁。该快照只是缓存：加载历史时请求 `metrics.getRun(runId)`，获得事实结果后替换快照。

现有 `data-usage` 渲染保持兼容。最终共享消息组件需要合并整次运行的全部 usage 记录，不能假定最后一个 usage 事件就是整轮总量。

## 运行时事件契约

运行时事件统一归一化为两类稳定统计输入：

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

现有 OpenCode `tool_call` 事件映射为 `model_tool`；工作流节点尝试、媒体执行和 PPT 引擎执行映射为 `capability`。每个生命周期事件在进入消息渲染或存储之前只归一化一次。

## 异常处理

- 通过稳定的 invocation 和 usage identity 保证事件重放幂等。
- 乱序调用事件使用单调状态合并策略。
- 失败、取消或中断运行保留部分统计，并将完整性标记为 `partial`。
- 统计查询失败不得阻止对话消息渲染，也不得影响 Agent 运行。
- 每轮统计条可以显示“统计暂不可用”，但必须保留助手回复。
- Provider/模型身份缺失时，优先使用运行启动时锁定的模型，仍缺失则显示“未知模型”。
- 聚合器拒绝非法数值，产生诊断警告，但不让运行失败。
- 查询在 SQLite 中完成聚合，运行明细分页返回，避免将全部历史加载到渲染进程。

## 数据迁移

- 创建 `run_invocations` 及其唯一索引和查询索引。
- 为 usage 表增加新字段，并为时间、模型、Provider 和运行身份建立索引。
- 将旧版用量记录标记为 partial。
- 原样保留已有 Input、Output 和成本数据。
- 不从未版本化的 JSON 事件载荷中推断旧版工具或能力调用次数。
- 任务中心继续承担单次运行执行证据展示；新增统计页负责跨运行分析。

## 验证方案

### 单元测试

- 归一化模型工具、能力尝试、usage delta 和 usage snapshot。
- 去重生命周期状态变化和重放事件。
- 将真实重试计为不同尝试。
- 事件乱序时保持终态。
- 正确聚合 Input、Output、Cache、Reasoning、Provider 返回成本和本地估算成本。
- 保持未知字段为未知。

### 存储与查询测试

- 升级旧数据库且不丢失用量数据。
- 强制保证 invocation 和 usage 幂等。
- 验证近 7 天、近 30 天、全部、模型、Provider、来源、会话和运行筛选。
- 验证时区边界附近的本地日期分桶。
- 验证明细分页与排序。

### 协议与 UI 测试

- 验证 Runtime → Workbench Client → 类型化消息事件映射。
- 渲染实时、完成、部分、失败和不可用的每轮统计。
- 验证键盘展开和中英文标签。
- 验证跳转到会话消息或任务中心运行证据的深链。
- 验证全局统计页的概览、趋势、分布、筛选、空状态和分页。

### 集成与回归测试

- 运行包含多个模型步骤和工具调用的对话，验证不会重复计数。
- 重新加载会话，比较恢复值与实时值。
- 比较同一运行在每轮摘要、任务中心证据和全局统计页中的数据。
- 覆盖 AI、Agent、Writer/PPT、工作流、媒体和 PPT 引擎入口。

人工验收仅保留视觉密度、图表可读性、消息定位，以及与真实 Provider 返回数据的核对。

## 交付顺序

1. 增加统计契约、运行时归一化、数据库迁移、聚合和查询 API。
2. 增加共享的每轮紧凑统计组件和历史恢复。
3. 增加 `/dashboard/usage` 的概览、趋势、分布、筛选和逐轮明细。
4. 执行全入口自动化回归与性能验证，再完成人工视觉和真实 Provider 核对。

## 验收标准

- 每个包含可信统计的受支持助手轮次只显示一个紧凑统计条。
- 同一工具调用的 started 和 completed 事件只计数一次。
- 一次真实能力重试增加一次执行计数。
- 多个 OpenCode step usage 事件完整聚合，不丢失前序步骤。
- run-level snapshot 不与等价的 step delta 重复累加。
- 缺失的 Token 类别显示为不可用，而不是 0。
- 同一运行的实时统计、恢复后统计、任务中心统计和全局统计一致。
- 用量统计页默认近 30 天，并支持近 7 天和全部历史。
- 统计功能失败不得阻断对话、工作流或媒体执行。
- 统计存储不得新增任何敏感工具输入、输出或凭据。
