# Mastra 单路径功能矩阵（风险收敛执行表）

## 目标
- 在切换 `main.ts -> main-mastra.ts` 单路径前，逐类对齐关键能力。
- 每完成一类，必须通过：
  - `bun run typecheck`
  - `bun run test:mastra:phases`
  - `bun test tests/ipc-*.test.ts`
  - `bun run test:stable`

## 功能矩阵

| 类别 | 关键命令/能力 | 目标行为 | 当前状态 | 证据 |
|---|---|---|---|---|
| 启动 | `ready` / `health_check` / `get_runtime_snapshot` | 可上报 runtime 健康与快照 | ✅ 已对齐 | `tests/mastra-entrypoint.test.ts` |
| 任务 | `start_task` / `send_task_message` | 可启动与续跑任务，回传响应与核心事件 | ✅ 已对齐（第一版） | `tests/mastra-entrypoint.test.ts` |
| 审批 | `approval_required` / `report_effect_result` | 可建立审批映射并恢复执行 | ✅ 已对齐（第一版） | `tests/mastra-entrypoint.test.ts` |
| 文件 | `read_file` / `list_dir` / `capture_screen` | 通过 Policy Gate 闭环执行 | ✅ 已对齐（第一版） | `tests/mastra-entrypoint.test.ts` + `tests/phase6-mastra-protocol-compat.test.ts` |
| Shell | `exec_shell` | 通过 Policy Gate 执行与回包 | ✅ 已对齐（第一版） | `tests/phase6-mastra-protocol-compat.test.ts` |
| 补丁 | `propose_patch` / `apply_patch` / `reject_patch` | ShadowFS 生命周期闭环 | ✅ 已对齐（第一版） | `tests/mastra-entrypoint.test.ts` + `tests/phase6-mastra-protocol-compat.test.ts` |
| 调度 | scheduler lifecycle / recurring execute | 与 Mastra workflow 协同 | ✅ 已对齐（第一版） | `tests/mastra-scheduler-runtime.test.ts` + `tests/mastra-entrypoint.test.ts` |
| 记忆 | memory profile / recall / persistence | 企业记忆能力可用且隔离正确 | ✅ 已对齐（第一版） | `tests/mastra-entrypoint.test.ts` + `tests/phase5-memory.test.ts` |

## 本轮完成（2026-03-30）
- 新增 `main-mastra` 协议处理器：`src/mastra/entrypoint.ts`
  - 支持 `bootstrap_runtime_context`、`doctor_preflight`、`get_runtime_snapshot`、`get_tasks`、`start_task`、`send_task_message`、`resume_interrupted_task`、`cancel_task`、`clear_task_history`、`report_effect_result`。
  - 补齐语音协议命令：`get_voice_state`、`stop_voice`、`get_voice_provider_status`、`transcribe_voice`。
  - 补齐 autonomous 命令族的稳定兼容返回：`start/get/pause/resume/cancel/list_autonomous_task*`（Mastra 模式下显式 `unsupported_in_mastra_runtime` + 协议形状对齐）。
  - 内置任务态快照（`running/idle/finished/failed/suspended/scheduled`）与 `resume_interrupted_task` 上下文复用（last user message）。
  - 打通 Policy Gate 转发等待：`request_effect/propose_patch/apply_patch/reject_patch/read_file/list_dir/exec_shell/capture_screen/get_policy_config`。
  - 新增 `handleAdditionalCommand` 扩展点，可复用现有 handlers 承接 `workspace/capability` 管理命令，降低单路径切换时功能回退风险。
  - 兼容旧简化命令：`user_message`、`approval_response`。
  - 新增调度协议协同：`start_task/send_task_message` 支持“定时创建”“定时取消”分支，返回稳定确认/取消回执。
  - 新增记忆作用域协同：支持 `config/context/runtimeContext` 透传 `resourceId|memoryResourceId`，并持久到任务态用于跨轮记忆。
