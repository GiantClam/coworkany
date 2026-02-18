# CoworkAny 技术方案

> 版本: 1.0 | 更新日期: 2026-02-14

## 1. 产品定位

CoworkAny 是一个基于 Tauri 的通用 AI 桌面助手，定位为"与 AI 协作完成任何任务"。核心能力覆盖个人助理（日历、邮件、任务管理）、网络自动化（浏览器操作、信息搜索）、编程开发（代码编写、质量检查、调试）和智能增强（自主学习、记忆系统）。

## 2. 系统架构

### 2.1 三层架构

```
┌─────────────────────────────────────────────────┐
│                  Desktop (Tauri)                 │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │   Rust Backend   │  │   React Frontend     │ │
│  │  - Window Mgmt   │  │  - Chat Interface    │ │
│  │  - Policy Engine │  │  - Dashboard         │ │
│  │  - Shadow FS     │  │  - Settings          │ │
│  │  - IPC Bridge    │  │  - Skill/MCP Mgmt    │ │
│  └────────┬─────────┘  └──────────┬───────────┘ │
│           │ Tauri invoke/listen   │             │
│           └───────────┬───────────┘             │
└───────────────────────┼─────────────────────────┘
                        │ JSON Lines over stdio
┌───────────────────────┼─────────────────────────┐
│              Sidecar (Bun/Node.js)              │
│  ┌─────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Agent   │ │  Tools   │ │  LLM Router      │ │
│  │  System  │ │  System  │ │  (Multi-Provider) │ │
│  ├─────────┤ ├──────────┤ ├──────────────────┤ │
│  │  Skills  │ │  MCP     │ │  Memory / RAG    │ │
│  │  System  │ │  Gateway │ │  System          │ │
│  └─────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面壳 | Tauri 2.0 (Rust) | 窗口管理、安全策略、文件系统、IPC |
| 前端 | React 18 + TypeScript + Vite 5 | SPA，多窗口路由 |
| 样式 | Tailwind CSS 4 + CSS Modules | 正在从内联样式迁移 |
| 状态管理 | Zustand 4 | 多 Store，subscribeWithSelector |
| UI 组件 | Radix UI | 无障碍 headless 组件 |
| 国际化 | react-i18next | 中英文 |
| AI 引擎 | Bun 运行时 Sidecar | 通过 stdio 与 Rust 通信 |
| LLM | Anthropic / OpenAI / OpenRouter / Ollama | 多 Provider 路由 |

### 2.3 进程通信

Desktop 与 Sidecar 之间通过 JSON Lines 协议通信：

- **Commands** (Tauri → Sidecar): `start_task`, `cancel_task`, `send_task_message`, `reload_tools`, `list_claude_skills`, `install_from_github` 等 35+ 命令
- **Events** (Sidecar → Tauri): `TASK_STARTED`, `TOOL_CALLED`, `TOOL_RESULT`, `TEXT_DELTA`, `EFFECT_REQUESTED`, `PATCH_PROPOSED` 等 20+ 事件类型
- **Effects** (双向): 所有副作用（文件写入、Shell 执行、网络请求）必须通过 PolicyBridge 审批

Sidecar 的 stdout 专用于 IPC，所有日志重定向到 stderr 和轮转日志文件。Rust 端有 watchdog 线程每 5 秒监控 Sidecar 进程，崩溃后自动重启（60 秒内最多 3 次）。

## 3. 核心子系统

### 3.1 Agent 系统

Agent 系统是 Sidecar 的核心，基于 ReAct（Reason-Act-Observe）循环实现。

**核心组件：**

| 组件 | 职责 |
|------|------|
| ReAct Loop | 推理-行动-观察循环，每任务最多 30 步 |
| Autonomous Agent | 自主任务分解、后台执行、目标验证 |
| Self-Learning | 能力缺口检测 → 研究 → 实验 → 知识沉淀 |
| Code Quality | 静态分析（复杂度、安全、代码异味） |
| Verification | 6 种验证策略的后执行验证引擎 |
| Skill Recommendation | 16 种意图类型的技能推荐 |
| Tool Chains | 预定义多步工具执行序列 |

**防无限循环机制：** 连续 3 次相同工具调用触发 AUTOPILOT 干预，工具+参数组合加入永久黑名单，5 次永久封禁后强制终止。

**详细设计见：** [Agent 系统设计](agent-system.md)

### 3.2 工具系统

工具系统采用注册表模式，支持优先级解析（MCP > 内置 > 存根）。

**工具分类：**

| 类别 | 工具 | 数量 |
|------|------|------|
| 核心 | calendar, email, system, tasks, voice | 5 |
| 编程 | read_file, write_file, search_code, run_command, check_code_quality | 5+ |
| 文件 | 文件读写、目录操作 | 3+ |
| 网络 | crawl_url, web_search, browser 自动化 | 5+ |
| 记忆 | save_to_vault, search_vault | 2+ |
| 个人 | quick_note, get_news, check_weather | 3+ |
| MCP | 动态注册的外部工具 | 不限 |

**工具链（Tool Chains）：** 预定义的多步工具执行序列，支持条件执行和错误处理。内置 9 条链：`fix-bug-and-test`, `create-feature-safe`, `deploy-safe`, `morning-routine`, `research-topic` 等。

**详细设计见：** [工具系统设计](tool-system.md)

### 3.3 技能系统（Skills）

技能是可复用的指令包，以 `SKILL.md` 文件定义，包含 YAML frontmatter 和 Markdown 指令体。

**加载流程：**
1. SkillStore 扫描 `.coworkany/skills/` 目录
2. 解析 YAML frontmatter（name, description, triggers, requires）
3. 检查工具/环境依赖
4. 注册到 `skills.json`
5. 用户消息匹配 triggers 时自动激活

**技能来源：**
- 内置技能（coding-standards, frontend-patterns, backend-patterns）
- 本地安装（`.coworkany/skills/`）
- GitHub 安装（`install_from_github` 命令）
- 自学习生成（`vault/self-learned/`）

**OpenClaw 兼容层：** `openclawCompat.ts` 支持 OpenClaw SKILL.md 格式，包括平台过滤、二进制依赖检查、自动安装器。

### 3.4 MCP Gateway

MCP（Model Context Protocol）Gateway 是外部工具集成的统一入口。

**职责：**
- MCP Server 生命周期管理（启动/停止/重启）
- 工具发现和注册到 ToolRegistry
- 策略执行（风险评分 1-10，allow/deny/warn）
- 集中认证

**存储：** `toolpacks.json` 记录已安装的 MCP 工具包，支持启用/禁用和最后使用时间追踪。

### 3.5 安全模型

安全模型贯穿整个系统，核心是 Effect-Gated Execution（副作用门控执行）。

**三层防护：**
1. **Pre-Input** - 输入检测和过滤
2. **Pre-Tool** - 工具调用前的策略审批（PolicyBridge → Rust PolicyEngine）
3. **Post-Output** - 输出检测和脱敏

**Effect 类型和风险等级：**

| Effect 类型 | 风险等级 | 默认策略 |
|-------------|---------|---------|
| filesystem_read | 2 | session |
| filesystem_write | 6 | once |
| shell_execute | 8 | once |
| network_request | 4 | session |
| code_execution | 7 | once |
| secrets_access | 9 | never |
| screen_capture | 5 | once |
| ui_control | 3 | session |

**Shadow FS：** 所有文件修改先暂存到影子文件系统，生成 diff 供用户审查，批准后才写入磁盘。

**详细设计见：** [安全模型设计](security-model.md)

### 3.6 记忆系统

**三层记忆架构：**

| 层级 | 存储 | 生命周期 |
|------|------|---------|
| 短期记忆 | 会话上下文 | 单次会话 |
| 长期记忆 | Markdown Vault + RAG 索引 | 持久化 |
| 外部记忆 | MCP 工具提供 | 按需 |

**Vault 结构：** `~/.coworkany/vault/` 下按 `projects/`, `preferences/`, `learnings/` 分类存储 Markdown 文件，自动索引到 RAG 系统。

**安全控制：** 来源标签、信任评分、PII 过滤、TTL 过期。

### 3.7 自主学习

自主学习系统实现 6 阶段循环：

```
Gap Detection → Research → Lab Testing → Knowledge Precipitation → Skill Generation → Confidence Tracking
```

**触发条件：** 检测到能力缺口（工具调用失败、用户反馈、未知领域）。

**学习产出：**
- Vault 知识条目（`vault/learnings/`）
- 自动生成的技能（`skills/auto-generated/`）
- 工具调用序列（可复用的 procedure）

**质量控制：** 置信度追踪，仅保留高质量知识。最低阈值：4+ 工具调用、5s+ 执行时间、价值关键词匹配。

## 4. 前端架构

### 4.1 多窗口模式

| 模式 | 尺寸 | 用途 |
|------|------|------|
| Launcher | 600×60 | Spotlight 风格搜索栏 |
| Panel | 600×600 | 主聊天界面 |
| Dashboard | 全屏覆盖 | 管理面板 |

窗口间支持磁性吸附（Dashboard/Settings 窗口吸附到主窗口边缘）。

### 4.2 核心组件

```
src/components/
  Chat/
    ChatInterface.tsx      -- 主聊天视图（Header + Timeline + InputArea）
    Timeline/              -- 消息/事件时间线
    TokenUsagePanel.tsx    -- Token 用量显示
  Fluid/
    Launcher.tsx           -- Spotlight 搜索栏
    TaskSwitcher.tsx       -- 任务切换
  Dashboard/               -- 管理面板
  Settings/                -- 设置（LLM、快捷键、主题）
  Skills/                  -- 技能管理
  Mcp/                     -- MCP 服务器管理
  Workspace/               -- 工作空间选择
  Common/                  -- 通用组件（Modal、Toast、ErrorBoundary）
