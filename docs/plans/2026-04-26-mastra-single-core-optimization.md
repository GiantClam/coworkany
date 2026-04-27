# Mastra 单核心优化方案

**日期**: 2026-04-26
**状态**: 已进入实施
**决策**: 不引入 Pi Agent。CoworkAny 以 Mastra 作为唯一核心 agent/workflow runtime，避免双 runtime 在 session、memory、tool event、chat/task routing 和 task lifecycle 上产生职责重叠。

## 背景

当前人工验收失败主要集中在：

- 多轮对话、复杂上下文下任务执行正确性下降。
- 自动测试集合通过，但人工验收不通过。
- chat 响应过慢。
- chat 与 task 无法稳定区分，导致应执行的 task 没有正确执行。
- 模型可能以文字宣告完成，但缺少工具证据。

这些问题不是单纯更换 agent loop 能解决的，而是控制平面、任务契约、证据验证、回放评测和 UI 状态一致性问题。因此核心框架应保持单一：Mastra 承担 agent/workflow/memory/tool approval/eval/tracing，CoworkAny 承担产品级控制平面和验收规则。

## 非目标

- 不引入 Pi Agent adapter。
- 不维护第二套 session history、memory、compaction 或 tool event bridge。
- 不做 Mastra/Pi executor A/B。
- 不把 OpenClaw/Pi prompt/runtime 语义放进 CoworkAny 核心链路。

## 目标架构

```text
User Input
 -> Intent Router
    -> Chat Fast Path
    -> Task Draft Path
    -> Scheduled Task Path

Chat Fast Path
 -> lightweight Mastra ChatAgent
 -> short context + limited memory
 -> no side-effect tools by default
 -> stream response quickly

Task Path
 -> WorkRequest Analyzer
 -> Frozen Task Contract
 -> Mastra Workflow
 -> Mastra Agent / Tool steps
 -> Evidence Verifier
 -> Task Card Events
```

## 职责边界

### Mastra 负责

- Agent 执行。
- Workflow 编排。
- Tool approval 与 human-in-the-loop suspend/resume。
- Memory、guardrails、scorers、tracing。

### CoworkAny 负责

- chat/task/scheduled route 的入口决策。
- task draft 与冻结任务契约。
- lifecycle state machine 与 canonical UI events。
- tool evidence requirements 与 completion gate。
- 人工验收失败回放数据集。

## Tool 统一方案

CoworkAny 不再把 `core tools`、`STANDARD_TOOLS`、`Mastra agent builtins` 视为三套并行工具机制。统一目标是：

```text
CoworkAny Tool = Mastra createTool(...) + CoworkAny metadata
```

其中 Mastra tool 是唯一一等运行时工具定义；CoworkAny metadata 只补充产品控制面需要的信息：

- `effects`: 文件读写、命令执行、网络、UI 通知、记忆等副作用。
- `capabilities`: `filesystem_read`、`artifact_write`、`command_execution`、`voice_output`、`memory`。
- `evidenceKind`: completion gate 用来判断任务是否真的满足 required capability。
- `riskLevel`: approval/policy 使用的风险分级。
- `aliases`: 兼容旧称，例如 `run_command` 可承接 `bash/shell/terminal` 语义。

### 保留的概念边界

- `core` 不是工具实现层，而是 runtime profile/filter。`core` 只允许 baseline tool id：`view_file`、`list_dir`、`write_to_file`、`replace_file_content`、`run_command`。
- `full` 允许完整内置工具集合，并继续叠加已启用 toolpack/MCP。
- `toolpack/MCP` 是工具来源，不是另一套执行模型。内部 toolpack 和 MCP discovered tools 都进入同一个 runtime toolset 视图。
- `skill` 不是 tool。skill 只提供触发规则、说明、依赖和 allowed tools，不拥有执行实现。

### 迁移原则

1. 标准工具直接注册为 Mastra `createTool(...)`，不再先维护 legacy tool 再通过兼容 adapter 暴露给 Mastra。
2. 工具执行逻辑仍保持为可测试的纯实现函数，避免把文件操作或命令执行细节散落在 agent 定义里。
3. `core/full`、capability summary、evidence gate、approval policy 统一读取同一份 Mastra-native registry metadata。
4. `STANDARD_TOOLS` 命名在迁移期保留为执行实现来源；最终应降级为内部实现模块或被拆分到各 tool 文件，不再作为独立 runtime 机制。

