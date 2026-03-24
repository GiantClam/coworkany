# CLI 商用小范围发布 7 天落地清单

> 适用范围：CLI / MCP / OpenCLI 能力上线前的小范围商用灰度。  
> 目标：在 7 天内完成“可控、可回滚、可追责”的发布闭环，不等同于全面 GA。

## 发布门槛（进入 Day 1 前）

- `ci.yml` 全绿。
- `CLI Commercial Gate` 全绿（见下文的 required checks）。
- macOS 目标包已具备 `Developer ID` 签名与 notarization（若对外分发）。
- 回滚版本与回滚手册已准备。

## Day 1：范围冻结与能力分级

- 冻结本次灰度范围：仅允许指定 `workspace`、指定用户组、指定能力集合。
- 对 CLI/MCP/OpenCLI 能力按风险分级：
  - `L1` 只读类（查询、list、search）
  - `L2` 可逆写入（可回滚）
  - `L3` 高风险写入（系统级、网络外发、批量变更）
- 明确本轮禁止项：默认禁止 `L3`。

验收输出：
- 灰度名单（用户、工作区、能力）
- 风险分级表（能力 -> 风险级别 -> 是否放行）

## Day 2：重复/互斥/覆盖策略固化

- 固化重复能力处理策略：
  - 同语义重复：按 `prefer_opencli | prefer_mcp | prefer_builtin` 的策略显式配置。
  - 重叠但非重复：保留多候选，启用回退。
  - 互斥能力：在运行时环境不满足时直接拒绝。
- 重点验证：
  - `tests/task-tool-resolver.test.ts`
  - `tests/capability-catalog.test.ts`

验收输出：
- 冲突策略清单
- 关键冲突 case 回归结果

## Day 3：本机命令安全边界

- 强制命令边界：
  - 命令 allowlist
  - 高危 denylist
  - 工作目录/路径边界
  - 超时与取消能力
- 重点验证：
  - `tests/command-sandbox.test.ts`
  - `tests/command-sandbox-policy.test.ts`
  - `tests/runtime-commands.test.ts`

验收输出：
- 命令安全基线（允许/拒绝规则）
- 越权与危险命令拦截测试结果

## Day 4：OpenCLI 运行面与可用性

- 验证 OpenCLI 能力发现、执行与诊断路径：
  - `check_opencli_runtime`
  - `list_opencli_capabilities`
  - `execute_opencli_capability`
- 重点验证：
  - `tests/app-management-tools.test.ts`
  - `tests/builtin-policy.test.ts`

验收输出：
- OpenCLI 最小可用清单（能力、限制、失败回退）
- 典型本机软件操作用例通过记录

## Day 5：可观测性与审计

- 发布前必须确认：
  - 关键命令执行成功率、失败率、超时率可观测。
  - 审批与拒绝事件可追踪（谁、何时、什么命令、结果）。
  - `artifacts/release-readiness/report.md` 可生成并归档。
- 运行：
  - `cd sidecar && bun run scripts/release-readiness.ts --build-desktop`

验收输出：
- readiness 报告（JSON + Markdown）
- 监控阈值与告警接收人

## Day 6：小流量灰度（5%~10%）

- 按白名单投放，观察至少 24 小时。
- 仅在以下条件满足时扩容：
  - 未授权高风险命令执行数 = 0
  - CLI 成功率 >= 98%
  - CLI 超时率 <= 2%
  - P0/P1 事故 = 0

验收输出：
- 灰度运行日报
- Go/No-Go 决策记录

## Day 7：扩容或回滚决策

- 满足阈值：扩容到下一批用户。
- 不满足阈值：回滚到上个稳定版本并冻结变更。
- 归档发布证据：
  - readiness 报告
  - canary 证据
  - 回滚演练结果

验收输出：
- 决策结论（扩容/回滚）
- 风险复盘与下一轮修复计划

## CI Gate 配置（可直接启用）

仓库已新增：
- `.github/workflows/cli-commercial-gate.yml`

建议设为分支保护必过项（main/release 分支）：
- `cli-core-gate`
- `release-readiness-gate`

`workflow_dispatch` 手动触发时可开启严格模式：
- `release_candidate = true`
- `canary_evidence_path = docs/releases/canary-evidence.template.json`（或真实证据文件）

## 建议的发布动作顺序

1. 合并通过 `CLI Commercial Gate` 的变更到 `main`。
2. 手动触发 `CLI Commercial Gate` 严格模式（带 canary 证据）。
3. 通过后再触发 `Release` 或 `Package Desktop` 工作流。
4. 小范围发包并按 Day 6 指标观测后扩容。