```

### 4.3 状态管理

| Store | 职责 |
|-------|------|
| useTaskStore | 任务生命周期、消息、工具调用 |
| useUIStore | 窗口模式、视图切换、主题 |
| useConfigStore | LLM 配置、API Key、首次运行检测 |
| useWorkspaceStore | 工作空间 CRUD |
| useSkillStore | 技能列表、启用/禁用 |
| useMcpStore | MCP 工具包管理 |

### 4.4 Human-in-the-Loop

关键 AI 操作通过 `EffectConfirmationDialog` 弹窗确认。PolicyEngine 控制哪些操作需要审批，用户可选择"本次允许"、"本会话允许"或"始终允许"。

## 5. 数据持久化

| 数据 | 存储位置 | 格式 |
|------|---------|------|
| MCP 工具包 | `.coworkany/toolpacks.json` | JSON |
| 技能注册 | `.coworkany/skills.json` | JSON |
| 工作空间 | `.coworkany/workspaces.json` | JSON |
| 会话记忆 | `.coworkany/sessions/` | JSON |
| 长期知识 | `~/.coworkany/vault/` | Markdown |
| 自学习技能 | `vault/self-learned/` | SKILL.md |
| 日志 | `.coworkany/logs/sidecar-YYYY-MM-DD.log` | 文本 |

## 6. 开发与构建

### 6.1 项目结构

```
coworkany/
├── desktop/                 # Tauri 桌面应用
│   ├── src/                 # React 前端
│   ├── src-tauri/           # Rust 后端
│   └── package.json
├── sidecar/                 # AI 引擎
│   ├── src/
│   │   ├── agent/           # Agent 系统
│   │   ├── tools/           # 工具系统
│   │   ├── claude_skills/   # 技能系统
│   │   ├── mcp/             # MCP Gateway
│   │   ├── llm/             # LLM 路由
│   │   ├── memory/          # 记忆系统
│   │   ├── protocol/        # IPC 协议
│   │   ├── storage/         # 持久化
│   │   └── main.ts          # 入口
│   └── package.json
├── browser-use-service/     # 浏览器自动化服务
├── docs/                    # 技术文档
│   ├── TECHNICAL_DESIGN.md  # 本文档
│   ├── agent-system.md      # Agent 系统详细设计
│   ├── tool-system.md       # 工具系统详细设计
│   ├── security-model.md    # 安全模型详细设计
│   ├── USER_GUIDE_CN.md     # 用户指南
│   └── backlog.md           # 待办事项
├── README.md                # 项目说明
└── CHANGELOG.md             # 变更日志
```

### 6.2 开发命令

```bash
# 安装依赖
cd desktop && pnpm install
cd sidecar && bun install

# 开发模式
cd desktop && pnpm tauri dev

# 构建
cd desktop && pnpm tauri build
```

## 7. 路线图

| 版本 | 目标 |
|------|------|
| v0.2.0 | UI 重构完成、性能优化、自动更新 |
| v0.3.0 | 插件市场、社区技能分享 |
| v0.5.0 | 多 Agent 协作、团队功能 |
| v1.0.0 | 稳定版发布、完整文档 |

**当前待办：** 见 [backlog.md](backlog.md)