### 已落地切片

- 新增 `CoworkAnyToolRegistry`，将当前 `STANDARD_TOOLS` 注册为 Mastra tools，并附带 `effects/capabilities/evidenceKind/riskLevel/aliases`。
- `core` profile 通过 registry filter 暴露 baseline Mastra tools，而不是维护另一套工具实现。
- supervisor、supervisorSolo、coworker、coder 已直接消费 registry 产出的 Mastra tools。
- `resolveRuntimeInternalTool` 已改为从 Mastra-native registry 读取标准工具 metadata，runtime capability/toolset 视图与 agent 可调用工具开始收敛。
- `search_web`、`crawl_url`、`extract_content` 已注册进同一 registry。supervisor、supervisorSolo、research resolver 和 `resolveProfiledBuiltinAgentTools` 不再各自维护一份 research builtin 工具表。
- agent 默认命令执行面已收敛到 `run_command`。旧 `bash`/`bash_approval` Mastra 工具实现已删除；事件解析仍兼容历史工具名，以便 replay 旧会话。
- runtime 入口不再把 `STANDARD_TOOLS` 作为工具解析 fallback；旧 `mastra/tools/memory.ts` 包装层已删除。`STANDARD_TOOLS` 当前仅作为迁移期执行实现来源和底层单测入口保留。
- 结构化文件工具缺口已补齐：`create_directory`、`compute_file_hash`、`batch_delete_paths`、`batch_move_files` 进入标准实现并自动注册为 Mastra tools，避免 capability/tool evidence 指向不可调用工具。
- internal toolpack 解析不再读取 legacy `globalToolRegistry`，避免旧注册表覆盖 Mastra-native registry metadata。legacy `globalToolRegistry` singleton 已删除；自定义语音 provider 如需工具能力，必须由调用方显式注入 `getToolByName`，不再通过全局注册表隐式获得工具。
- voice provider 与 Mastra tool 已合并到同一解析链：`voice_speak` 是 provider 层之上的公开 Mastra tool endpoint；custom ASR/TTS provider 通过 `resolveVoiceProviderMastraToolDefinition` 复用 Mastra registry 中的工具。`voice_speak` 不允许作为 provider 实现注册，避免递归调用。

## 路由规则

优先级从高到低：

1. 显式 slash 命令：`/ask`、`/task`、`/schedule`。
2. UI route token：`__route_chat__`、`__route_task__`、`__route_schedule__`。
3. schedule parser：识别定时/重复/链式调度。
4. tool-backed capability inference：文件、shell、browser、web research、voice、artifact write。
5. 低置信或空输入进入澄清，不执行任务。
6. 默认聊天仅走 chat fast path。

## Chat Fast Path

普通 chat 不进入完整 task workflow，不默认启用 skills/toolpacks，不触发 side-effect tools。

验收要求：

- `chat` route 的 `executionPath=direct`。
- `forcedRouteMode=chat`。
- `useDirectChatResponder=true`。
- 未显式开启时 `enabledSkills=[]` 且无 `skillPrompt`。

## Task Contract

任务执行前冻结契约，至少包含：

- objective
- deliverables
- checkpoints
- required evidence
- preferred tools
- completion criteria
- resume strategy

任务契约进入 `FrozenWorkRequest` 后，执行层只能执行该契约，不能由模型临场改目标。

## Evidence Gate

任务不能只凭 assistant 文本进入完成态。按能力要求验证工具证据：

- `web_research`: 必须出现 web/search/crawl/news/finance/weather 类工具证据。
- `browser_automation`: 必须出现 browser/playwright/navigate/screenshot/click/fill 类工具证据。
- `command_execution`: 必须出现 shell/bash/run_command/terminal 类工具证据。
- `artifact_write`: 必须出现 write/replace/move/delete file 类工具证据。
- `filesystem_read`: 必须出现 list/read/view file 类工具证据。
- `voice_output`: 必须出现 voice/tts/speak 类工具证据。

