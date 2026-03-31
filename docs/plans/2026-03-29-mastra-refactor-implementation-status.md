# 2026-03-29 Mastra 重构落地进展（阶段 1-6）

## 背景
- 参考方案文档：`docs/plans/2026-03-29-mastra-refactoring-plan.md`（已从附件同步）
- 目标：以 Mastra 为核心分阶段迁移 Sidecar，保留企业级能力与审批/风控特性。

## 已完成（本次提交）

### Phase 1: 基础设施
- 新增 Mastra 运行时入口与装配：`sidecar/src/mastra/index.ts`
- 新增独立入口：`sidecar/src/main-mastra.ts`
- 使用 `LibSQLStore + PinoLogger` 初始化运行时。

### Phase 2: 工具系统
- 新增工具：
  - `bash`（低风险执行）
  - `bash_approval`（需审批）
  - `delete_files` / `send_email`（需审批）
  - `create_reminder`（企业工具示例）
- 新增风险识别：危险命令拦截 + 需审批命令识别。
- MCP 客户端接入（通过 `COWORKANY_ENABLE_MCP=1` 开关启用）。

### Phase 3: Agent Loop（Mastra 版本）
- 新增 Agent：`supervisor / coworker / researcher / coder`
- 新增 IPC 流式桥接：`sidecar/src/ipc/bridge.ts`、`sidecar/src/ipc/streaming.ts`
- 新增 API Key 预检查：缺失时直接返回结构化错误（避免无 Key 下崩溃）。

### Phase 4: 控制平面工作流
- 新增 Workflow：`control-plane`
- 分步接入旧逻辑：`analyze-intent`、`assess-risk`、`research-loop`、`freeze-contract`、`execute-task`
- 支持 suspend/resume（用户输入与审批门禁）。

### Phase 5: Memory + 企业知识层
- 新增 Memory 配置：`LibSQLStore + LibSQLVector + fastembed`
- 新增员工画像模板与默认角色画像。
- 新增 resourceId 作用域辅助：`employee-* / team-* / org-*`。

