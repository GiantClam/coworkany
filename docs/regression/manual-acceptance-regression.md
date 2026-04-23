# 人工验收回归用例（稳定性专项）

本文将用户反馈的高频失败点映射为可执行回归用例，覆盖 TLS、审批链、重试、工具证据和异常终止。

## 场景与验收标准

1. TLS 证书链失败可被正确识别并引导配置修复
- 触发条件：上游返回 `unable to get issuer certificate` 等证书链错误。
- 验收标准：错误分类为 `configuration_required`，错误码为 `PROVIDER_TLS_TRUST_FAILURE`，前端引导进入 LLM Settings。

2. 审批链中断后任务可恢复重试
- 触发条件：任务状态为 `suspended + approval_required`，但不存在待处理审批请求。
- 验收标准：`retry_task` 可正常执行，任务进入完成态，不再被“等待审批”永久阻塞。

3. 缺少工具证据时默认自动重试
- 触发条件：任务要求工具能力（如 `web_research`），但模型仅输出文字完成。
- 验收标准：在未显式配置 `maxRetries` 时，系统默认自动重试 2 次，再给出失败结论。

4. 异常终止后可给出明确失败而非静默卡死
- 触发条件：执行链路发生终止事件缺失/工具证据不足。
- 验收标准：任务最终进入可解释失败态（含错误码/建议），不会无限挂起。

## 自动化覆盖

- `sidecar/tests/mastra-entrypoint.test.ts`
  - `start_task classifies TLS certificate trust failures as configuration-required errors`
  - `send_task_message defaults to two auto-retries for missing required tool evidence when maxRetries is not provided`
  - `retry_task can recover approval-suspended task when no pending approval request remains`
- `sidecar/tests/runtime-error-classifier.test.ts`
  - `classifies certificate chain failures as configuration-required TLS trust errors`
- `sidecar/tests/runtime-llm-env-seed.test.ts`
  - `seeds insecure TLS env when active provider enables allowInsecureTls`
- `desktop/tests/task-retry-policy.test.ts`
  - `approval-suspended session without pending effect request is not pending-approval-blocked`
- `desktop/tests/task-failure-ui.test.ts`
  - `routes provider TLS trust failures to configuration action`

## 回归执行命令

```bash
cd sidecar && bun test tests/mastra-entrypoint.test.ts -t "TLS certificate trust failures|defaults to two auto-retries|approval-suspended task"
cd sidecar && bun test tests/runtime-error-classifier.test.ts tests/runtime-llm-env-seed.test.ts
cd desktop && bun test tests/task-retry-policy.test.ts tests/task-failure-ui.test.ts
cd desktop/src-tauri && cargo test apply_llm_env_enables_insecure_tls_when_profile_requests_it --quiet
```

## 通过判定

- 上述命令全部通过。
- 关键场景均有自动化断言与可读错误码。
- 不依赖人工“碰运气重试”才能恢复任务执行。