缺少证据时：

1. 自动重试，使用 bounded retry budget。
2. 重试耗尽后显式失败，带错误码和缺失能力。
3. 不允许静默卡死或假完成。

### 已落地的执行层规则

`executeFrozenTask` 不再把“任意 tool call”视为完成证据。每个 required capability 必须由匹配工具名满足：

- `web_research` 仅接受 search/web/crawl/news/finance/weather/market 类工具。
- `browser_automation` 仅接受 browser/playwright/navigate/screenshot/click/fill 类工具。
- `command_execution` 仅接受 shell/bash/run_command/terminal 类工具。
- `artifact_write` 仅接受 write/replace/append/move/delete/apply_patch 类工具。
- `filesystem_read` 仅接受 list/read/view/stat file 类工具。
- `voice_output` 仅接受 voice/tts/speak/read_aloud 类工具。

执行结果会记录 `satisfiedCapabilities` 与 `missingCapabilities`。若存在缺失项，错误码使用 `workflow_missing_required_tool_evidence:<capability-list>`，避免错误地用无关工具调用通过验收。

## Task Draft

以下任务必须先进入 draft/review 语义，而不是直接无提示执行：

- scheduled task。
- 多步骤或链式任务。
- 外部副作用或发布行为。
- 文件/代码/工作区写入。
- high/medium risk task。
- 需要登录、授权、验证码或人工步骤。

## 人工验收回放

所有人工验收失败都应转换为可回放 eval case，至少记录：

- user input。
- route decision。
- frozen contract。
- required evidence。
- observed tool evidence。
- final task state。
- UI timeline event 摘要。
- human failure reason。

目标是把“人工觉得不对”收敛成稳定 regression，而不是只扩大单元测试数量。

## 分阶段实施

1. 前置显式路由：补齐 `/ask`、`/task`、`/schedule` 和 route token 解析。
2. Chat fast path 加固：确保普通 chat 不加载重技能和任务 workflow。
3. Task draft 判定：把 schedule/write/high-risk/multi-step/manual/auth 标为 `taskDraftRequired`。
4. Frozen contract evidence：把 required evidence 写入 task contract 与 execution query。
5. Evidence verifier 加强：按 capability 类别匹配具体工具证据，而不是只判断是否有任意 tool call。
6. Manual acceptance replay：新增首批人工验收失败 replay fixture 并纳入控制平面 eval。

## 本轮实施范围

本轮已实施第 1、3、4、5 步，并补强第 2 步已有回归。第 6 步（人工验收失败 replay fixture 扩充）保留为后续数据沉淀项，因为它需要真实人工失败 transcript 与 UI timeline 摘要。

## 真实会话 Replay 验收补充

本轮从 `.coworkany/data/coworkany.db` 的 `mastra_messages` 抽取了真实失败线程，固定为可重复 fixture：

- `thread-eml-004`: 邮件分类任务要求写入 `workspace/classified.json`，助手曾以文本宣告“已完成/已验证”，但后续出现 `[Required Output Missing]`。
- `thread-web-004`: 表单字段盘点任务要求写入 `workspace/form_fields.json`，助手多次声称文件已存在，但 completion check 仍报告未完成。
- `thread-fin-008`: WACC 报告任务要求当前市场数据与 `workspace/wacc_report.json` 输出，旧流程可能被无关工具或文本完成绕过。

新增 `real-session-replay` 验收规则：

1. 真实输出文件任务必须被识别为 `immediate_task`，并触发 `taskDraftRequired`。
2. `Read \`workspace/...\``、`Write the result to \`workspace/...\``、`[Output File Contract]` 等真实 benchmark phrasing 必须推导出文件读写证据要求。
3. 仅有 assistant 文本、或仅有 `file_stat`/无关 command 工具时，不得进入完成态。
4. 只有匹配 required capability 的工具证据齐全时，`executeFrozenTask` 才能完成。

本轮还补齐了控制面 replay 基础设施：