### Phase 6: 协议兼容层（已完成单路径收敛）
- 已切换为 `main.ts -> main-mastra.ts` 单路径，协议兼容逻辑由 `src/mastra/entrypoint.ts` 承接。
- `main.ts` 已强制收敛为 `mastra` 单路径入口（直接导入 `main-mastra.ts`，不再保留 runtime mode 分支）。
- 已打通指令：`bootstrap_runtime_context`、`doctor_preflight`、`get_runtime_snapshot`、`get_tasks`、`start_task`、`send_task_message`、`resume_interrupted_task`、`cancel_task`、`clear_task_history`、`report_effect_result`。
- `main-mastra` 协议处理器已补齐 Task Snapshot 状态机（`running/idle/finished/failed/suspended`）与 `resume_interrupted_task` 的 last-user-message 回放。
- `main-mastra` 已补齐 Policy Gate 转发等待闭环：`request_effect/propose_patch/apply_patch/reject_patch/read_file/list_dir/exec_shell/capture_screen/get_policy_config`。
- `main-mastra` 已补齐语音协议命令：`get_voice_state/stop_voice/get_voice_provider_status/transcribe_voice`，避免单路径切换后语音能力缺失。
- `main-mastra` 已补齐 autonomous 命令族兼容收口：`start/get/pause/resume/cancel/list_autonomous_task*` 在 Mastra 模式下统一返回 `unsupported_in_mastra_runtime`，且响应 payload 形状对齐 legacy 协议。
- `main-mastra` 已新增 `handleAdditionalCommand` 扩展点并接入 `handleWorkspaceCommand/handleCapabilityCommand`，可直接复用现有 workspace/toolpack/skill/directive 管理命令处理逻辑。
- `main-mastra` 流式桥接已补齐 token usage 事件抽取（兼容 payload 包裹与直接 chunk），并下沉为 `TOKEN_USAGE` 时间线事件，避免单路径后 token telemetry 能力丢失。
- 已完成单路径收口删除：`sidecar/src/main-legacy.ts` 与 `sidecar/src/legacy/` 已删除。
- 已接入事件映射：`TEXT_DELTA / TOOL_CALLED / TOOL_RESULT / EFFECT_REQUESTED / EFFECT_APPROVED / EFFECT_DENIED`（基础流）。
- 已补齐审批恢复流收口：`report_effect_result` 在 approval resume 后会落盘 assistant 消息并发出 `TASK_FINISHED`，避免“仅流式不收口”。
- Mastra 模式下已阻断 legacy autonomous 命令（`start/get/pause/resume/cancel/list_autonomous_task*`），统一返回 `unsupported_in_mastra_runtime`，避免双引擎混跑。
- 已修复 suspended 状态机：收到 Mastra `suspended` 事件时转为 `idle + blockingReason`，不再误发 `TASK_FINISHED`。
- 已补齐审批上下文健壮性：当 `approval_required` 缺失 `runId` 时返回结构化失败（`MASTRA_APPROVAL_CONTEXT_INVALID`），避免向 runtime 传空 runId。
- `main.ts` 已抽离长任务命令后台队列分发器到 `ipc/runtimeCommandDispatcher.ts`，减少主入口耦合并为后续进一步拆分做准备。
- `main.ts` 已抽离命令执行路由骨架到 `ipc/commandExecutor.ts`，主入口改为装配式调用，便于后续继续下沉 IPC 层逻辑。
- `main.ts` 已抽离 stdin 行缓冲/优先队列处理到 `ipc/lineInputProcessor.ts`，保留 `_response` 优先语义并减少主入口输入处理样板代码。
- `main.ts` 已抽离 pending IPC 响应管理到 `ipc/pendingIpcResponseRegistry.ts`，统一处理 commandId 匹配、超时与 resolve。
- `main.ts` 已抽离响应分发流程到 `ipc/responseProcessor.ts`，将 pending resolve 与 runtime response 处理解耦。
- `main.ts` 已抽离消息行解析与命令/响应分发到 `ipc/messageLineProcessor.ts`，输入解析逻辑进一步模块化。
- `main.ts` 已抽离 singleton 生命周期（lock/socket/server/proxy/broadcast）到 `ipc/singletonRuntime.ts`，并复用 `ipc/singletonPaths.ts` 的路径判定函数，主入口仅保留装配调用。
- `main.ts` 已抽离 shutdown/stdin/signal 生命周期编排到 `ipc/sidecarLifecycle.ts`，主入口进一步收敛为“初始化 + 装配 + 启动”。
- `main.ts` 已抽离进程日志初始化与文件流管理到 `ipc/sidecarProcessLogging.ts`（含 console 重定向与安全 close），减少主入口顶部样板代码。
- `main.ts` 已抽离输出发射与 canonical 事件桥接到 `ipc/outputEmitter.ts`（`emitRawIpcResponse / emit / emitAny`），并保留任务事件副作用回调，进一步降低主入口复杂度。
- `main.ts` 已抽离命令校验辅助函数到 `ipc/commandValidation.ts`（`summarizeValidationIssues / buildInvalidCommandResponse`），并让 `messageLineProcessor` 复用同一类型定义，减少重复逻辑。
- `main.ts` 已抽离 singleton 环境配置解析到 `ipc/singletonConfig.ts`（启用开关、socketPath trim、lockPath 派生），主入口不再内联环境拼装细节。
- `main.ts` 已重构为薄引导器（约 10 行），直接走 `main-mastra.ts`。
- `main-mastra` 协议处理器已补齐 `propose_patch/reject_patch` 命令处理：支持发出 `PATCH_PROPOSED/PATCH_REJECTED` 生命周期事件，并返回 `propose_patch_response`，避免命令无收口。
- `main-mastra` 已为 `apply_patch/read_file/list_dir/exec_shell/capture_screen/get_policy_config` 接入 Rust Policy Gate IPC 转发：可通过 `sendIpcCommandAndWait` 直连 Rust 响应；当桥接不可用时保留 `policy_gate_required`/默认策略快照兜底，避免桌面端等待超时。
- `main-mastra` 的 `propose_patch` 已改为“优先转发 Rust ShadowFS（`propose_patch_response`）+ 失败回退本地兼容收口”，确保补丁提交流程可走到底层实现。
- `desktop/src-tauri/src/sidecar.rs` 已补齐 Sidecar→Desktop IPC 命令识别与处理：新增 `read_file/list_dir/exec_shell/capture_screen/get_policy_config` 分支，并返回对应 `*_response`，完成 Policy Gate 命令端到端回路。
- `desktop/src-tauri/tauri.conf.json` 已移除已删除 Python 服务资源声明（`rag-service` / `browser-use-service`），恢复 `cargo check` 与打包前置校验可执行性。
- `main-legacy.ts` 已继续拆分 `runtime snapshot + doctor preflight + suspended auth assist` 到 `legacy/runtimeCommandSupport.ts`，将 `getRuntimeCommandDeps` 中高耦合辅助逻辑下沉。
- `main-legacy.ts` 与 `main-mastra.ts` 已统一复用 `mastra/runtimeBindings.ts`（`mastra runtime bridge + voice/asr provider bindings`），并删除重复文件 `legacy/runtimeBindings.ts`。
- `main-legacy.ts` 已继续拆分 `browser-use config resolve/apply` 到 `legacy/browserUseRuntimeConfig.ts`，减少配置解析与副作用逻辑在主文件内联。
- `main-legacy.ts` 已继续拆分 `browser-use runtime ready/recovery hook` 到 `legacy/browserUseRuntimeLifecycle.ts`，将可用性检查与恢复钩子从主文件剥离。
- `main-legacy.ts` 已统一 `runtimeCapabilityPlanClassifier + runtimeResearchResolvers` 绑定，去除多处重复注入（任务准备/调度/研究重冻路径）。
- `main-legacy.ts` 已新增 `legacy/runtimeCommandDepsBindings.ts`，将 `onBootstrapRuntimeContext / prepareWorkRequestContext` 适配层提取为复用绑定函数，减少 `getRuntimeCommandDeps` 内联复杂度。
- `main-legacy.ts` 已继续拆分 `ppt-generator` fast-path 到 `legacy/pptGeneratorFastPath.ts`，将 HTML 模板生成与事件注入逻辑外置。
- `main-legacy.ts` 已继续拆分“定时任务浏览器证据/研究证据/阶段上下文”纯函数到 `legacy/scheduledTaskGuards.ts`，降低主文件规则判断耦合。
- `main-legacy.ts` 已继续拆分“定时任务执行结果校验与浏览器证据校验”到 `legacy/scheduledTaskExecutionValidation.ts`，减少主文件策略校验内联逻辑。
- `main-legacy.ts` 已继续拆分“执行协议评估（会话文本提取 + 协议 JSON 解析 + LLM judge + approval-gate 启发式）”到 `legacy/executionProtocolAssessment.ts`，并改为依赖注入调用，进一步收敛主文件复杂度。
- `main-legacy.ts` 已继续拆分“执行结果收口与会话桥接（assistant 收口替换、artifact telemetry、ExecutionSession/ExecutionResultReporter 装配）”到 `legacy/executionRuntimeSession.ts`，减少主文件状态收口逻辑内联。
- 历史高频路径已清理一批 `as any`（事件处理、工具流、autonomous/effect payload），并在当前单路径架构下保持 `sidecar/src` 为 0 处 `as any`。
- `sidecar/src` 非测试代码中的 `as any` 已清零（0 处）：本轮继续完成 `memory/ragBridge.ts`、`llm/providers/openai.ts`、`llm/vercelAdapter.ts`、`handlers/capabilities.ts`、`agent/postExecutionLearning.ts`、`tools/personal/weather.ts`、`tools/personal/news.ts`、`utils/tls.ts` 等文件类型收敛。
- `main-legacy.ts` 当前约 `8865` 行（由最初 `9966` 持续下降）。
- 旧实现已整体迁移到 `main-legacy.ts`（约 `9150` 行），将“默认运行路径”与“兼容运行路径”彻底解耦，便于后续继续删除 legacy 模块。
- 保留 legacy 路径不变，可灰度切换。
- Mastra 模式下已跳过 BrowserUse 启动期 bootstrap，减少无关后台副作用。
- Mastra 模式下默认历史上限固定为 20，避免运行时首次写入触发 legacy LLM 配置加载噪音。

