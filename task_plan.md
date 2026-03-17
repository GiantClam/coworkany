# Task Plan

## Goal
修复 CoworkAny 的延时执行链路，让“几分钟后执行任务并语音播报”能够真正被注册、持久化、按时触发、执行并在 UI 中立即反馈。

## Follow-up Goal
建立 desktop 与 sidecar 的跨平台统一运行时机制，收拢平台路径、sidecar 启动链路、Python/Skillhub 查找和 runtime capability 下发。

## Phases
- [completed] 1. 审查当前 sidecar 工具注册、调度器和任务执行入口
- [completed] 2. 接入 `PERSONAL_TOOLS` 并实现 `schedule_task` 工具
- [completed] 3. 在 sidecar 启动时接通 `HeartbeatEngine`，到点执行任务并调用 `voice_speak`
- [completed] 4. desktop 发送后立即回显“已安排在 xx:xx 执行”
- [completed] 5. 运行验证与日志确认

## Errors Encountered
- `voiceSpeakTool` 在调度执行分支中被引用但未导入，已补 import 并重新通过 typecheck。
- Rust `platform_runtime` 抽出后，`ipc.rs` 仍沿用旧的 `Result<bool, _>` 调用方式，已改为直接消费 `bool`。
