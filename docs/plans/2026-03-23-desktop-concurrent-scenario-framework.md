# 2026-03-23 Desktop 并发任务场景测试框架

## 目标
将 CoworkAny 的 desktop 触发并发任务测试从单点 smoke 提升为可批量生成、可复用、可验证隔离性的统一场景框架，确保：
- 并发任务均可正确启动与推进
- 返回结果符合用户预期的任务路径
- 各任务上下文与事件互不干扰
- 并发压测下继续任务（Continue task）能力不退化

## 现状盘点

### 已有覆盖
- `desktop/tests/interrupted-task-resume-sidecar-smoke.test.ts`
  - 已覆盖 real sidecar + desktop bridge。
  - 已有一个并发场景：3 个长任务并发 + continue-task 恢复可用。
- `desktop/tests/system-tools-desktop-e2e.test.ts`
  - 已具备数据驱动场景生成模式（`buildScenarios + for-loop test`）。

### 主要缺口
- 并发场景是硬编码单用例，缺乏统一 scenario schema。
- 并发无串扰校验不足，缺少任务级 marker 隔离断言。
- 没有批量并发矩阵（不同并发度/语义模板）回归能力。

## 统一框架设计

### 场景定义（Scenario Definition）
统一结构：
- `id`: 场景标识
- `concurrency`: 并发任务数
- `expectedToolName`: 预期关键工具（例如 `list_dir`）
- `buildQuery({ index, marker })`: 任务查询模板生成器

### 任务输入生成（Batch Generator）
`buildConcurrentTaskInputs(...)` 负责：
- 批量生成 task inputs
- 为每个任务注入唯一 marker
- 构建 task title/userQuery/workspacePath

### 场景执行器（Runner）
`waitForConcurrentScenarioReadiness(...)` 统一等待并断言每个任务达到关键状态：
- `TASK_STARTED`
- `PLAN_UPDATED`（含 in-progress）
- `TOOL_CALL`（命中预期工具）
- 无 `TASK_FAILED`
- 进入 `request_effect` 的 `awaiting_confirmation`

### 隔离断言（Isolation Asserts）
`assertNoCrossTaskMarkerInterference(...)` 验证：
- 每个任务的 `TASK_STARTED.description` 包含自己的 marker
- 不包含其它并发任务 marker

### Desktop 恢复兼容断言
每个并发场景额外验证：
- Continue task 按钮仍可触发 `resume_interrupted_task`
- 返回 `success: true`, taskId 指向被恢复任务

## 批量场景矩阵（首批）
- `triple-host-scan`（3 并发）
- `quad-host-scan-stress`（4 并发）

## 验收标准
- 场景批次全部通过
- 每个并发任务无失败事件
- 每个并发任务具备独立 marker，且无交叉污染
- continue-task 恢复链路在并发压力下正常

## 执行顺序
1. 跑并发批次场景（快速验证新框架）
2. 跑 `interrupted-task-resume-sidecar-smoke` 全量回归
3. 输出通过证据与风险说明