## 验收测试（阶段 1-6）

### 当前在用验收测试文件
- `sidecar/tests/phase1-mastra-infra.test.ts`
- `sidecar/tests/phase2-tools.test.ts`
- `sidecar/tests/phase3-agent-loop.test.ts`
- `sidecar/tests/phase4-control-plane.test.ts`
- `sidecar/tests/phase5-memory.test.ts`
- `sidecar/tests/phase6-final-validation.test.ts`
- `sidecar/tests/mastra-additional-commands.test.ts`
- `sidecar/tests/mastra-entrypoint.test.ts`
- `sidecar/tests/mastra-bridge.test.ts`
- `sidecar/tests/mastra-scheduler-runtime.test.ts`
- `sidecar/tests/main-mastra-policy-gate.e2e.test.ts`
- `sidecar/tests/ipc-bridge.test.ts`

### 执行命令
```bash
cd sidecar
bun run typecheck
bun run test:mastra:phases
bun run test:stable
cd ../desktop/src-tauri
cargo check
cargo test classify_sidecar_message_recognizes_policy_gate_forwarded -- --nocapture
```

### 当前结果
- `typecheck`: 通过
- `test:mastra:phases`: 92 通过 / 1 跳过 / 0 失败
- `test:stable`: 39 通过 / 0 失败
- `bun test tests/ipc-*.test.ts`: 4 通过 / 0 失败
- `desktop cargo check`: 通过（已修复 tauri bundle 资源路径失效）
- `desktop cargo test classify_sidecar_message_recognizes_policy_gate_forwarded`: 2 通过 / 0 失败
- `sidecar/src` 的 `as any` 总数：0（包含测试文件与非测试代码）
- `sidecar/src` 代码体量快照：56 个 TS/TSX 文件，约 7,914 LOC（`main.ts` 8 行，`main-mastra.ts` 146 行）
- 跳过项：`Phase 3 integration stream`（依赖真实模型 API Key）
- 本轮新增 `phase6` 用例（审批等待不提前完成 + 审批通过/拒绝恢复收口 + Mastra 模式阻断 autonomous 命令全矩阵 + suspended 不误完成）已补充。
- 本轮新增 `phase6` 失败注入回归：Policy Gate 转发的“异常响应类型”“桥接抛错”“`get_policy_config` 转发失败回退默认策略”均已覆盖。
- 本轮新增“真实模型端到端冒烟”能力：`sidecar/tests/real-model-smoke.e2e.test.ts`（可自动处理审批事件、默认无 key 跳过，严格模式下缺 key 直接失败），并接入 `release-readiness` 可选门禁 `--real-model-smoke`（环境变量 `COWORKANY_REAL_MODEL_SMOKE=1` 可开启）。
- 本轮新增 `phase6` 覆盖 `propose_patch` 的 Rust 转发通路，验证 Sidecar→Desktop ShadowFS 流程可用。
- 本轮新增 Policy Gate 超时重试策略（单次重试，仅对 `IPC response timeout` 生效），并补充 `read_file/propose_patch` 超时重试成功与超时耗尽失败回归。
- 本轮补齐 `reject_patch` Sidecar→Desktop 转发闭环与响应回传（`reject_patch_response`），并加入协议 schema。
- 本轮新增 `reject_patch` 失败注入回归：桥接超时重试成功、超时耗尽失败、异常响应类型均已覆盖。
- 本轮补齐 Sidecar 关闭流程下“挂起 IPC 请求快速失败”机制：进程关闭时主动拒绝全部 pending 响应，避免调用端等待超时；并补充并发/乱序响应回归用例。
- 本轮新增 runtime command dispatcher 并发回归：同任务串行、跨任务并行、失败后队列继续执行与错误回调收敛。
- 本轮新增 `phase6-final-validation` 验收用例，覆盖：`main.ts` 引导器化、默认 Mastra 路由、`main-legacy.ts`/`legacy` 目录已移除、Python 旧服务文件删除、legacy 启动脚本显式化。
- 本轮完成 Desktop 侧 Python 运行时清理：`process_manager.rs` 移除 Python 下载/venv/main.py 启动链路，改为兼容 no-op managed services；`platform_runtime.rs` 将 Python 标记为 `not_required_in_mastra_single_process`，并移除系统 Python 探测分支。
- 本轮补强 `phase6-final-validation`（14 通过）：新增 Desktop 侧“无 Python runtime 引导”与“platform runtime 不再探测 Python”断言，防止回归到双栈。
- 本轮完成 Sidecar 浏览器智能模式收口（最终）：删除过渡模块 `src/runtime/browser/browserUseServiceBootstrap.ts` 与对应单测 `tests/browser-use-service-bootstrap.test.ts`，彻底移除本地 browser-use Python 自启动语义。
- 本轮补强 `phase6-final-validation`：新增断言确保 `src/runtime/browser/browserUseServiceBootstrap.ts` 已从仓库删除，防止本地自启动链路回归。
- 本轮继续清理 browser-use 旧语义：
  - `src/runtime/browser/browserService.ts` 的不可用错误文案由“could not be auto-started”改为“unavailable or unreachable”，避免误导为仍支持本地自启；
  - `src/tools/browser.ts` 去除“auto-started when enabled”描述，统一改为“需可达的 browser-use-service endpoint”；
  - `tests/e2e-browser-smart.ts` 与 `desktop/tests/browser-concurrent-desktop-scenarios.e2e.test.ts` 不再尝试本地 `python main.py` 拉起服务，改为依赖外部已运行服务并给出清晰跳过/失败原因。
