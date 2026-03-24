# 2026-03-24 聊天消息 vs 任务：UI 与触发机制优化设计

## 背景与目标

Coworkany 已有 `chat / immediate_task / scheduled_task / scheduled_multi_task` 模式与 `task_card` 展示能力，但当前用户仍会遇到两个体验问题：
1. 输入后系统“做回答”还是“建任务”不够可预测。
2. 任务触发与普通消息在入口层没有明确的心智锚点，导致澄清成本高。

本设计目标：在不新增复杂页面的前提下，让用户在单输入框内完成“即时回答”和“任务执行/调度”两类诉求，并保证可解释、可纠错、可回退。

Success metrics（首批）：
- 意图误判率下降（`chat` 被误判 `task` / `task` 被误判 `chat`）30%+
- `TASK_CLARIFICATION_REQUIRED` 触发率下降 20%+
- 任务创建后 60 秒内二次修改率下降 20%+

## 方案对比（社区实践映射）

### 方案 A：显式模式切换（Message / Task Toggle）

用户先选模式再发消息。

优点：
- 可预测性最高，低误判。
- 便于埋点和权限策略分层。

缺点：
- 打断自然语言流；对轻量任务不友好。
- 用户需要额外学习成本，聊天效率下降。

适用：强流程业务（工单、审批）。

### 方案 B：纯自动意图识别（无显式控件）

系统基于文本与上下文自动分流。

优点：
- 最自然，输入负担最低。
- 与当前架构兼容度高。

缺点：
- 意图边界模糊时误判成本高。
- 需要高质量回退和纠错机制。

适用：开放式助手，但必须有强 fallback。

### 方案 C：混合模式（推荐）

`自动识别 + 显式触发 + 二次确认`：
- 自动识别作为默认路径。
- 提供 `/task`、`/ask`、`转为任务` 等显式入口。
- 对中高风险或低置信路由先出“任务草稿卡片”再确认。

推荐原因：在自然度与可控性之间平衡最好，且与现有 `task_card + send_task_message` 机制最匹配。

## 推荐方案：交互与状态机

### 1) 单输入框 + 轻量触发控件

在 `InputArea` 增加两类 affordance：
- 快捷芯片：`仅回答`、`创建任务`（点击后只影响下一条消息）。
- Slash 命令：`/ask`、`/task`、`/schedule`。

默认仍可直接输入自然语言，不强制切模式。

### 2) 三层路由规则

L1：显式信号优先
- `/task`、`/schedule`、`每周/每天/提醒我`、`保存到...` 等高精度模式词直接进入任务路由。

L2：置信度路由
- 分析器输出 `intent = chat|task|scheduled_task` 与 `confidence`。
- `confidence >= high_threshold`：直接执行对应路由。

L3：歧义澄清
- `mid_threshold <= confidence < high_threshold` 时展示二选一卡片：
  - `直接回答`
  - `创建可跟踪任务`
- 用户选择后进入对应路径，并将选择写入短期偏好（当前会话）。

### 3) 任务创建采用“草稿-确认”

当命中以下任一条件，先展示任务草稿卡（不立即执行）：
- 外部写操作/不可逆动作
- 需要手动授权/登录
- 调度任务（scheduled）
- 多步骤且带交付物写入（文件、报告、代码变更）

草稿卡字段：`名称`、`指令`、`计划/频率`、`交付物`、`风险提示`。
操作：`确认创建`、`改成普通回答`、`编辑后创建`。

### 4) 普通消息与任务在时间线中的视觉区分

- 普通消息：保持现有 `MessageBubble`。
- 任务：统一使用 `TaskCardMessage`，头部固定显示：
  - `Task` 标签
  - 状态（draft/running/blocked/finished/failed）
  - 下一步动作（需要你确认/已在执行）

在“任务草稿”状态，卡片标题使用 `Task Draft`，避免用户误以为已执行。

## 数据合同与代码改造点（对齐现有实现）

### Sidecar（Analyzer/Schema）

文件：
- `sidecar/src/orchestration/workRequestSchema.ts`
- `sidecar/src/orchestration/workRequestAnalyzer.ts`

新增建议字段（additive）：
- `intentRouting`:
  - `intent: 'chat' | 'immediate_task' | 'scheduled_task'`
  - `confidence: number`
  - `reasonCodes: string[]`（如 `explicit_command`, `schedule_phrase`, `artifact_output_intent`）
  - `needsDisambiguation: boolean`
- `taskDraftRequired: boolean`

注意：不替换当前 `mode`，而是以 `intentRouting` 解释 `mode` 的来源，便于 UI 可解释化。

### Runtime/Event Bus

文件：
- `sidecar/src/protocol/events.ts`
- `sidecar/src/execution/taskEventBus.ts`

新增事件：
- `TASK_DRAFT_CREATED`
- `TASK_ROUTE_DISAMBIGUATION_REQUIRED`
- `TASK_ROUTE_SELECTED`

目标：让前端不靠字符串猜测，而是基于明确事件驱动 UI。

### Desktop（Input + Timeline）

文件：
- `desktop/src/components/Chat/components/InputArea.tsx`
- `desktop/src/components/Chat/ChatInterface.tsx`
- `desktop/src/components/Chat/Timeline/hooks/useTimelineItems.ts`
- `desktop/src/components/Chat/Timeline/components/TaskCardMessage.tsx`

改造要点：
- 输入区增加 `仅回答/创建任务` 快捷芯片和 slash 提示。
- Timeline 支持 `task_draft` 子状态渲染与确认按钮。
- 确认按钮复用现有 `send_task_message` 通道，避免新链路。

## 关键文案（首版）

歧义澄清卡：
- 标题：`我可以直接回答，也可以帮你建任务`
- 文案：`你这条更像是一个可跟踪事项。要我现在创建任务吗？`
- 按钮：`直接回答` / `创建任务`

任务草稿卡：
- 标题：`任务草稿已生成`
- 文案：`确认后我会按下面计划执行。`
- 按钮：`确认创建` / `编辑` / `改成普通回答`

高风险确认：
- 文案：`这个操作会影响外部状态（如发送/写入/删除）。确认继续吗？`
- 按钮：`确认执行` / `取消`

## 失败回退与纠错

- 首次低置信：二选一澄清。
- 用户否定后：允许一句话纠正（one-step correction），例如“不是任务，直接告诉我答案”。
- 连续两次低置信：默认退回普通回答并提示“可用 `/task` 强制创建任务”。
- 任务执行中若用户说“先别做了，直接给结论”：将状态改为 `paused`，输出当前总结。

## 验证计划

1. 单元测试（sidecar）
- 显式命令优先于模型推断。
- `schedule` 意图不会落到 `chat`。
- 含“保存到路径”时 `taskDraftRequired=true`。

2. 组件测试（desktop）
- `TASK_ROUTE_DISAMBIGUATION_REQUIRED` 渲染二选一卡片。
- 点击 `创建任务` 后发送正确的 `send_task_message` 载荷。
- `task_draft` 与 `running` 视觉状态正确切换。

3. E2E（playwright）
- “帮我每周一提醒复盘” -> 任务草稿 -> 确认 -> scheduled task 成功。
- “这个概念解释一下” -> 普通消息直接回复。
- “整理一份方案并保存到 reports/plan.md” -> 任务草稿且包含交付物路径。

## 分阶段上线

- Phase 1：仅加 `intentRouting` 与歧义卡（不改任务模型）。
- Phase 2：引入任务草稿卡与确认机制。
- Phase 3：加入会话级偏好学习（用户最近 5 次选择倾向）。

该顺序可以把风险压在最小可验证单元，避免一次性重构输入与任务体系。