- `controlPlaneEventLogImporter`: 从 runtime event log 生成 production replay case，支持路径模板化、批量导入、dataset upsert。
- `controlPlaneEvalRunner`: 加载 `gold.jsonl`，执行 analyze/freeze/plan/artifact/runtimeReplay 分阶段评估并输出 summary。
- `controlPlaneIncidentReplay`: 将单个事件日志转换为 incident replay bundle，用于快速复现人工验收事故。

这使“真实记录 -> replay fixture -> regression gate”成为可运行路径，而不是文档约定。

## Live Model 自动验收替代人工方案

人工验收不能被单个单元测试替代，必须拆成可观测门禁。CoworkAny 当前可用的自动化替代链路如下：

1. **静态与确定性回归**: `npm run typecheck`、`npm run test:stable`、控制面 replay、真实 DB replay，确保路由、契约、证据门禁不退化。
2. **风险验收 replay**: `npm run test:risk:acceptance` 与 `npm run test:risk:desktop-replay`，覆盖 retry、approval、TLS、desktop pending 状态等人工常见失败。
3. **真实模型 smoke**: `npm run test:real-model-smoke`，实际调用当前配置 provider，验证 sidecar 能用 live model 完成一次真实 `start_task`。
4. **完整 strict-live 回归**: `npm run test:regression:core-full:live`，串起 lint、core/full capability regression、runtime lifecycle、desktop manual replay、provider preflight、sidecar real model smoke、desktop UI live user input。
5. **验收 oracle**: 每个 live task 不以 assistant 文本为准，而以 task event、required capability evidence、output artifact、UI 状态、latency budget 和 failure class 为准。

### 已落地的主观风险自动判定

新增 `sidecar/src/acceptance/liveAcceptanceOracle.ts`，把人工验收里容易主观化的风险拆成可执行判断：

| 风险 | 自动判定 | 失败条件 |
| --- | --- | --- |
| 回答质量 | `evaluateAssistantAnswerQuality` | 空回答、低信息占位、裸协议错误、拒绝产品应支持的能力、task 缺少 required capability evidence、task 缺少 required artifact、无证据却宣告完成 |
| 产品语气 | `evaluateProductTone` | 使用 “as an AI language model/作为 AI 语言模型” 等元叙事直接失败；cheerleading、居高临下表达、过量感叹号默认记为 warning，也可通过 `failOnWarnings` 提升为阻断失败 |
| UI 可理解性 | `evaluateUiUnderstandability` | 缺少状态标题、缺少解释文案、暴露 `workflow_missing_required_tool_evidence` 等裸错误、可恢复/阻塞状态缺少主操作按钮 |
| 视觉截图 | `evaluateVisualScreenshotAcceptance` + Playwright screenshot verdict | 缺少截图/参考图、截图分数低于阈值、verdict 非 `pass`、UI category 不匹配、存在未解决 visual differences |
| 综合验收 | `evaluateLiveAcceptance` | 汇总 answer/tone/UI checks，任一 `fail` 即不通过，`warn` 保留为产品体验风险 |

`sidecar/tests/live-acceptance-oracle.test.ts` 已覆盖 false completion、低信息回答、裸协议错误、产品语气、失败 UI 文案和综合 verdict。`sidecar/tests/real-model-smoke.e2e.test.ts` 已从“有 substantive text 即通过”升级为调用 `evaluateLiveAcceptance`，让 live model smoke 也接受同一套质量门禁。

### 视觉截图验收

Desktop 侧新增 `desktop/tests/utils/visualAcceptance.ts`，把 Playwright `toHaveScreenshot` 包装成可消费的结构化验收结果：

- 先验证截图目标可见、尺寸足够，避免截到空容器也误判通过。
- 使用 checked-in screenshot snapshot 做像素阈值门禁。
- 每次通过或失败都写出 `*.visual-verdict.json`，结构包含 `score`、`verdict`、`category_match`、`differences`、`suggestions`、`reasoning`。
- 失败时 Playwright 仍保留截图 diff，结构化 verdict 用于后续汇总或 replay 报告。

`desktop/tests/assistant-ui-visual-regression.e2e.spec.ts` 现在覆盖八类 synthetic UI 状态，外加三类真实 DB replay UI timeline 状态：