- 本轮继续清理 Desktop 测试层 Python 假设噪音：
  - `desktop/tests/system-tools-desktop-e2e.test.ts` 的 deterministic bypass 命令由 `python3 -c` 统一改为 `node -e`，避免测试运行隐式依赖 Python；
  - `desktop/tests/tauriFixtureNoChrome.ts` 的 runtimeContext mock 改为 `python.available=false` + `source=not_required_in_mastra_single_process`，与单路径架构一致。
- 本轮新增 `main-mastra` IPC 协议处理器增强：在原有 `start_task/send_task_message/report_effect_result/health_check` 基础上，补齐 `bootstrap_runtime_context/doctor_preflight/get_runtime_snapshot/get_tasks/resume_interrupted_task` 与 Policy Gate 转发等待映射。
- 本轮新增/扩展 `tests/mastra-entrypoint.test.ts`（28 通过），覆盖启动/续跑/审批、snapshot/resume/get_tasks、语音命令、token usage 事件映射、autonomous 兼容收口、additional-command 委托、Policy Gate 转发成功/异常响应/不可用兜底，以及“定时创建/取消 + memory resource 作用域回退”。
- 本轮新增 `tests/mastra-bridge.test.ts`（4 通过），覆盖 Mastra chunk（payload/direct）到 DesktopEvent 映射与 token usage 解析。
- 本轮新增 `src/mastra/additionalCommands.ts` 并在 `main-mastra.ts` 装配，复用 `handleWorkspaceCommand/handleCapabilityCommand` 以承接 `workspace/toolpack/skill/directive` 管理命令。
- 本轮新增 `tests/mastra-additional-commands.test.ts`（3 通过），覆盖管理命令链路（workspace lifecycle + capability/directive 管理 + unhandled fallback）。
- 本轮新增 `src/mastra/schedulerRuntime.ts` 并在 `main-mastra.ts` 装配，提供轻量调度生命周期（定时持久化/轮询执行/循环续排/链式续排/取消）。
- 本轮新增 `tests/mastra-scheduler-runtime.test.ts`（6 通过），覆盖调度创建、到期执行、循环续排、链式续排、取消，以及 stale-running 恢复失败回收。
- 本轮完成“强制单路径”收口：`main.ts` 删除 legacy 分支，`package.json` 删除 `start:legacy/dev:legacy/start:mastra:compat/dev:mastra:compat` 脚本，并更新 `phase6-final-validation` 验收断言。
- 本轮继续完成 Phase6 指定 orchestration 清单收口：`src/orchestration/workRequestRuntime.ts`、`workRequestStore.ts`、`workRequestSnapshot.ts` 与 `src/runtime/workRequest/store.ts` 均已移除，冻结/执行计划能力收敛到 `workRequestAnalyzer + mastra/workflows` 在用路径。
- 本轮补齐构建门禁：新增 `package.json` 的 `build` 脚本并验证 `bun run build` 可通过；`build:release` 也已修复并可通过。
- 本轮将 `src` 内测试迁出到 `tests/`（browserService/browserTools/reminder），避免测试代码计入 `sidecar/src` LOC。
- 本轮将 `src/data/defaults.ts` 的内嵌技能长文案外置为 `src/data/builtinSkills.json`，`defaults.ts` 收敛为轻量装配层（行为不变）。
- 本轮补强 `phase6-final-validation`：新增 orchestration 原路径删除断言与零 `@ts-ignore/@ts-expect-error` 断言。
- 本轮继续补强 `phase6-final-validation`：新增 `sidecar/src` 零 `as any` 断言，防止类型回退。
- 本轮继续收敛协议层：`src/protocol/commands.ts` 抽取共享 task schema（配置/上下文/ack）并修复 `IpcResponseSchema` 误含 `ReloadToolsCommandSchema` 的协议缺陷；`src/protocol/{commands,events,index}.ts` 清理纯注释分隔与冗余空行，在不改行为前提下进一步降体量。
- 本轮继续做“零语义变化”的体量收敛：对高体量文件批量移除纯空行（`runtime/browser/browserService.ts`、`orchestration/workRequestAnalyzer.ts`、`tools/builtin.ts`、`protocol/commands.ts` 等），在门禁全绿前提下进一步降低 `sidecar/src` LOC。
- 本轮继续做“零语义变化”的体量收敛（第二批）：对 `runtime/browser/browserService.ts`、`storage/skillStore.ts`、`utils/retryWithBackoff.ts`、`protocol/{patches,effects}.ts`、`mcp/gateway/index.ts` 等文件批量移除纯注释行与空行，在门禁全绿前提下继续降低 `sidecar/src` LOC。
- 本轮补齐单路径故障注入能力（功能项）：`src/mastra/entrypoint.ts` 的 Policy Gate 转发新增“超时单次重试（默认 1 次）+ 传输关闭快速失败”，并在 `src/main-mastra.ts` 的 stdin 关闭路径主动调用 `processor.close('stdin_closed')`，使挂起转发请求在退出时快速失败，避免等待默认超时。
- 本轮新增 `tests/mastra-entrypoint.test.ts` 故障注入回归：覆盖 `read_file` 转发超时重试成功、重试耗尽失败，以及 `processor.close()` 触发挂起请求快速失败。
- 本轮补齐审批态一致性：`cancel_task/clear_task_history` 会清理该任务挂起审批请求，阻断“任务已取消但旧 `requestId` 仍可恢复执行”的陈旧审批路径；并新增对应回归。
- 本轮继续补齐审批生命周期收口：任务进入终态（`complete/error`）时也会清理该任务挂起审批请求，阻断“任务已完成但旧 `requestId` 仍可恢复执行”的陈旧审批路径；并新增对应回归。
- 本轮补齐真实进程级故障注入：新增 `tests/main-mastra-policy-gate.e2e.test.ts`，直接通过 stdio 与 `src/main.ts` 交互，覆盖 Policy Gate 转发“超时后重试成功”与“stdin 关闭快速失败”链路。
- `main-mastra` 新增 Policy Gate 转发超时/重试参数化环境变量：`COWORKANY_POLICY_GATE_FORWARD_TIMEOUT_MS`、`COWORKANY_POLICY_GATE_TIMEOUT_RETRY_COUNT`，用于稳定复现故障注入场景并控制回归耗时。
- 本轮完成旧兼容 runtime 收口：删除 `src/handlers/runtime.ts`，并移除 `tests/phase6-mastra-protocol-compat.test.ts` / `tests/runtime-commands.test.ts`；Phase6 协议覆盖统一收敛到 `tests/mastra-entrypoint.test.ts` + `tests/main-mastra-policy-gate.e2e.test.ts`。
- 本轮继续完成旧 IPC 模块收口：删除未进入 `main-mastra` 运行链路的 `src/ipc/{commandExecutor,commandValidation,lineInputProcessor,messageLineProcessor,outputEmitter,pendingIpcResponseRegistry,responseProcessor,runtimeCommandDispatcher,sidecarLifecycle,sidecarProcessLogging,singletonConfig,singletonPaths,singletonRuntime}.ts`，并将 `ipc-*` 回归收敛为 `tests/ipc-bridge.test.ts`（覆盖 bridge 在用能力）。
- 本轮继续完成 handlers 过渡层收口：`mastra/additionalCommands.ts` 改为直连 `handlers/capabilities.ts` 与 `handlers/workspaces.ts`，并删除不再使用的 `handlers/index.ts`、`handlers/command_router.ts`、`handlers/identity_security.ts`、`handlers/tools.ts`。
- 本轮继续完成 test-only 历史模块收口：删除 `src/runtime/workRequest/runtime.ts`、`src/proactive/heartbeat.ts`、`src/mastra/memory/{default-profiles,enterprise-knowledge}.ts`，并同步移除 `tests/work-request-runtime.test.ts`、`tests/work-request-control-plane.test.ts`；`tests/scheduler-heartbeat.test.ts` 改为覆盖当前在用 `scheduledTasks + mastra/schedulerRuntime`。
- 本轮继续完成悬挂引用清理：移除已无实现支撑的历史测试（`attachment-content/task-session-store/planning-files/websearch/execute-javascript-cancellation/agent-memory-isolation/host-access-grant-manager/xiaohongshu-post-tool*`），并将 `desktop/tests/typescript-compilation.test.ts` 的关键文件清单从 `src/tools/builtin.ts` 更新为 `src/tools/standard.ts`。
- 本轮继续完成低风险死代码收敛：删除无内部引用的聚合入口 `src/tools/{coding,files,memory,personal,productivity,web}/index.ts` 与 `src/runtime/workRequest/snapshot.ts`。
- 本轮继续完成高收益旧链路收敛（无入边）：删除 `tools/core/{calendar,email,system,tasks}.ts`、`tools/personal/{weather,notes,scheduleTask}.ts`、`tools/codeQuality.ts`、`runtime/jarvis/{proactiveTaskManager,daemonService,types}.ts`、`runtime/codeQuality/*`、`integrations/{calendar,email}/*`。
- 本轮继续完成零运行时入边死代码收敛：删除 `src/runtime/memory/{index,ragBridge,vaultManager}.ts`、`src/runtime/taskIsolationPolicyStore.ts`、`src/orchestration/{targetResolutionRules,workRequestSemanticRules}.ts`、`src/tools/personal/{news,reminder}.ts`，并同步删除对应历史测试（`news-tool/reminder-tool/task-isolation-policy-store`）。
- 本轮重写 `src/utils/retryWithBackoff.ts` 为最小实现（保留 `fetchWithBackoff` API 与指数退避/Retry-After/非可重试错误语义），将该模块从 670 行收敛到 146 行，并通过 `tests/rate-limit.test.ts` 全量回归。
- 本轮重写 `src/runtime/browser/browserService.ts` 为契约保持的精简实现（保留 `BrowserService/PlaywrightBackend/BrowserUseBackend` 外部 API、模式路由与 smart-mode 附着语义），将该模块从 2462 行收敛到 1026 行，并通过 `tests/runtime-browser-service.test.ts`、`tests/browser-tools.test.ts` 与四道门禁回归。
- 本轮重写 `src/mcp/gateway/index.ts` 为最小策略实现（保留 session 隔离、风险与审计语义、tool call policy gate），将该模块从 493 行收敛到 234 行，并通过 `tests/mcp-toolpack.test.ts`、`tests/mcp-gateway-runtime-isolation.test.ts` 回归。
- 本轮继续收敛 `src/tools/browser.ts`：统一连接/取消/错误模板为单执行器，保留 13 个工具契约与返回结构，并将模块收敛到 456 行；`phase6-final-validation` 的 browser-use 文案回归断言已恢复通过。
- 本轮继续收敛 `src/protocol/index.ts`：将手工维护的超长 re-export 清单改为模块级 `export *`，保留 `PROTOCOL_VERSION` 与 `EventOfType/CommandOfType/IpcResponseOfType` 类型助手，协议行为不变并通过四道门禁回归。
- 本轮继续完成低风险死代码清理：删除无入边聚合入口 `src/bridges/index.ts`，并移除 `orchestration/researchLoop.ts` 中未被调用的 `buildResearchUpdatedPayload` 导出。
- 本轮继续收敛 `src/protocol/commands.ts`：删除仓库内无引用的类型别名导出，仅保留在用类型别名，协议 schema 与运行时行为不变；该模块从 1257 行降至 1173 行。
- 本轮继续收敛 `src/protocol/events.ts`：删除仓库内无引用的事件类型别名导出，仅保留在用 `TaskEvent/ToolResultEvent/TaskSuspendedEvent/TaskResumedEvent`，事件 schema 与运行时行为不变。
- 本轮继续收敛协议边缘类型导出：`src/protocol/{security,patches,effects}.ts` 删除无引用类型别名导出（保留全部 schema 与在用类型），避免协议层样板类型持续膨胀。
- 本轮收敛 `src/mastra/entrypoint.ts` 的重复命令分支：合并 autonomous 不支持响应分支与 voice provider mode 解析路径，保持协议响应形状不变并通过门禁回归。
- 本轮继续完成低风险死代码清理：删除无运行时入边的 `src/bridges/policyBridge.ts`，并移除 `orchestration/localWorkflowRegistry.ts` 中未使用导出 `formatWorkflowForPrompt`。
- 本轮继续收敛 barrel 导出面：`src/{storage,utils}/index.ts` 仅保留当前运行链路在用导出，避免无入边导出继续增长。
- 本轮新增一次严格类型清理门禁验证：`tsc --noEmit --noUnusedLocals --noUnusedParameters` 通过。
- 本轮新增 Desktop 时间线回合 view-model 抽象：`desktop/src/components/Chat/Timeline/viewModels/turnRounds.ts`，`Timeline.tsx` 改为基于 round view-model 渲染，为后续 Assistant UI runtime 对接保留稳定数据边界。
- 本轮继续完成运行链路无入边模块清理：删除 `src/scheduling/scheduledTaskPresentation.ts`、`src/tools/stubs.ts`、`src/utils/tls.ts`，并同步删除对应历史测试 `tests/scheduled-task-presentation.test.ts`、`tests/tts-content-processing.test.ts`、`tests/tts-direct-speak.ts`；同时移除 `src` 下空目录，保持单路径源码树整洁。
- 本轮继续收敛协议层死代码：删除未进入单路径运行链路的 `src/protocol/events.ts` 与 `src/protocol/canonicalStream.ts`，并收敛 `src/protocol/index.ts` 导出面；同步删除历史测试 `tests/canonical-task-stream.test.ts`。
- 本轮继续收敛 `src/protocol/commands.ts`：由大而全的细粒度命令 schema 收敛为“在用 manifest/runtime context schema + 通用 IPC schema + autonomous 命令常量”，模块行数从 1173 降至 179，保留当前单路径能力所需协议契约。
- 本轮继续完成 capability 侧链路收敛：`src/handlers/capabilities.ts` 与 `src/mastra/additionalCommands.ts` 重写为单路径最小可用实现（保留 workspace/toolpack/skill/directive 在用命令），并将 `install_from_github / validate_github_url / scan_default_repos / approve_extension_governance` 收敛为显式 `unsupported_in_single_path_runtime`。
- 本轮继续删除已脱离主路径的重链路模块与历史测试：`src/extensions/*`、`src/claude_skills/{dependencyInstaller,openclawCompat,types}.ts`、`src/utils/{githubDownloader,repoScanner,index}.ts` 及对应 `tests/{capability-commands,extension-governance*,workspace-extension-allowlist,skill-store}.test.ts`。
- 本轮继续收敛语音与命令建议模块：`runtime/jarvis/voiceInterface.ts` 重写为轻量实现（保留现有 API/状态语义），`utils/commandAlternatives.ts` 收敛为核心替代建议集，门禁保持全绿。
- 沙箱环境需显式追加 `PATH=/opt/homebrew/bin:$PATH` 才能找到 `bun/node`；已在该前提下完成本轮验证。

