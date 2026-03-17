# Findings

- `PERSONAL_TOOLS` 已定义，但当前未注册进 sidecar，也未加入 `getToolsForTask()`。
- `HeartbeatEngine` 有完整实现，但当前 sidecar 主流程没有真正启动它。
- 现有 `set_reminder` 只会创建一条普通 task，不会在未来自动执行复杂任务。
- 当前 desktop 日志中没有任何 `set_reminder`、`[Heartbeat]` 或 trigger fired 证据。
- 新实现的 `schedule_task` 现在会把延时任务持久化到 `scheduled-tasks.json`，并保存执行配置（如 `modelId`）。
- 真实 smoke test 中，sidecar 立即回显“已安排在 xx:xx 执行”，随后 `scheduled-task-runner` 在到点后触发执行，并调用 `voice_speak` 完成播报。
- `triggers.json` 中已可见 `scheduled-task-runner` interval trigger，`scheduled-tasks.json` 中任务状态已从 `scheduled` 变为 `completed`。
- Windows 上多数问题之所以不明显，是因为平台路径、CLI 查找和桌面壳行为此前是分散在多个文件里“碰巧能跑”；mac 迁移时这些隐式假设会同时失效。
- 现在已建立显式 `bootstrap_runtime_context` 握手，desktop 负责发现 `platform/appDataDir/python/skillhub/managedServices`，sidecar 不再只能靠本地环境变量和零散探测。
- `get_dependency_statuses` 之前在 `ipc.rs` 里临时拼装 dependency JSON；现在已收口到 `platform_runtime::build_runtime_snapshot()`，避免 UI 和后端各自维护一份依赖状态模型。