- thinking state。
- response state。
- approval card state。
- recoverable failure state。
- configuration-required failure state。
- suspended state。
- dense multi-turn task timeline。
- dense task timeline narrow viewport。
- real DB `thread-doc-004` long multi-turn timeline。
- real DB `thread-comm-004-debug-no-approval` slow-response timeline。
- real DB `thread-web-004-debug-no-approval` manual approval timeline。

新增 recoverable failure 截图验收锁定以下人工风险：

1. 用户必须看到 `Execution steps were not run` 这类可理解标题。
2. 用户必须看到 `Retry` 恢复动作。
3. UI 和 timeline 不能暴露 `workflow_missing_required_tool_evidence` 裸协议错误。
4. `.chat-interface` 必须匹配 `assistant-ui-recoverable-failure-state-light-en-darwin.png` 基线。

本轮视觉验收还发现并修复了真实 UI 泄漏：timeline event summary 会显示 `workflow_missing_required_tool_evidence:artifact_write`。修复后 `taskFailureUi` 与 `useTimelineItems` 都会把缺失工具证据协议错误转换成用户可读文案。

继续扩充截图样本时又发现并修复了两个 UI 风险：

- configuration-required failure 必须显示 `Provider configuration required` 与 `Open LLM Settings`，并进入截图基线 `assistant-ui-configuration-required-state-light-en-darwin.png`。
- suspended state 不能复用 retryable/upstream copy；现在使用 `Task suspended` / `Suspended` 专用文案，保留具体暂停原因，并进入截图基线 `assistant-ui-suspended-state-dark-en-darwin.png`。

继续修复 dense timeline 风险时又发现一个 assistant-ui 投影缺口：多轮 task card 的 `tasks`、`sections`、`collaboration` 和 `executionProfile.requiredCapabilities` 已存在于 timeline 数据，但 assistant-ui 结构化卡片只显示标题和进度，导致人工验收需要靠滚动阅读散落文本。修复后：

- `TASK_PLAN_READY.executionProfile.requiredCapabilities` 会被写入 canonical `Execution profile` section，确保 replay、timeline 和 assistant-ui 使用同一份证据。
- assistant-ui task card 会显示任务列表、计划/执行 section、协作阻塞信息和能力要求，避免 dense task 被压缩成不可诊断的 `Task center 2/5`。
- dense 宽屏截图基线为 `assistant-ui-dense-task-timeline-light-en-darwin.png`。
- dense 窄屏截图基线为 `assistant-ui-dense-task-timeline-narrow-dark-en-darwin.png`。
- 两个 dense 场景现在都必须包含 `TASK_FINISHED`，并在截图前断言最终 summary、`task status finished`、`progress: 5/5` 可见，同时拒绝 `undefined` 泄漏。能力要求、关键任务项、manual review 文案仍由 projection replay 单测覆盖，截图首屏则以完成态为准。

替代人工验收的通过标准：

- live provider preflight 通过，能访问真实模型 endpoint。
- sidecar real model smoke 通过，模型能返回可用 assistant 文本。
- desktop UI live input 通过，用户从 UI 输入到收到 assistant 文本全链路可用。
- replay dataset 中所有真实事故样本通过，包括 false completion、多轮上下文、输出文件缺失、manual review 语义。
- 对 task 类任务，缺少 required capability evidence 时必须失败或重试，不能完成。
- 对 chat 类任务，必须走 fast path，不能加载 task workflow 或副作用工具。
- 对 answer/tone/UI 类风险，必须通过 `liveAcceptanceOracle` 的 fail 级 checks；warning 级问题进入体验债务，不阻断 correctness gate。
- 对视觉 UI 风险，必须通过 `npm run test:e2e:assistant-ui:visual`；更新截图基线只能使用 `npm run test:e2e:assistant-ui:visual:update` 并人工审查 diff。当前门禁覆盖 11 个状态，包括 negative-state UI（thinking/failure/suspended/approval）和 completion-oriented dense/真实 DB replay timeline。所有 completion-oriented 截图必须检测到 `finished`。

本轮实际执行结果：

- `npm run test:real-model-smoke`: 通过，使用 `openai/gpt-5.3-codex` via `llm-config.json(aiberm)`。
- `npm run test:regression:core-full:live`: 通过，包含 provider preflight、sidecar live model smoke、desktop UI live user input。

