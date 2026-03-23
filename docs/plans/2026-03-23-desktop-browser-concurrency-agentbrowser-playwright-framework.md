# 2026-03-23 Desktop 并发浏览器场景框架（AgentBrowser + Playwright）

## 目标
为 CoworkAny 增加一套统一的 desktop 触发并发浏览器场景测试框架，覆盖：
- `agentbrowser`（smart 模式 + `browser_ai_action`）
- `playwright`（precise 模式 + selector/DOM 工具链）
- 登录协作（需要登录时请求用户协助，收到用户“已登录”后继续）
- 并发隔离（多任务互不干扰）

---

## 1) 任务用例盘点

### AgentBrowser 侧（smart）
1. `X`（`https://x.com/home`）  
   - 高概率登录墙场景  
   - 验证 suspend/resume 与续跑
2. `Reddit`（`https://www.reddit.com/r/artificial/`）  
   - 常规公开页面  
   - 验证 `browser_ai_action` 执行链路
3. `Xiaohongshu`（`https://www.xiaohongshu.com/explore`）  
   - 登录敏感站点  
   - 验证登录协作与续跑

### Playwright 侧（precise）
1. `X`（`https://x.com/explore`）
2. `Reddit`（`https://www.reddit.com/r/artificial/`）
3. `Xiaohongshu`（`https://www.xiaohongshu.com/explore`）

---

## 2) 统一 Desktop 场景框架设计

### 场景 Schema
- `scenario.id/title`
- `tasks[]`: `site`, `backend(agentbrowser|playwright)`, `targetUrl`, `loginSensitive`, `expectedDomains`
- 每个任务注入唯一 `marker`（用于无串扰断言）

### 执行器（Runner）
1. 通过 desktop `invoke('start_task')` 并发启动所有任务。
2. 从 `tauriLogs` 解析 Sidecar 事件流（`TASK_*`, `TOOL_CALL`, `TOOL_RESULT`, `TEXT_DELTA`）。
3. 聚合每任务状态：
   - 启动/完成/失败
   - 后端命中（smart/precise 模式、`browser_ai_action`、`browser_navigate`）
   - 目标站点命中（domain 证据）
   - 登录协作（出现账号门槛时应进入 `TASK_SUSPENDED`；若有 `TASK_RESUMED` 则继续验证 resume 后 browser 调用）
   - marker 隔离（自身 marker 存在、无 foreign marker）

### 外部依赖降级
- 识别外部失败（如 `browser-use-service unavailable`、`api key/quota/rate limit`）
- 归类为 external failure 并在测试中 `skip`，避免误报代码回归

---

## 3) 批量场景矩阵

1. `social-mixed-triple`
   - X(agentbrowser) + Reddit(playwright) + Xiaohongshu(agentbrowser)
2. `social-mixed-quad`
   - X(agentbrowser) + Reddit(agentbrowser) + Xiaohongshu(agentbrowser) + Reddit(playwright)

---

## 4) 验收标准

每个场景必须满足：
1. 并发任务全部提交成功（desktop invoke/start_task）。
2. 并发任务全部启动并无 `TASK_FAILED`。
3. backend 覆盖正确：  
   - agentbrowser 任务：`mode=smart` 且出现 `browser_ai_action`  
   - playwright 任务：`mode=precise` 且出现 precise 工具调用
4. 登录协作正确：若触发登录等待，必须出现“请求用户协助/暂停等待”证据；若出现恢复事件则需验证恢复后继续执行。
5. marker 隔离通过：任务之间无 marker 污染。

---

## 5) 产物

- 测试框架：`desktop/tests/utils/browserConcurrentScenarioFramework.ts`
- 批量场景入口：`desktop/tests/browser-concurrent-desktop-scenarios.e2e.test.ts`
- 运行产物目录：`artifacts/desktop-browser-concurrent-scenarios/`