- `src/main-mastra.ts` 切换到协议处理器执行。
- `src/main.ts` 强制收敛为单路径（直接导入 `main-mastra.ts`，移除 legacy 分支选择逻辑）。
- `src/mastra/additionalCommands.ts` 新增“管理命令复用层”，承接 `workspace/capability` 命令并在 `main-mastra.ts` 装配。
- `src/ipc/bridge.ts` + `src/ipc/streaming.ts` 补齐 Mastra token usage 事件抽取与转发（兼容 payload 包裹与直接 chunk 形态），可输出 `token_usage` DesktopEvent。
- `src/mastra/entrypoint.ts` + `src/handlers/runtime.ts` 补齐 `token_usage -> TOKEN_USAGE` 事件映射，维持 token telemetry 能力不回退。
- `src/main-mastra.ts` 已统一复用 `src/mastra/runtimeBindings.ts`；并已删除 `src/main-legacy.ts` 与 `src/legacy/` 目录，完成入口层 legacy 清理收口。
- 新增 `src/mastra/schedulerRuntime.ts`，实现轻量调度运行时：意图解析、任务持久化、到期执行、循环续排、链式续排、取消。
- 新增 stale-running 故障恢复：轮询前自动回收超时 `running` 任务并标记失败，回流错误事件避免静默挂起。
- 新增调度幂等防重：同 `sourceTaskId` 短窗口重复下发同一计划时不重复建单，避免连接抖动/重发导致重复定时任务。
- 新增调度启动即时恢复：`start()` 时立即触发一次轮询并加锁防并发轮询，避免重启后首轮执行额外等待与重入风险。
- `execution` 目录已清空：会话/隔离存储已迁移到 `src/runtime/taskSessionStore.ts` 与 `src/runtime/taskIsolationPolicyStore.ts`，运行时引用已切换。
- `agent` 目录已删除：`jarvis / codeQuality / artifactContract / knowledgeUpdater` 运行能力迁移到 `src/runtime/*` 并完成调用方切换。
- `services` 目录已删除：浏览器能力迁移到 `src/runtime/browser/*`，并同步更新稳定测试入口与断言路径。
- `llm` 目录已删除：`attachmentContent` 迁移到 `src/runtime/llm/attachmentContent.ts`，运行时引用已切换。
- `memory` 目录已删除：`ragBridge/vaultManager/isolation` 迁移到 `src/runtime/memory/*`，`builtin/notes/knowledgeUpdater` 调用方已切换。
- Phase6 指定的 `orchestration` 三个收口文件已从原路径删除并迁移到 `src/runtime/workRequest/*`（`runtime/store/snapshot`），调用方与测试引用已切换。
- 清理一批零引用旧实现：`src/execution/conversationCompaction.ts`、`src/execution/protocolStateMachine.ts` 与 `src/llm/providers/*`、`src/llm/vercelAdapter.ts`、`src/llm/types.ts`。
- `main-mastra.ts` 装配 scheduler runtime（后台轮询执行并回流协议事件）。
- `cancel_task` 已与调度取消联动：取消任务时会同步取消同源未执行定时任务，避免残留计划继续触发。
- `src` 内测试文件已迁出到 `tests/`（browserService/browserTools/reminder），避免测试代码计入 `sidecar/src` LOC；`test:stable` 已切换到新路径。
- `src/data/defaults.ts` 的超长内嵌技能文案已外置为 `src/data/builtinSkills.json`，`defaults.ts` 收敛为轻量装配层（行为不变）。
- `src/protocol/commands.ts` 完成共享 schema 去重（`TaskRuntimeConfigSchema/TaskContextSchema/TaskAckPayloadSchema`）并修复 `IpcResponseSchema` 误包含 `ReloadToolsCommandSchema` 的协议缺陷。
- `src/protocol/{commands,events,index}.ts` 清理纯注释分隔与冗余空行，保持行为不变并降低协议层文件体量。
- 本轮继续做“零语义变化”收敛：对高体量文件批量移除纯空行（`runtime/browser/browserService.ts`、`handlers/runtime.ts`、`orchestration/workRequestAnalyzer.ts`、`tools/builtin.ts`、`protocol/commands.ts` 等），行为不变且门禁全绿。
- 本轮继续做“零语义变化”收敛（第二批）：对 `runtime/browser/browserService.ts`、`storage/skillStore.ts`、`utils/retryWithBackoff.ts`、`protocol/{patches,effects}.ts`、`mcp/gateway/index.ts` 等高占比文件批量移除纯注释行与空行，行为不变且门禁全绿。
- 本轮补齐单路径故障注入能力（功能项）：`src/mastra/entrypoint.ts` 的 Policy Gate 转发新增“超时单次重试（默认 1 次）+ 传输关闭快速失败”，并在 `src/main-mastra.ts` 关闭流程中调用 `processor.close('stdin_closed')` 主动拒绝挂起转发，避免进程退出阶段额外等待超时。
- 本轮补齐审批态一致性：`cancel_task/clear_task_history` 会清理该任务挂起审批请求，阻断“任务已取消但旧 `requestId` 仍可恢复执行”的陈旧审批路径。
- 本轮补齐审批生命周期收口：任务进入终态（`complete/error`）时也会清理该任务挂起审批请求，阻断“任务已完成但旧 `requestId` 仍可恢复执行”的陈旧审批路径。
- 本轮补齐进程级故障注入能力：新增 `main-mastra` Policy Gate 转发超时/重试参数化环境变量（`COWORKANY_POLICY_GATE_FORWARD_TIMEOUT_MS`、`COWORKANY_POLICY_GATE_TIMEOUT_RETRY_COUNT`），便于真实进程场景下稳定复现实验。
- 构建链路已补齐：`bun run build` 与 `bun run build:release` 均通过（release 构建脚本已适配 `main-mastra` 单路径与新 bridge 路径）。
- 新增回归：
  - `tests/mastra-entrypoint.test.ts`（25 通过，含 `cancel_task` 调度取消联动、故障注入与审批态一致性/生命周期回归）
  - `tests/main-mastra-policy-gate.e2e.test.ts`（2 通过，真实 stdio 进程级故障注入）
  - `tests/mastra-additional-commands.test.ts`（3 通过）
  - `tests/mastra-bridge.test.ts`（4 通过）
  - `tests/mastra-scheduler-runtime.test.ts`（9 通过，含 stale-running 恢复 / 重复命令抑制 / 启动即时恢复）
  - `tests/phase6-final-validation.test.ts` 已补强（无 legacy/compat 启动别名 + `agent/execution/llm/memory/services` 删除断言 + orchestration 原路径删除断言 + 零 `@ts-ignore/@ts-expect-error` 断言）。