## 扩充后的真实 DB Replay 覆盖

`sidecar/tests/fixtures/real-session-replay-cases.json` 已从 3 条扩充到 7 条，覆盖：

- `thread-eml-004`: 邮件分类输出文件假完成。
- `thread-web-004`: 表单字段输出文件假完成。
- `thread-fin-008`: WACC 当前市场数据 + JSON 输出假完成。
- `thread-doc-004`: 多轮 regex replace 输出文件循环失败。
- `thread-comm-004`: 多轮 chat log stats 输出文件循环失败。
- `thread-code-001`: 多轮代码/测试产物假完成。
- `thread-edu-001`: `needs manual review` 占位任务不能走普通 chat，也不能静默完成，必须进入 task draft/manual action 语义。

这些 replay 现在同时校验三类风险：

- 多轮上下文下 task contract 是否仍保留 required evidence。
- 慢响应/反复 retry 后是否会把文本当成完成。
- chat/task/manual-review 路由是否会误判。

## 真实 DB UI Timeline Replay 覆盖

为继续扩充“人工验收不通过但自动测试通过”的 UI timeline 样本，本轮新增 `sidecar/tests/fixtures/real-ui-timeline-replay-cases.json`。它从 `.coworkany/data/coworkany.db:mastra_messages` 固化三类真实线程统计和对应 TaskEvent seed：

- `thread-doc-004`: 52 条消息，17 个 user turn，35 个 assistant turn，跨度约 89 分钟，最大观测间隔 1,606,705ms。覆盖长多轮、输出契约重复、慢响应、suspended write/manual review。
- `thread-comm-004-debug-no-approval`: 8 条消息，最大观测间隔 117,265ms。覆盖慢响应 retry loop 和输出文件契约不能被文本完成绕过。
- `thread-web-004-debug-no-approval`: 14 条消息，包含 suspended write approval 分支。覆盖 manual review/approval 必须在 UI timeline 里保持阻塞可见，不能变成普通 chat completion。

新增两类验收：

1. `sidecar/tests/real-ui-timeline-db-snapshot.test.ts` 使用本地 SQLite 只读校验 fixture 的 `messageCount`、user/assistant count、first/last timestamp、duration、max gap 与真实 DB 一致。若 DB 不存在则跳过 DB snapshot 校验，但 fixture 仍可被 UI replay 使用。
2. `desktop/tests/real-ui-timeline-replay.test.ts` 直接消费该 fixture，调用 `buildTimelineItems` 与 `buildTimelineTurnRoundViewModel`，断言长多轮/慢响应/manual review 样本能渲染为可诊断 timeline：
   - task card 仍包含 `Execution profile`、`Plan`、`Execute`、必要时 `Thinking` section。
   - capability evidence 例如 `Capabilities: Workspace write, Human review` 可见。
   - slow response runtime 文案可见，但不会触发假完成。
   - completion-oriented replay 最终必须有 `TASK_FINISHED`，task card status 必须为 `finished`，所有 task items 必须进入 completed/complete/skipped/failed 终态，并清空 blocking collaboration。
   - `undefined` 与 `Task completed via Mastra runtime` 不得泄漏。

这使真实 DB 扩充流程从“只覆盖控制面 evidence”推进到“DB 统计 -> TaskEvent seed -> desktop timeline projection -> UI 可诊断性断言”。

本轮继续把三条 DB-derived UI timeline replay 接入 Playwright screenshot gate：

- `assistant-ui-real-db-thread-doc-004-long-multiturn-ui-timeline-darwin.png`
- `assistant-ui-real-db-thread-comm-004-debug-no-approval-slow-response-ui-timeline-darwin.png`
- `assistant-ui-real-db-thread-web-004-debug-no-approval-manual-approval-ui-timeline-darwin.png`

每个截图 case 都复用 `real-ui-timeline-replay-cases.json`。根因排查发现，上一版截图 fixture 只验证“可诊断阻塞态”，没有追加 `TASK_FINISHED`，因此截图中的真实 DB replay 任务都不是完整完成态。修复后：

