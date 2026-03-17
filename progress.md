# Progress

- 2026-03-17: 建立计划文件，开始梳理 sidecar 的工具注册、调度器启动和延时执行能力缺口。
- 2026-03-17: 新增 `schedule_task` 与 `ScheduledTaskStore`，并把 `PERSONAL_TOOLS`、`KNOWLEDGE_TOOLS` 接入 sidecar 运行时工具清单。
- 2026-03-17: 在 sidecar 启动时实际启动 `HeartbeatEngine`，注册 `scheduled-task-runner` interval trigger，轮询并执行到期任务。
- 2026-03-17: 为 `start_task` / `send_task_message` 增加延时意图的确定性短路，消息发送后立即回显“已安排在 xx:xx 执行”。
- 2026-03-17: 运行 smoke test，确认即时确认、到点执行、任务完成和 `voice_speak` 播报全链路成立。
- 2026-03-17: 新建 Rust `platform_runtime` 模块，统一收拢 app dir/app data dir、sidecar entry、Python 和 Skillhub 查找、托管服务 runtime 就绪探测。
- 2026-03-17: desktop sidecar 启动后会发送 `bootstrap_runtime_context`，sidecar 已能记录 desktop 下发的 `platform/appDataDir/sidecarLaunchMode` 并用于配置路径解析。
- 2026-03-17: `platform_runtime` 进一步收口出统一 `RuntimeSnapshot`，`ipc::get_dependency_statuses` 不再手写拼装 JSON，而是统一从 snapshot 输出。
- 2026-03-17: 前端 `useDependencyManager` 已接入 `runtimeContext`，Settings/Marketplace 开始读取同一份平台快照。
