# Agent 系统设计

> CoworkAny 技术方案 - 详细设计文档

## 1. 架构概览

Agent 系统是 Sidecar 的核心执行引擎，负责将用户意图转化为工具调用序列并执行。

```
用户消息 → 意图分析 → 技能推荐 → ReAct 循环 → 工具调用 → 验证 → 响应
                                    ↑        ↓
                              记忆检索    自我纠正
```

## 2. ReAct 循环

### 2.1 执行流程

`agent/reactLoop.ts` 实现 Reason-Act-Observe 模式：

```typescript
// 每步包含：
interface ReActStep {
  thought: string;      // 推理过程
  action: ToolCall;     // 工具调用
  observation: string;  // 执行结果
  memoryHits?: string[]; // RAG 检索命中
}
```

**约束：**
- 每任务最多 30 步
- 每步有超时控制
- 支持中途取消（`cancel_task` 命令）

### 2.2 防无限循环

`main.ts` 中的 `runAgentLoop` 实现多层防护：

1. **重复检测：** 连续 3 次相同工具+参数组合 → 触发 AUTOPILOT 干预
2. **永久黑名单：** 被干预的工具+参数组合加入 `permanentBlockList`
3. **强制终止：** 5 次永久封禁后强制结束任务
4. **2-Action Rule：** 每 2 次工具调用后检查规划文件（Manus 风格持久化规划）

### 2.3 RAG 增强推理

ReAct 循环集成 RAG 系统：
- 每步推理前检索相关记忆
- 记忆命中结果注入上下文
- 支持跨会话知识复用

## 3. 自主代理（Autonomous Agent）

`agent/autonomousAgent.ts` 实现 OpenClaw 风格的自主执行：

### 3.1 任务分解

```
用户目标 → 子任务列表 → 优先级排序 → 逐个执行 → 目标验证
```

### 3.2 后台执行

- 任务队列持续处理
- 自动记忆提取（成功任务的工具序列）
- 目标验证（执行后检查是否达成目标）

## 4. 子系统

### 4.1 技能推荐（Skill Recommendation）

`agent/skillRecommendation/`

**IntentAnalyzer** 识别 16 种意图类型：

| 意图类型 | 触发关键词示例 |
|---------|--------------|
| bug-fix | fix, debug, error, crash |
| new-feature | add, create, implement, build |
| refactor | refactor, clean, reorganize |
| testing | test, spec, coverage |
| deployment | deploy, release, publish |
| security | security, vulnerability, auth |
| performance | optimize, slow, performance |
| documentation | document, readme, comment |
| shell-command | run, execute, install |
| browser-task | browse, scrape, automate |
| calendar | schedule, meeting, calendar |
| email | email, send, reply |
| learning | learn, research, study |
| data-analysis | analyze, chart, statistics |
| file-operation | read, write, move, copy |
| general | 其他 |

**SkillRecommender** 维护 25+ 技能数据库，根据意图匹配推荐技能。

### 4.2 代码质量（Code Quality）

`agent/codeQuality/`

**三维分析：**
- **复杂度分析：** 圈复杂度、嵌套深度、函数长度
- **安全扫描：** 硬编码密钥、SQL 注入、XSS、路径遍历
- **代码异味：** 重复代码、过长参数列表、God Class

**集成点：** 工具链中的 `check_code_quality` 步骤，质量分 < 70 阻止提交。

### 4.3 验证引擎（Verification）

`agent/verification/`

**6 种验证策略：**

| 策略 | 适用场景 |
|------|---------|
| 测试执行 | 代码修改后运行测试套件 |
| 类型检查 | TypeScript/编译型语言类型验证 |
| Lint 检查 | 代码风格和规范验证 |
| 构建验证 | 确保项目可构建 |
| 运行时验证 | 启动应用检查运行时错误 |
| 自定义验证 | 用户定义的验证命令 |

**SelfCorrectionEngine：** 验证失败时自动分析错误，生成恢复计划。

**CorrectionCoordinator：** 协调验证和纠正的循环，设置最大重试次数。

### 4.4 工具链（Tool Chains）

`agent/toolChains/`

工具链是预定义的多步工具执行序列，支持：
- 步骤间数据传递（上一步输出作为下一步输入）
- 条件执行（基于前置步骤结果）
- 错误处理和回滚
- 事件通知（chain_started, step_completed, chain_failed 等）

**内置工具链：**

| 链 ID | 步骤 | 用途 |
|-------|------|------|
| fix-bug-and-test | write_file → run_command(test) → check_quality | 修 bug 并验证 |
| create-feature-safe | write_file → write_tests → run_test → check_quality → git_commit | 安全创建功能 |
| refactor-safe | check_quality(before) → backup → write_file → run_test → check_quality(after) | 安全重构 |
| deploy-safe | run_test → build → batch_check_quality → deploy(conditional) | 安全部署 |
| morning-routine | calendar → email → news → weather → task_list | 晨间例行 |
| research-topic | crawl_url(search) → crawl_url(results) → save_to_vault | 主题研究 |
| meeting-prep | calendar → email → crawl_url(attendees) → save_to_vault | 会议准备 |
| weekly-review | calendar(week) → tasks(completed) → tasks(pending) → quick_note | 周回顾 |
| quick-fix | write_file → tsc --noEmit | 快速修复 |

### 4.5 自主学习（Self-Learning）

`agent/selfLearning/`

**6 阶段学习循环：**

```
1. Gap Detection    -- 检测能力缺口（工具失败、未知领域）
2. Research         -- 从互联网/文档研究解决方案
3. Lab Testing      -- 在沙箱中实验验证
4. Precipitation    -- 将验证通过的知识沉淀为 Vault 条目
5. Skill Generation -- 高置信度知识自动生成可复用技能
6. Confidence Track -- 持续追踪知识质量，淘汰低质量条目
```

**依赖解析：** `DEPENDENCY_RESOLUTION.md` 描述了模块间的依赖关系，使用依赖注入模式避免循环依赖。

**Adaptive Executor：** 提供重试逻辑和替代策略，工具调用失败时自动尝试替代方案。

## 5. Jarvis 个人助理

`agent/jarvis/`

Jarvis 是个人助理子系统，当前完成度：

| 模块 | 完成度 | 说明 |
|------|--------|------|
| Daemon 服务 | 90% | 后台常驻，定时任务 |
| 主动任务 | 85% | 基于上下文的主动建议 |
| NLU 引擎 | 60% | 自然语言理解，意图识别 |
| 语音接口 | 20% | 语音输入/输出（接口已定义） |

**集成点：** 日历（Google/Microsoft Graph）、邮件（IMAP/Graph）、任务管理。