- 三条真实 DB replay fixture 的 session status 均为 `finished`，事件流末尾均追加 `TASK_FINISHED`。
- `desktop/tests/real-ui-timeline-replay.test.ts` 断言 task card status 为 `finished`、task items 全部终态、blocking collaboration 已清空。
- Playwright 截图前断言最终 summary 和 `task status finished` 可见，并继续拒绝 `undefined` 和假完成文案。
- failure/configuration-required/suspended 截图仍保留为负向状态验收，不作为完成态任务验收。

这补齐了“真实 DB replay 只验证 projection，不验证像素级 UI”和“completion-oriented 截图未检测 finished”的剩余风险。

## 最新真实会话修复：失败命令后的第二轮 Agent Loop

2026-04-27 检查 `.coworkany/data/coworkany.db` 最新会话时发现新风险：

- 任务：用户要求“把附件图片合并为一个视频，每张图片播放 5s”。
- 第一轮工具执行失败：`ffmpeg` 参数写成 `-framerate1/5`，stderr 返回 `Unrecognized option 'framerate1/5'`，exit code 为 8。
- 模型随后正确识别了错误原因，但输出“回复我继续/请确认我继续直接执行”，没有直接执行修正后的 `ffmpeg -framerate 1/5 ...`。
- completion checker 已给出 `Overall: NOT COMPLETE`，但 `supervisor` / `supervisorSolo` 的 `onIterationComplete` 只看到“有文本且无 pending tool calls”，于是返回 `continue:false` 和 `Answer is already complete with no pending tool calls. Stop iteration.`，提前截断了第二轮 agent loop。

修复后的规则：

1. 普通完整回答仍可在无 tool call 时停止。
2. 若文本同时包含命令/工具失败信号、修复/重试动作，以及请求用户确认继续的语义，则不能停止。
3. runtime 必须返回 `continue:true`，并把上一轮失败信息注入下一轮反馈：导入失败命令、stderr/错误原因，立即执行修正后的 retry command，验证输出 artifact，再报告最终状态。
4. “已完成。如果你愿意我可以继续监控”这类完成后的可选 follow-up 仍保持停止，避免把正常 chat 变成无限循环。

自动验收已新增到 `sidecar/tests/phase3-agent-loop.test.ts`：

- `supervisor iteration policy continues after command failure repair prompt`
- `supervisor solo iteration policy continues after command failure repair prompt`
- `supervisor iteration policy still stops for completed optional follow-up offers`

该风险的判断标准从人工观察升级为单测门禁：任何“首轮命令失败后请求用户确认继续”的输出，都必须启动下一轮 agent loop，而不是直接结束任务。

随后将该真实 DB 会话进一步固化为完整 replay fixture：`sidecar/tests/fixtures/real-agent-loop-replay-cases.json` 记录原始线程、auto-approval recovery 线程、失败命令 `-framerate1/5`、stderr、第一轮错误文本、修正命令片段和期望完成事件。`sidecar/tests/mastra-entrypoint.test.ts` 新增入口层验收 `real DB replay runs second loop after ffmpeg command failure and emits TASK_FINISHED`，先断言 iteration policy 会把第一轮错误导入第二轮，再通过 `start_task` 路径模拟第二轮实际流：修正后的 `ffmpeg -framerate 1/5` command result、视频产物 `artifact_write` 证据、assistant summary、`complete`。入口层必须最终发出大写协议事件 `TASK_FINISHED`，且不能出现 `TASK_FAILED`。

该 fixture 还锁定一个额外风险：视频合成任务会推导出 `command_execution` 与 `artifact_write` 双能力要求，只有 command 执行成功不足以完成验收；必须同时有输出产物落盘/写入证据，才能允许 `TASK_FINISHED`。

继续检查最新真实 DB 会话时发现该风险仍有一个变体：模型不再只说“请确认继续”，而是在失败后把正确 `ffmpeg` 命令贴给用户，要求用户“直接用这条正确命令执行”。这仍然违反 CoworkAny 的执行契约：除登录、密码、验证码、系统授权、人工审核等真实人工协助外，本地命令必须由 CoworkAny 自己通过工具执行并验证。

补充规则：

