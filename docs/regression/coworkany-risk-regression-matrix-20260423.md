# CoworkAny Risk Regression Matrix (2026-04-23)

## Purpose
Map manual acceptance risk scenarios to deterministic automated regression suites for fast, repeatable gating.

## Acceptance Risk -> Regression Coverage

| Risk Scenario | Automated Coverage |
| --- | --- |
| TLS 无法连接 / 证书链问题 | `runtime-error-classifier.test.ts` + `task-execution-service.test.ts` + `runtime-llm-env-seed.test.ts` |
| 审批链条被打断 | `mastra-entrypoint.test.ts` (`approval_required ... resumes run`) |
| 任务失败无法重试 | `mastra-entrypoint.test.ts` (`retry_task ...` + `recover_tasks ...`) |
| tools 调用异常/无证据完成 | `mastra-entrypoint.test.ts` (`missing tool evidence`), `phase2-tools.test.ts`, `execute-task-step.test.ts` |
| 任务异常终止/挂死 | `mastra-entrypoint.test.ts` (`delegated task executor hangs ... TASK_FAILED`) |
| 思考深度不足（输出过短） | `mastra-entrypoint.test.ts` (`emits supplemental summary when task narrative is too short ...`) |
| 远程会话治理链条 | `entrypoint-remote-session-*.test.ts` + `additional-commands-full-chain.e2e.test.ts` remote-governance cases |
| Desktop 交互反馈（重试/配置动作/pending 状态） | `desktop/tests/task-retry-policy.test.ts` + `desktop/tests/task-failure-ui.test.ts` + `desktop/tests/pending-task-status.test.ts` |

## Canonical Gate Command

Run from `sidecar/`:

```bash
npm run test:risk:acceptance
```

This command is fixture-driven (`sidecar/tests/fixtures/risk-regression-suites.json`) and includes desktop replay coverage.

## Guardrail

- The gate script enforces **minimum pass count per suite**.
- If a `--test-name-pattern` accidentally matches zero tests, the gate fails explicitly.
