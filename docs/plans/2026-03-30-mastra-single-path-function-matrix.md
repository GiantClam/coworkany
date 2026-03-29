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
- `main-mastra.ts` 装配 scheduler runtime（后台轮询执行并回流协议事件）。
- 新增回归：
  - `tests/mastra-entrypoint.test.ts`（18 通过）
  - `tests/mastra-additional-commands.test.ts`（3 通过）
  - `tests/mastra-bridge.test.ts`（4 通过）
  - `tests/mastra-scheduler-runtime.test.ts`（6 通过，含 stale-running 恢复）
  - `tests/phase6-final-validation.test.ts` 已更新单路径断言（无 legacy/compat 启动别名）。
- 门禁全绿：
  - `bun run typecheck`
  - `bun run test:mastra:phases`
  - `bun test tests/ipc-*.test.ts`
  - `bun run test:stable`

## 下一步（第二类）
- 补齐“调度 / 记忆”真实 Sidecar↔Desktop 端到端故障注入（重启恢复、连接抖动、重复命令抑制）并固化回归。
- 在单路径默认已收敛基础上，推进 legacy 删除清单与 LOC 收口。