1. 若 assistant 文本包含失败信号、修复/重试语义，并把 automatable local command 委托给用户手动执行，则 `onIterationComplete` 必须返回 `continue:true`。
2. 即使没有显式失败信号，只要 task-mode assistant 把可自动执行的本地命令写成“在终端执行/运行以下命令/直接用这条命令执行”，也不能停止；必须继续并通过工具执行。
3. `sudo` 密码、登录、验证码、外部授权、人工审核等真实人工协助仍允许进入用户协作分支，不强行自动执行。

新增回归覆盖：

- `supervisor iteration policy continues when failed command is delegated to user manually`
- `supervisor iteration policy continues when automatable command is delegated without tool execution`
- `supervisor iteration policy allows necessary human-assisted sudo command guidance`
- `real-agent-loop-replay-cases.json` 追加 `manualExecutionAssistantText`，固化 `2026-04-27T01:20:13.742Z` 最新 DB 文本。

继续检查 `2026-04-27T02:01:42Z` 到 `2026-04-27T02:27:26Z` 的同一真实会话后，发现用户已经按提示回复“帮我执行上述指令”“执行修复版”“允许”，但每次工具实际执行的仍是旧错命令 `-framerate1/5`。根因不是用户未授权，而是 follow-up/retry 上下文只保留了短回复意图，模型从历史工具调用里继续复用了失败命令；同时 command recovery 只覆盖 command-not-found、路径重复等错误，没有把 `Unrecognized option 'framerate1/5'` 识别为可确定修复的 ffmpeg 选项和值粘连错误。

补充修复：

1. `resolveCommandRecoveryHintFromToolResult` 识别 ffmpeg `Unrecognized option 'framerate1/5'`，从失败命令生成 fallback：把 `-framerate1/5` 改为 `-framerate 1/5`。
2. retry contract 在有 fallback command 时明确注入 `Do not repeat the last failed command verbatim`，避免再次执行同一失败命令。
3. `onIterationComplete` 识别“请允许我再执行一次真正修复后的命令 / 如果你愿意 / 如果你同意”这类确认话术，并继续 agent loop；同时注入已知修复提示：不要重复 `-framerate1/5`，必须执行 `-framerate 1/5`。
4. replay fixture 追加 `followupUserMessages` 与 `permissionRepairAssistantText`，固化“用户按提示回复后仍重复旧错命令”的真实分支。

## Timeline 用户可读展示规则

真实失败会话暴露出另一个 UI 风险：原始 DB transcript、tool stderr、协议错误码、runtime event type 都不应直接成为用户时间线文案。时间线必须展示“用户能理解的中间过程和最终结果”，同时把原始 detail 留在结构化事件里用于调试。

已落地规则：

1. 中间过程：`RATE_LIMITED` / 自动重试类事件展示为“命令执行遇到问题，正在根据错误信息修正并重试”“任务还缺少必要的工具验证，正在补齐证据并重试”等用户可理解文案，不展示 `retryable_command_failure`、timeout stage、DNS/TTFB 等内部字段。
2. 工具卡片：命令、文件写入、搜索等工具的 args/result 会被转成“正在执行必要的本地命令”“命令执行失败，正在根据错误信息修正”“输出文件已保存”“已获取查询结果”等摘要，不直接展示 raw command、stderr、JSON result。
3. 最终结果：通用 runtime 完成文案 `Task completed via Mastra runtime.` 在 UI 里转为“任务已完成。”；具体产物路径、文件列表仍可作为 artifact/file 摘要展示。
4. 失败结果：协议错误继续通过 `taskFailureUi` 归一化为可读标题、说明和重试建议，避免泄漏 `workflow_missing_required_tool_evidence` 等 raw protocol 文本。

新增验收：

- `desktop/tests/timeline-items.test.ts` 断言 retry process 不泄漏 `retryable_command_failure`、`Timeout stage`、DNS 等内部字段，并能展示中文修正/重试说明。
- `desktop/tests/timeline-items.test.ts` 断言通用 runtime 完成文案转成“任务已完成。”。
- `desktop/tests/assistant-ui-message-adapter.test.ts` 断言 command tool 的 raw command / `Exit code` 不进入 assistant-ui structured summaries。