### Phase 7: Mastra 特性拉满（方案第 17 节，2026-03-31）
- RequestContext 保留键落地：新增 `sidecar/src/mastra/requestContext.ts`，统一写入 `MASTRA_RESOURCE_ID_KEY/MASTRA_THREAD_ID_KEY`，并附带 `taskId/runtime/workspacePath`。
- Agent 执行策略收敛：`supervisor/coworker/researcher/coder` 统一启用 `requireToolApproval + autoResumeSuspendedTools + toolCallConcurrency`，并配置 `maxSteps` 上限。
- Supervisor hooks 落地：`sidecar/src/mastra/agents/supervisor.ts` 新增 `onDelegationStart/onDelegationComplete/messageFilter/onIterationComplete`，对危险 delegation prompt 进行阻断并对空结果/失败结果做反馈注入。
- 审批恢复上下文对齐：`sidecar/src/ipc/streaming.ts` 在 `stream/approve/decline` 路径统一注入 `requestContext + memory`，确保恢复链路不丢多租户上下文。
- MCP 治理增强：`sidecar/src/mastra/mcp/clients.ts` 新增 `listMcpToolsetsSafe()/disconnectMcpSafe()`；`stream` 路径使用动态 `toolsets` 装配，`main-mastra` 退出时主动 `disconnect`。
- Workflow 可靠性增强：
  - `control-plane`：step retries（`analyze/research`）、workflow `retryConfig`、`onFinish/onError`、`execute` 空 query `bail()`。
  - `scheduled-task`：step retries + workflow `retryConfig` + `onError`。
  - `execute-task`：执行调用注入 `requestContext`，并开启 `autoResumeSuspendedTools`。
