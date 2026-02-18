# CoworkAny - Universal AI Assistant

**与 AI 协作完成任何任务** - 日程管理、邮件处理、网络自动化、编程开发等

一个基于 Tauri 的智能桌面助手，集成日历、邮件、浏览器自动化、自主学习和编程辅助等能力。

---

## 📋 目录

- [核心能力](#核心能力)
- [快速开始](#快速开始)
- [使用示例](#使用示例)
- [技术架构](#技术架构)
- [详细功能](#详细功能)
- [配置指南](#配置指南)
- [开发指南](#开发指南)

---

## 🎯 核心能力

### 📅 个人助理

**日历管理**
- ✅ 查看今日/本周日程
- ✅ 智能安排会议
- ✅ 自动查找空闲时间
- ✅ 日程冲突检测

**邮件处理**
- ✅ 读取未读邮件
- ✅ 智能过滤重要邮件
- ✅ 自动回复和整理
- ✅ 邮件摘要生成

**任务管理**
- ✅ 创建和跟踪任务
- ✅ 优先级排序
- ✅ 进度追踪
- ✅ 提醒和通知

### 🌐 网络助手

**浏览器自动化**
- ✅ 社交媒体自动发帖
- ✅ 表单自动填写
- ✅ 网页内容抓取
- ✅ 复用用户登录会话（Playwright）

**信息搜索**
- ✅ 网页搜索和爬取
- ✅ 内容提取和整理
- ✅ 多源信息聚合

### 🧠 智能增强

**自主学习**
- ✅ 从互联网学习新技能
- ✅ 6 阶段学习循环（Gap Detection → Research → Lab Testing → Knowledge Precipitation）
- ✅ 自动沉淀可复用技能
- ✅ 持续改进和优化

**知识管理**
- ✅ RAG 记忆系统
- ✅ 语义搜索
- ✅ 笔记和整理
- ✅ 上下文恢复

**自动修正**
- ✅ 错误诊断和分析
- ✅ 8 种自动重试策略
- ✅ 替代命令建议
- ✅ 递归问题解决

### 💻 编程助手

**代码质量**
- ✅ 自动质量检查
- ✅ TypeScript 验证
- ✅ Console.log 检测
- ✅ Prettier 格式检查

**开发工具**
- ✅ 多工作空间管理
- ✅ 技能系统（Skills）
- ✅ MCP 服务器集成
- ✅ Package Manager 自动检测

**智能辅助**
- ✅ 代码验证和测试
- ✅ 工具链自动化
- ✅ Bug 修复建议
- ✅ 重构建议

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- Bun >= 1.0
- Rust (Tauri 开发)
- pnpm (推荐) / npm / yarn

### 安装步骤

1. **克隆仓库**
```bash
git clone https://github.com/your-org/coworkany.git
cd coworkany
```

2. **安装前端依赖**
```bash
cd desktop
pnpm install
```

3. **安装 Sidecar 依赖**
```bash
cd ../sidecar
bun install
```

4. **配置 LLM API**

创建 `sidecar/llm-config.json`:
```json
{
  "provider": "anthropic",
  "anthropic": {
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-5"
  }
}
```

5. **配置环境变量**（可选）

创建 `sidecar/.env`:
```bash
# Google 日历和邮件
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# 天气查询（可选）
OPENWEATHER_API_KEY=your_key

# 新闻订阅（可选）
NEWS_API_KEY=your_key
```

6. **启动应用**
```bash
cd desktop
pnpm tauri dev
```

---

## 💡 使用示例

### 个人助理

**早晨例行**:
```
用户: "Good morning, what's on my schedule?"

AI:
📅 Today's Schedule (3 events):
  • 10:00 AM - Team Meeting
  • 12:00 PM - Lunch with Sarah
  • 3:00 PM - Code Review

📧 Unread Emails (5 total, 2 important):
  • Boss: Q1 Review Due Friday
  • HR: Benefits Update Required

🌤️ Weather: 18°C, Partly Cloudy

✅ High-Priority Tasks:
  1. Finish quarterly report
  2. Review pull request #234
  3. Send invoice to client
```

**日程安排**:
```
用户: "Schedule a meeting with the marketing team tomorrow at 2pm"

AI:
✅ Checking your calendar for tomorrow...
✅ 2pm slot is available
✅ Created event: "Marketing Team Meeting"
   Time: Tomorrow, 2:00 PM - 3:00 PM
✅ Would you like me to send invitations?
```

**邮件自动化**:
```
用户: "Summarize my important emails and draft replies"

AI:
📧 Important Emails (3):

1. From: boss@company.com
   Subject: Q1 Strategy Review
   Summary: Requesting presentation deck by Friday
   ✍️ Draft Reply: "I'll prepare the deck and send it by Thursday EOD..."

2. From: client@example.com
   Subject: Project Timeline Update
   Summary: Asking about delivery date changes
   ✍️ Draft Reply: "The adjusted timeline puts delivery at March 15..."
```

### 网络自动化

**社交媒体发帖**:
```
用户: "Post 'Just shipped v2.0! 🚀' on Twitter"

AI:
🌐 Connecting to Twitter (using your existing session)...
✅ Navigated to Twitter
✅ Found compose button
✅ Entered text: "Just shipped v2.0! 🚀"
✅ Posted successfully!
📸 Screenshot saved for confirmation
```

**网页研究**:
```
用户: "Research the latest quantum computing breakthroughs"

AI:
🔍 Searching: "quantum computing 2026 breakthroughs"
📄 Found 12 sources (Nature, MIT Tech Review, ArXiv...)
📥 Extracting content from top 5 sources...

📊 Summary:
• IBM announced 1000-qubit processor (Jan 2026)
• Google achieved quantum advantage in optimization
• Main challenges: error correction, scalability

💾 Saved to vault: "Quantum Computing 2026 Review"
🔗 Sources: [links included in vault note]
```

### 编程任务

**Bug 修复**:
```
用户: "Fix the login bug where users can't submit the form"

AI:
🔍 Analyzing login component...
🐛 Found issue: Missing form validation on empty fields
✏️ Proposed fix:
   [Shows code diff]
✅ Applied fix
🧪 Running tests...
✅ All tests passed (15/15)
📊 Code quality: 98/100
```

**代码重构**:
```
用户: "Refactor the UserService class for better readability"

AI:
📖 Analyzing UserService.ts...
🔧 Refactoring suggestions:
   • Extract authentication logic
   • Reduce cyclomatic complexity (12 → 5)
   • Add TypeScript strict types

✏️ Refactored code:
   [Shows improved code]
✅ Tests still passing
📈 Quality improvement: 76 → 95
```

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────┐
│                Desktop (Tauri 2.0)              │
│   React 18 + TypeScript    Rust Backend         │
│   Zustand + Tailwind CSS   Policy Engine        │
└────────────────────┬────────────────────────────┘
                     │ JSON Lines over stdio
┌────────────────────┼────────────────────────────┐
│            Sidecar (Bun Runtime)                │
│  Agent System │ Tool System │ LLM Router        │
│  Skill System │ MCP Gateway │ Memory/RAG        │
└─────────────────────────────────────────────────┘
```

**技术栈**: React 18 + Vite 5 | Tauri 2.0 (Rust) | Bun Sidecar | Anthropic/OpenAI/OpenRouter/Ollama

**详细技术文档：**
- [技术方案总览](docs/TECHNICAL_DESIGN.md) - 完整架构设计
- [Agent 系统设计](docs/agent-system.md) - ReAct 循环、自主学习、工具链
- [工具系统设计](docs/tool-system.md) - 工具清单、MCP Gateway、工具链
- [安全模型设计](docs/security-model.md) - Effect 门控、Shadow FS、审计
- [用户指南](docs/USER_GUIDE_CN.md) - 使用说明

---

## 📖 详细功能

### 日历管理

#### 查看日程
```
用户: "What's on my calendar today?"
```

AI 自动调用 `calendar_check` 工具：
- 获取今日所有事件
- 检测日程冲突
- 显示会议信息
- 提供参会准备建议

#### 创建事件
```
用户: "Schedule a team meeting next Monday at 10am"
```

AI 自动：
1. 解析时间表达式
2. 检查空闲时段
3. 创建日历事件
4. (可选) 创建关联任务

#### 查找空闲时间
```
用户: "When am I free for a 2-hour meeting this week?"
```

AI 分析日历并推荐可用时段。

### 邮件处理

#### 智能过滤
- **重要邮件**: 来自老板、VIP 发件人、紧急关键词
- **需要行动**: 包含 "urgent", "deadline", "action required" 等
- **优先级排序**: 按重要性和时间排序

#### 自动回复
```
用户: "Reply to the email from Sarah about the meeting"
```

AI：
1. 查找来自 Sarah 的邮件
2. 理解邮件内容（关于会议）
3. 生成合适的回复
4. 征求用户确认后发送

### 浏览器自动化

#### 支持的操作
- `browser_connect`: 连接到用户的 Chrome（复用登录会话）
- `browser_navigate`: 导航到 URL
- `browser_click`: 点击元素（CSS 选择器或文本）
- `browser_fill`: 填写表单字段
- `browser_screenshot`: 截图确认
- `browser_wait`: 等待元素加载

#### 示例场景
- 社交媒体发帖（小红书、Twitter）
- 表单自动填写
- 网页内容监控
- 自动化测试

### 自主学习

#### 6 阶段学习循环

```
1. Gap Detection (检测知识差距)
   ↓
2. Research Engine (从互联网研究)
   ↓
3. Learning Processor (结构化知识)
   ↓
4. Lab Sandbox (安全测试)
   ↓
5. Confidence Tracker (评估可靠性)
   ↓
6. Precipitator (沉淀为技能)
```

#### 自动触发

当遇到以下情况时自动学习：
- 不熟悉的库或 API
- 失败的命令或错误
- 未知的技术栈
- 新的问题领域

学习成果自动保存为可复用技能，下次遇到类似任务直接应用。

### 工具链（Tool Chains）

#### 预置工具链

**通用助手**:
- `morning-routine`: 早晨例行（日程+邮件+新闻+天气）
- `research-topic`: 研究主题（搜索+爬取+整理+保存）
- `meeting-prep`: 会议准备（查找资料+创建笔记）
- `weekly-review`: 周回顾（总结任务+事件+学习）

**编程开发**:
- `fix-bug-and-test`: 修复 bug 并测试
- `create-feature-safe`: 安全创建功能（代码+测试+质量检查+提交）
- `refactor-safe`: 安全重构（备份+重构+测试+质量对比）
- `deploy-safe`: 安全部署（测试+构建+质量检查+部署）

#### 自定义工具链

用户可以创建自己的工具链，组合任意工具形成自动化流程。

### 技能系统（Skills）

#### 预置技能

**通用助手技能**:
- `daily-assistant`: 日常助理（早晨例行）
- `research-assistant`: 研究助手（深度研究）
- `meeting-prep`: 会议准备助手
- `email-automation`: 邮件自动化
- `web-automation`: 网页自动化
- `knowledge-keeper`: 知识管理
- `travel-planner`: 旅行规划

**编程技能**:
- `systematic-debugging`: 系统化调试
- `test-driven-development`: 测试驱动开发
- `code-review-assistant`: 代码审查
- `refactoring-guide`: 重构指南
- ... 24+ 编程技能

#### 技能推荐

AI 根据用户消息自动分析意图并推荐合适技能：
- **意图分析**: 检测用户想做什么（personal_management, research, bug_fix 等）
- **触发词匹配**: 关键词自动匹配技能
- **上下文增强**: 结合当前状态和历史
- **置信度评分**: 高置信度（>90%）自动加载

---

## ⚙️ 配置指南

### LLM 配置

**位置**: `sidecar/llm-config.json`

**Anthropic Claude**:
```json
{
  "provider": "anthropic",
  "anthropic": {
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-5"
  }
}
```

**OpenRouter**:
```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-...",
    "model": "anthropic/claude-sonnet-4.5"
  }
}
```

### Google 集成（日历和邮件）

1. 访问 [Google Cloud Console](https://console.cloud.google.com)
2. 创建 OAuth 2.0 客户端 ID
3. 配置环境变量：

```bash
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

### 可选 API

**天气查询**:
- 注册 [OpenWeatherMap](https://openweathermap.org/api)
- 设置 `OPENWEATHER_API_KEY`

**新闻订阅**:
- 注册 [NewsAPI](https://newsapi.org/)
- 设置 `NEWS_API_KEY`

### 工作空间配置

**全局配置**: `sidecar/workspaces.json`
**项目配置**: `<workspace>/.coworkany/`

```
.coworkany/
├── skills/           # 项目技能
├── mcp/              # MCP 服务器配置
└── memory/           # 记忆和会话历史
```

---

## 👨‍💻 开发指南

### 添加新的通用工具

1. **创建工具文件** (`sidecar/src/tools/personal/myTool.ts`):
```typescript
export const myTool: ToolDefinition = {
  name: 'my_tool',
  description: 'Tool description',
  effects: ['network:outbound'],
  input_schema: { /* ... */ },
  handler: async (args) => {
    // 实现逻辑
  },
};
```

2. **注册工具** (`tools/personal/index.ts`):
```typescript
export { myTool } from './myTool';
export const PERSONAL_TOOLS = [
  // ... 其他工具
  myTool,
];
```

3. **无需修改核心代码**！
   - `ReactController` 自动识别新工具
   - `SelfCorrectionEngine` 自动处理错误
   - `VerificationEngine` 自动验证输出

### 添加新技能

1. **创建技能目录** `.agent/skills/my-skill/`

2. **编写 SKILL.md**:
```markdown
---
name: my-skill
description: "Skill description"
requires:
  tools: ['tool1', 'tool2']
  capabilities: ['network:outbound']
triggers:
  - "keyword1"
  - "keyword2"
userInvocable: true
---

# My Skill

## Usage
...
```

3. **扩展技能推荐器** (`skillRecommender.ts`):
```typescript
{
  name: 'my-skill',
  description: 'Skill description',
  triggers: ['keyword1', 'keyword2'],
  intents: ['my_intent_type'],
  priority: 8,
}
```

---

## 📚 参考资源

- [Tauri 文档](https://tauri.app/)
- [Bun 文档](https://bun.sh/docs)
- [Claude API 文档](https://docs.anthropic.com/)
- [MCP 协议](https://modelcontextprotocol.io/)
- [Playwright 文档](https://playwright.dev/)
- [Google Calendar API](https://developers.google.com/calendar)
- [Gmail API](https://developers.google.com/gmail)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交变更 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [Anthropic](https://anthropic.com/) - Claude API
- [Tauri](https://tauri.app/) - 跨平台框架
- [OpenClaw](https://github.com/openclaw/openclaw) - 架构理念
- [everything-claude-code](https://github.com/affaan-m/everything-claude-code) - 功能灵感

---

**CoworkAny - 你的通用 AI 助手，让 AI 与你协作完成任何任务** 🚀
