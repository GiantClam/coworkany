# 2026-03-23 Desktop 股票检索分析场景测试框架

## 目标
把 CoworkAny 当前分散的股票研究测试统一为可批量扩展的 desktop 触发场景框架，并覆盖用户要求的并行分析对象（`minimax`、`衮矿能源/兖矿能源`、`glm`、`nvidia`）。

## 一、系统任务用例盘点

### 1) Desktop 侧存量
现有股票相关测试主要集中在以下文件：
- `desktop/tests/stock-research.test.ts`
- `desktop/tests/stock-research-e2e.test.ts`
- `desktop/tests/stock-research-e2e-v2.test.ts`
- `desktop/tests/stock-research-ui.test.ts`
- `desktop/tests/stock-research-with-logs.spec.ts`
- `desktop/tests/stock-research-log-analysis.test.ts`
- `desktop/tests/stock-research-log-only.test.ts`
- `desktop/tests/stock-research-direct.test.ts`
- `desktop/tests/stock-research-manual.spec.ts`

共同特征：
- 都是 desktop 触发或近似 desktop 触发；
- 大量重复逻辑（输入框定位、日志轮询、关键词命中判断）；
- 主要验证 Cloudflare/Reddit/NVIDIA 三股，缺少可配置股票矩阵；
- 多个文件包含平台耦合路径（尤其 Windows 绝对路径），可复用性偏弱。

### 2) Sidecar 侧存量
- `sidecar/tests/stock-research.test.ts`
- `sidecar/tests/e2e-composite.test.ts`（E2E-01 股票）
- `sidecar/tests/user-scenarios.test.ts`（S6 研究与决策支持）

共同特征：
- stock-research skill 触发链路覆盖较好；
- 重点在 sidecar 流程正确性，不直接保证 desktop 输入触发链路体验。

### 3) 主要缺口
- 缺统一的 desktop 股票场景 schema 与 runner；
- 缺批量生成机制（scenario matrix）；
- 缺对“并行分析多标的 + 预测”场景的标准化校验；
- 缺统一产物目录与结果摘要结构。

## 二、统一 desktop 场景测试框架设计

新增：`desktop/tests/utils/stockScenarioFramework.ts`

### 1) 场景模型
- `StockDesktopScenario`：
  - `id`
  - `title`
  - `entities`（目标标的 + alias）
  - `horizon`
  - `focus`
  - `minSearchWebCalls`
  - `marker`

### 2) 批量生成器
- `buildStockDesktopScenarioMatrix()`：
  - 基于 `SCENARIO_BLUEPRINTS + STOCK_LIBRARY` 自动生成场景；
  - 当前内置股票实体：Cloudflare、Reddit、NVIDIA、兖矿能源(含“衮矿能源”别名)、MiniMax、GLM。

### 3) 统一 Runner
- `runStockDesktopScenario(...)`：
  - 统一 desktop 输入框探测与提交；
  - 统一 sidecar 事件解析（`Received from sidecar:`）；
  - 统一证据文本提取（`TEXT_DELTA` + `TOOL_RESULT` + `TASK_FINISHED`）；
  - 统一校验维度：
    - 提交成功
    - `search_web` 调用次数
    - 标的覆盖率
    - 投资建议关键词
    - 预测关键词
    - 完成状态（finish/ready/silence）
  - 统一外部依赖失败识别（quota/rate-limit/key 未配置等）。

## 三、批量场景用例生成

新增：`desktop/tests/stock-research-desktop-scenarios.e2e.test.ts`

批次场景：
1. `legacy-us-ai-trio`
2. `parallel-minimax-yankuang-glm-nvidia`
3. `yankuang-vs-nvidia`
4. `minimax-glm-vs-nvidia`

每个场景自动：
- 生成结构化查询（强制检索 + 买卖建议 + 走势预测 + 不确定性）；
- 执行统一 runner；
- 落盘结果到 `artifacts/stock-research-desktop-scenarios/`：
  - `stock-scenario-<id>-summary.json`
  - `stock-scenario-<id>-logs.txt`
  - `stock-scenario-<id>-final.png`

## 四、逐步跑验策略

1. 先跑编译/发现级验证（确保新框架文件与新测试文件可被 Playwright 识别）；
2. 再跑单场景 smoke（优先并行场景 `parallel-minimax-yankuang-glm-nvidia`）；
3. 最后跑整批场景；
4. 若出现外部依赖失败（API key/配额/限流），按测试内置机制标记 skip，保留日志与摘要做诊断。