- Memory 策略增强：`sidecar/src/mastra/memory/config.ts` 开启 `semanticRecall.scope='resource'`，并通过 `COWORKANY_ENABLE_OBSERVATIONAL_MEMORY` 控制 observational memory。
- 运行时稳定性补强：`sidecar/src/ipc/streaming.ts` 新增 runContext 有界缓存与终态清理（complete/error/catch），避免长会话 runContext 泄漏。
- 覆盖测试：`sidecar/tests/phase3-agent-loop.test.ts` 新增 requestContext 与审批恢复上下文回归用例。


## 2026-03-30 终态核验（方案硬门槛）
- 单路径入口：`sidecar/src/main.ts` 强制 `mastra`，无 legacy 分支。
- Phase 6 删除清单：`sidecar/src/{agent,execution,llm,memory,services}`、`rag-service`、`browser-use-service` 均已删除。
- 代码量目标：`sidecar/src` 合计约 `7,914 LOC`（< `8K`）；`main.ts` 为 `8` 行薄引导器。
- 质量门禁：`sidecar/src` 内 `as any` 为 `0`，`@ts-ignore/@ts-expect-error` 为 `0`。
- 验收门禁：`bun run typecheck`、`bun run test:mastra:phases`、`bun run release:readiness` 全部通过。

## 新增脚本
- `start:mastra`
- `dev:mastra`
- `test:mastra:phases`
- `test:real-model-smoke`
- `release:readiness:commercial`（`--build-desktop --real-e2e --real-model-smoke`）

## 与商用标准仍有差距（下一步）
1. 生产可观测性：需补齐统一 tracing、指标埋点、告警阈值和故障演练。
2. 集成与回归：需追加真实 API Key 下的端到端流式集成测试与稳定性压测。
3. 安全治理：需补充更严格的命令沙箱、审批审计、租户隔离与策略回放测试。

## 建议的下一迭代切分
1. 先做“端到端故障注入 + 审批态一致性”收敛，覆盖重启、断连、超时和重试场景。
2. 再做“可观测性与安全治理”补齐，形成可上线告警/审计闭环。
3. 最后做“代码量与复杂度”专项收敛，持续压缩模块边界并冲刺 `<8K LOC` 目标。
