# CoworkAny 重构实现审计（2026-04-01）

## 1. 结论

- 结论：**未“完全实现整份重构文档”**。
- 当前状态：第 18 节补强路线中的 Batch 1-18 已大体落地并进入主流程；Phase C/D/F 已继续增强，但仍非“完全收口”。
- 风险：文档中仍有大量未勾选验收项（原 Phase 1-6 清单），且部分“目标目录结构”与当前代码不一致，易造成“已全部完成”的误判。

## 2. 主流程接入核验（已接入）

1. 主入口注入了策略、Hook、状态存储、技能提示解析：
   - [main-mastra.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/main-mastra.ts:79)
2. 入口处理器已承接策略日志/Hook 查询、rewind、resume 等命令：
   - [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts:1127)
   - [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts:1190)
   - [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts:1539)
3. 技能导入链路已接入 policy + 依赖闭包 + 环路检测：
   - [additionalCommands.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/additionalCommands.ts:83)
4. 技能启用链路已接入 policy + 依赖检查 + 环路防护：
   - [capabilities.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/handlers/capabilities.ts:371)
5. 调度链路已使用 lease lock：
   - [schedulerRuntime.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/schedulerRuntime.ts:463)

## 3. 第 18 节逐项审计（18.4）

| Phase | 条目 | 状态 | 证据 |
|---|---|---|---|
| A | 持久化 taskStates | 已实现 | [taskRuntimeStateStore.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/taskRuntimeStateStore.ts:11) |
| A | resume_interrupted_task 跨重启协议 | 已实现（当前范围） | [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts:1539) |
| A | rewind 回放入口 | 已实现 | [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts:1190) |
| B | PolicyEngine 统一判定 | 已实现 | [policyEngine.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/policyEngine.ts:43) |
| B | Hook 事件面 | 已实现（当前范围） | 已补齐 `PreCompact/PostCompact` 并接入主流程： [hookRuntime.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/hookRuntime.ts:12), [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts:1040), [streaming.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/ipc/streaming.ts:195) |
| B | 决策审计轨迹 | 已实现 | [main-mastra.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/main-mastra.ts:35), [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts:1127) |
| C | SkillStore 升级生命周期管理 | 部分实现 | 已有导入/启用/依赖/环路/策略，但非完整 marketplace 生命周期管理： [additionalCommands.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/additionalCommands.ts:83) |
| C | marketplace/依赖闭包/封禁 | 部分实现（增强） | 依赖闭包与封禁已做；并新增 trust policy + install audit + rollback（`get_marketplace_trust_policy/list_marketplace_audit_log/rollback_marketplace_install`）及全链路回归。仍缺“签名校验/发布者证明”类深度治理： [capabilities.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/handlers/capabilities.ts), [marketplaceGovernance.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/marketplaceGovernance.ts), [mastra-marketplace-governance.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/mastra-marketplace-governance.test.ts), [mastra-additional-commands.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/mastra-additional-commands.test.ts), [additional-commands-full-chain.e2e.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/additional-commands-full-chain.e2e.test.ts) |
| C | findByTrigger 纳入统一链路 | 已实现 | [main-mastra.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/main-mastra.ts:125), [skillPrompt.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/skillPrompt.ts:31) |
| D | McpConnectionManager（连接缓存/重连/动态工具） | 已实现（最小版） | [connectionManager.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/mcp/connectionManager.ts:1), [clients.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/mcp/clients.ts:1) |
| D | MCP server 审批 + scope 治理 | 已实现（当前范围） | 已有 `managed/project/user` + 审批命令，并补齐组织级 managed settings 同步/回滚编排（含 MCP server 删除恢复）与全链路回归： [security.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/mcp/security.ts:1), [clients.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/mcp/clients.ts:1), [managedSettings.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/managedSettings.ts:1), [additionalCommands.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/additionalCommands.ts:1), [mastra-managed-settings.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/mastra-managed-settings.test.ts), [additional-commands-full-chain.e2e.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/additional-commands-full-chain.e2e.test.ts) |
| D | 远程会话 + channel 事件注入 | 部分实现（增强） | 已补齐 `open/list/heartbeat/close/bind/inject/sync_remote_session`、delivery 幂等注入（`eventId`）与重放后可选 ack；并新增可配置远程会话治理（`managed` tenant 要求、tenant 隔离、`reject/takeover/takeover_if_stale` 冲突仲裁），含单测 + 全链路回归： [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts), [remoteSessionGovernance.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/remoteSessionGovernance.ts), [main-mastra.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/main-mastra.ts), [mastra-entrypoint.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/mastra-entrypoint.test.ts), [mastra-remote-session-governance.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/mastra-remote-session-governance.test.ts), [additional-commands-full-chain.e2e.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/additional-commands-full-chain.e2e.test.ts) |
| E | Mastra Memory 第一层 | 已实现 | [memory/config.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/memory/config.ts:20) |
| E | memdir 文件记忆第二层（MEMORY 索引+topic files） | 已实现（MVP） | 已有 `topic files + MEMORY.md 索引 + relevance 回补`： [contextCompression.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/contextCompression.ts:177), [contextCompression.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/contextCompression.ts:401) |
| E | 三段式上下文压缩 | 已实现（MVP） | micro + structured + file-memory recall 已在 preamble 注入： [contextCompression.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/contextCompression.ts:182) |
| F | 调度 lease lock + stale 恢复 | 已实现 | [schedulerRuntime.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/schedulerRuntime.ts:463), [schedulerLeaseLock.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/schedulerLeaseLock.ts:1) |
| F | checkpoint/suspend/resume/retry 状态机 | 部分实现（增强） | 已形成状态机 + 自动恢复编排（`recover_tasks`，支持 `auto/resume/retry + dryRun`），并对 `approval_required` 挂起任务给出跳过策略；更细粒度 checkpoint 策略仍可继续细化： [taskRuntimeState.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/taskRuntimeState.ts), [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts), [mastra-entrypoint.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/mastra-entrypoint.test.ts) |
| F | 幂等窗口 + 故障注入回归 | 部分实现（增强） | 幂等窗口与调度故障注入点（`before_run/after_running_marked/before_complete`）已实现；并补齐 forwarded command 断链可观测（orphan/duplicate response 统计、runtime snapshot 暴露）与全链路回归： [schedulerRuntime.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/schedulerRuntime.ts), [entrypoint.ts](/Users/beihuang/Documents/github/coworkany/sidecar/src/mastra/entrypoint.ts), [mastra-entrypoint.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/mastra-entrypoint.test.ts), [main-mastra-policy-gate.e2e.test.ts](/Users/beihuang/Documents/github/coworkany/sidecar/tests/main-mastra-policy-gate.e2e.test.ts) |

## 4. 文档一致性问题（与当前代码不一致）

- 目标目录结构中以下路径当前不存在：
  - `sidecar/src/mastra/tools/filesystem.ts`
  - `sidecar/src/mastra/memory/enterprise-knowledge.ts`
  - `sidecar/src/ipc/commands.ts`
- 参考位置：
  - [重构文档](/Users/beihuang/Documents/github/coworkany/docs/plans/2026-03-29-mastra-refactoring-plan.md:220)
- 建议：将“目标架构示意”与“当前已实现架构”拆成两张清单，避免验收歧义。

## 5. 验收口径建议

1. 将“整份文档完成度”拆分为两层：
   - `基础迁移 Phase 1-6`
   - `Claude 对齐补强 Phase A-F`
2. 对第 18 节使用状态枚举：
   - `implemented`
   - `partial`
   - `not-started`
3. 发布门禁前，建议继续补齐：
   - Phase C 的完整 marketplace 信任治理（签名校验/发布者证明/来源信誉评分进一步细化）