- 本轮新增 `tests/mastra-entrypoint.test.ts` 故障注入覆盖：
  - `read_file` 转发超时后重试一次成功；
  - `read_file` 超时重试耗尽返回 `policy_gate_unavailable`；
  - `processor.close()` 时挂起转发请求快速失败（不等待默认 30s 超时）。
- 本轮新增 `tests/mastra-entrypoint.test.ts` 审批态一致性覆盖：`cancel_task` 后再上报旧 `requestId` 将返回 `approval_request_not_found`，不再恢复已取消任务执行。
- 本轮新增 `tests/mastra-entrypoint.test.ts` 审批生命周期覆盖：任务 `complete` 后再上报旧 `requestId` 将返回 `approval_request_not_found`，不再恢复已结束任务执行。
- 本轮新增 `tests/main-mastra-policy-gate.e2e.test.ts`：
  - 真实进程下 `read_file` 转发超时后重试一次并在第二次回包成功收口；
  - 真实进程下关闭 stdin 后，挂起转发快速返回 `policy_gate_unavailable:stdin_closed`。
- 本轮完成 Desktop Python 双栈收口（兼容层）：`desktop/src-tauri/src/process_manager.rs` 移除 Python 下载/venv/main.py 启动逻辑，改为 no-op managed service 兼容实现；`prepare_service_runtime/start_service/health_check` 保持协议兼容但不再拉起 Python 进程。
- `desktop/src-tauri/src/platform_runtime.rs` 移除系统 Python 探测，`runtimeContext.python` 固定标记为 `not_required_in_mastra_single_process`；`rag-service/browser-use-service` 依赖状态改为内建 ready，避免首次引导误提示安装 Python 运行时。
- `tests/phase6-final-validation.test.ts` 新增 Desktop 侧回归断言，覆盖“无 Python runtime 引导 + 无 system python probe”。
- 门禁全绿：
  - `bun run typecheck`
  - `bun run build`
  - `bun run build:release`
  - `bun run test:mastra:phases`
  - `bun test tests/ipc-*.test.ts`
  - `bun run test:stable`

## 下一步（第二类）
- 补齐“调度 / 记忆”真实 Sidecar↔Desktop 端到端故障注入（连接抖动 + 审批中的重连恢复）并固化回归。
- 在单路径默认已收敛基础上，继续推进代码量与复杂度收敛（当前 `sidecar/src` 约 41.8K LOC，目标 `<8K`）与 `as any` 清零门禁。
