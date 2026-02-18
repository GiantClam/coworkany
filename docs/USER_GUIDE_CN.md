# CoworkAny 用户指南

## 📖 目录

1. [快速上手](#快速上手)
2. [工作空间管理](#工作空间管理)
3. [AI 对话](#ai-对话)
4. [技能系统](#技能系统)
5. [MCP 服务器](#mcp-服务器)
6. [代码质量检查](#代码质量检查)
7. [高级功能](#高级功能)
8. [常见问题](#常见问题)

---

## 🚀 快速上手

### 第一次使用

#### 1. 配置 LLM API

首次启动后，需要配置 AI 服务：

1. 点击左侧边栏的 **Settings** (⚙️)
2. 选择 Provider:
   - **Anthropic**: 使用 Claude 官方 API
   - **OpenRouter**: 使用 OpenRouter 平台
   - **Custom**: 自定义 API 端点

3. 填写 API Key
4. 选择 Model（如 `claude-sonnet-4-5`）
5. 点击 **Save** 保存

#### 2. 创建第一个工作空间

1. 在左侧边栏找到 **Workspaces** 部分
2. 点击右上角的 `+` 按钮
3. 输入工作空间信息：
   - **Workspace Name**: 项目名称（如 "我的博客"）
   - **Workspace Path**: 项目路径（如 `D:\Projects\my-blog`）
4. 点击 **Create**

工作空间创建后，会自动：
- 检测项目的包管理器（npm/pnpm/yarn/bun）
- 创建 `.coworkany` 配置目录
- 设置为当前活动工作空间

#### 3. 开始对话

1. 点击左侧边栏的 **Chat**
2. 在输入框输入问题或任务
3. 按 Enter 发送
4. AI 会分析并给出回应

---

## 💼 工作空间管理

### 什么是工作空间？

工作空间是一个项目的独立环境，包含：
- 独立的技能配置
- 独立的 MCP 服务器
- 会话历史记录
- 学习的模式和偏好

### 管理工作空间

#### 查看工作空间列表

左侧边栏会显示所有工作空间，格式如下：
```
📁 我的博客 (2)        ← 工作空间名称（会话数量）
  ▼                    ← 展开/折叠按钮
  └─ 修复首页 bug      ← 会话 1
  └─ 添加评论功能      ← 会话 2
```

- **蓝色高亮**: 当前活动的工作空间
- **数字**: 该工作空间下的会话数量

#### 切换工作空间

点击任意工作空间名称即可切换。切换后：
- 聊天界面会显示该工作空间的会话
- 技能和 MCP 配置会切换到该工作空间
- AI 会加载该工作空间的上下文

#### 删除工作空间

⚠️ **注意**: 删除工作空间会删除所有会话历史和配置！

目前需要手动编辑 `sidecar/workspaces.json` 文件。

### Package Manager 自动检测

CoworkAny 会智能检测项目使用的包管理器，优先级如下：

1. **环境变量** `COWORKANY_PACKAGE_MANAGER`
   ```bash
   export COWORKANY_PACKAGE_MANAGER=pnpm
   ```

2. **项目配置** `.coworkany/package-manager.json`
   ```json
   {
     "packageManager": "pnpm"
   }
   ```

3. **package.json 字段**
   ```json
   {
     "packageManager": "pnpm@8.6.0"
   }
   ```

4. **Lock 文件检测**
   - 有 `pnpm-lock.yaml` → 使用 pnpm
   - 有 `bun.lockb` → 使用 bun
   - 有 `yarn.lock` → 使用 yarn
   - 有 `package-lock.json` → 使用 npm

5. **全局配置** `~/.coworkany/package-manager.json`

6. **系统检测** (第一个可用的)

**查看检测结果**:
启动任务时，在控制台会输出：
```
[Task xxx] Package manager detected: pnpm
```

### Session Memory（会话记忆）

#### 工作原理

每次对话都会被记录到 Session Memory：
- **消息历史**: 所有对话内容
- **学习内容**: AI 学到的项目偏好
- **模式识别**: 识别出的用户习惯

#### 存储位置

```
<workspace>/.coworkany/memory/sessions/
├── abc123.json    ← 会话 1
├── def456.json    ← 会话 2
└── ...
```

#### 会话文件内容

```json
{
  "sessionId": "abc123",
  "startedAt": "2026-01-27T10:00:00Z",
  "endedAt": "2026-01-27T11:30:00Z",
  "messages": [
    {
      "role": "user",
      "content": "修复登录页面的 bug",
      "timestamp": "2026-01-27T10:05:00Z"
    },
    {
      "role": "assistant",
      "content": "我来帮你分析...",
      "timestamp": "2026-01-27T10:05:10Z"
    }
  ],
  "learnings": [
    "用户偏好使用 TypeScript strict 模式",
    "项目使用 pnpm 作为包管理器",
    "用户喜欢详细的代码注释"
  ],
  "patterns": [
    {
      "pattern": "测试",
      "description": "用户频繁提到: 测试",
      "confidence": 0.8,
      "occurrences": 5
    }
  ]
}
```

#### 上下文恢复

开始新会话时，AI 会自动加载上次会话的内容：

```
📝 加载上次会话上下文...

## 之前学到的内容
- 用户偏好使用 TypeScript strict 模式
- 项目使用 pnpm 作为包管理器

## 识别的模式
- 用户频繁提到: 测试 (置信度: 80%)
- 用户频繁提到: 组件 (置信度: 65%)

## 最近的上下文
- User: 修复登录组件的 bug
- Assistant: 我找到了问题所在...
```

这使得 AI 能够：
- 记住你的编码习惯
- 理解项目的技术栈
- 延续之前的讨论

---

## 💬 AI 对话

### 发送消息

1. 在聊天界面底部输入框输入
2. 可以提问、请求代码、要求修复等
3. 按 `Enter` 发送（`Shift+Enter` 换行）

### 消息类型

#### 1. 提问
```
问: 这个项目使用什么状态管理库？
```

AI 会分析项目文件并回答。

#### 2. 代码请求
```
请实现一个用户登录表单组件
要求：
- 使用 React + TypeScript
- 包含表单验证
- 支持记住密码功能
```

#### 3. 代码修复
```
修复 src/components/Button.tsx 中的类型错误
```

#### 4. 代码审查
```
审查 src/utils/api.ts，找出潜在的安全问题
```

### 效果确认

当 AI 要修改代码时，会弹出确认对话框：

```
┌─────────────────────────────────────────┐
│  AI 想要执行以下操作：                   │
│                                         │
│  工具: Edit                              │
│  文件: src/components/Button.tsx         │
│                                         │
│  变更内容:                               │
│  - 修复 TypeScript 类型错误              │
│  - 添加 onClick 属性                     │
│                                         │
│  ⚠️ 代码质量检查结果:                    │
│  检测到 1 个 console.log 调试语句        │
│  第 15 行: console.log('Debug:', props)  │
│                                         │
│  💡 建议: 提交前记得删除调试语句          │
│                                         │
│  [ Approve ]  [ Deny ]                  │
└─────────────────────────────────────────┘
```

- **Approve**: 允许执行
- **Deny**: 拒绝执行

---

## 🎯 技能系统

### 什么是技能？

技能是扩展 AI 能力的插件，每个技能提供特定领域的知识和工具。

**示例技能**:
- **pdf**: 处理 PDF 文件
- **websearch**: 网页搜索
- **image-generation**: 生成图片
- **database**: 数据库操作

### 安装技能

#### 方法 1: 从 GitHub URL 安装

1. 进入 **Skills** 标签页
2. 切换到 **Install** 子标签
3. 输入 GitHub URL，支持格式：
   ```
   https://github.com/anthropics/skills/tree/main/pdf
   https://github.com/user/repo/tree/branch/path/to/skill
   github:anthropics/skills/pdf
   ```

4. 系统会自动验证 URL 并显示预览：
   ```
   ┌─────────────────────────────────────┐
   │  ✓ 验证成功                          │
   │                                     │
   │  技能名称: PDF 处理器                │
   │  描述: 读取和分析 PDF 文档           │
   │  运行环境: 🐍 Python                 │
   │                                     │
   │  [ Install ]                        │
   └─────────────────────────────────────┘
   ```

5. 点击 **Install** 完成安装

#### 方法 2: 浏览默认仓库

1. 切换到 **Browse Repositories** 子标签
2. 等待加载（首次会扫描所有仓库，约 5-10 秒）
3. 浏览可用技能列表，来自：
   - `anthropics/skills` - Anthropic 官方技能
   - `anthropics/claude-plugins-official/plugins` - 官方插件
   - `OthmanAdi/planning-with-files` - 规划工作流
   - `obra/superpowers` - 超能力工具包

4. **搜索和筛选**:
   - 搜索框: 输入关键词搜索
   - Runtime 筛选: 只显示特定运行时（Python/Node.js/Shell）

5. **批量安装**:
   - 勾选想要的技能（可多选）
   - 点击 **Install Selected (N)** 批量安装

#### 方法 3: 从本地安装

1. 准备技能目录，包含 `skill.json`
2. 在 Install 标签输入本地路径：
   ```
   file:///D:/my-skills/custom-skill
   ```
3. 点击 Install

### 管理技能

#### 查看已安装技能

在 Skills 页面可以看到所有已安装的技能：

```
┌─────────────────────────────────────┐
│  PDF 处理器                     [✓]  │
│  🐍 Python                           │
│  读取和分析 PDF 文档                 │
│                                      │
│  来源: github:anthropics/skills/pdf │
│  [ Disable ]  [ Remove ]             │
└─────────────────────────────────────┘
```

- **[✓]**: 已启用
- **[ ]**: 已禁用
- **运行环境图标**: 🐍 Python / 📦 Node.js / ⚡ Shell

#### 启用/禁用技能

- 点击技能卡片右上角的复选框
- 或点击 **Disable** / **Enable** 按钮

禁用的技能不会在对话中使用，但保留在系统中。

#### 删除技能

1. 点击技能卡片的 **Remove** 按钮
2. 确认删除
3. 技能文件会从磁盘删除

### 技能存储位置

```
<workspace>/.coworkany/skills/
├── pdf/
│   ├── skill.json       ← 技能定义
│   ├── skill.py         ← Python 实现
│   └── requirements.txt ← 依赖
├── websearch/
│   └── skill.json
└── ...
```

---

## 🔌 MCP 服务器

### 什么是 MCP？

MCP (Model Context Protocol) 是一个标准协议，让 AI 能够访问外部工具和服务。

**常见用途**:
- 访问 GitHub 仓库
- 操作数据库
- 部署到云平台
- 发送消息到 Slack
- 浏览器自动化

### 使用预置模板

CoworkAny 提供多个预配置模板，开箱即用。

#### 示例: 配置 GitHub MCP

1. 进入 **MCP Servers** 标签页
2. 点击 **Add Server** 或使用模板
3. 选择 **GitHub** 模板
4. 按照设置说明操作：

**步骤 1: 获取 GitHub Token**
```
1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 选择权限:
   ✓ repo (完整仓库访问)
   ✓ read:user (读取用户信息)
4. 点击 "Generate token"
5. 复制生成的 token (ghp_xxxxx)
```

**步骤 2: 配置 MCP 服务器**
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
  }
}
```

**步骤 3: 启动服务器**
- 点击 **Start** 按钮
- 等待状态变为 🟢 Running

**步骤 4: 使用**
```
问: 列出我的所有 GitHub 仓库

AI: 我通过 GitHub MCP 查询到你有以下仓库：
- username/repo1 (⭐ 123)
- username/repo2 (⭐ 45)
...
```

### 可用模板列表

#### 开发工具

**GitHub**
- 访问仓库、Issues、PR
- 创建/更新文件
- 管理 Issues 和 PR

**Filesystem**
- 读取/写入本地文件
- 浏览目录结构
- 需要指定允许的目录

**Puppeteer**
- 浏览器自动化
- 网页截图
- 表单填写

#### 数据库

**Supabase**
```json
{
  "env": {
    "SUPABASE_URL": "https://xxx.supabase.co",
    "SUPABASE_ANON_KEY": "eyJhbGc..."
  }
}
```

**PostgreSQL**
```json
{
  "env": {
    "POSTGRES_CONNECTION_STRING": "postgresql://user:pass@host:5432/db"
  }
}
```

#### 部署平台

**Vercel**
- 部署项目
- 查看部署状态
- 管理环境变量

**Railway**
- 创建服务
- 查看日志
- 管理部署

#### 其他服务

**Slack**
- 发送消息
- 创建频道
- 管理成员

**Brave Search**
- 网页搜索
- 获取搜索结果

### 自定义 MCP 服务器

如果模板不满足需求，可以自定义配置：

```json
{
  "name": "我的自定义 MCP",
  "command": "node",
  "args": ["path/to/my-mcp-server.js"],
  "env": {
    "MY_API_KEY": "key",
    "MY_SETTING": "value"
  }
}
```

### 管理 MCP 服务器

#### 查看状态

```
┌─────────────────────────────────────┐
│  GitHub                         🟢   │
│  访问 GitHub 仓库和 Issues           │
│                                      │
│  运行环境: 📦 Node.js                │
│  状态: Running                       │
│                                      │
│  [ Stop ]  [ Restart ]  [ Remove ]   │
└─────────────────────────────────────┘
```

状态指示：
- 🟢 **Running**: 正常运行
- 🔴 **Stopped**: 已停止
- 🟡 **Starting**: 启动中
- ⚠️ **Error**: 出错

#### 查看日志

点击服务器卡片查看详细日志：
```
[2026-01-27 10:30:15] Server started
[2026-01-27 10:30:16] Connected to GitHub API
[2026-01-27 10:31:20] Received request: list_repos
[2026-01-27 10:31:21] Response sent: 15 repositories
```

---

## ✨ 代码质量检查

CoworkAny 内置多个代码质量检查，在编辑代码后自动运行。

### Console.log 检测

**检测内容**:
- `console.log()`
- `console.warn()`
- `console.error()`

**示例**:
```typescript
// ❌ 会被检测
function handleLogin() {
    console.log('Login clicked');  // 第 15 行
    // ...
}

function fetchData() {
    console.warn('Deprecated API');  // 第 42 行
    // ...
}
```

**检测结果**:
```
⚠️  检测到 2 个 console 调试语句

  第 15 行: console.log('Login clicked')
  第 42 行: console.warn('Deprecated API')

💡 提交前记得删除调试语句

建议:
  • 在提交代码前移除所有 console 调试语句
```

**排除注释**:
```typescript
// ✓ 不会检测（已注释）
// console.log('Debug');

/* ✓ 不会检测（块注释）
console.log('Debug');
*/
```

### TypeScript 类型检查

编辑 `.ts` 或 `.tsx` 文件后，自动运行 `tsc --noEmit`。

**示例**:
```typescript
// src/utils/helper.ts
export function add(a: number, b: number): number {
    return a + b;
}

// src/components/Calculator.tsx
import { add } from '../utils/helper';

const result = add('1', '2');  // ❌ 类型错误
```

**检测结果**:
```
❌ TypeScript 类型错误:

  src/components/Calculator.tsx(5,20): error TS2345:
  Argument of type 'string' is not assignable to parameter of type 'number'.

建议:
  • 修复 TypeScript 类型错误后再继续
```

**前提条件**:
- 项目根目录有 `tsconfig.json`
- 安装了 TypeScript (`npm install -D typescript`)

**禁用检查**:
删除或重命名 `tsconfig.json` 文件。

### Prettier 格式检查

如果项目安装了 Prettier，会检查代码格式。

**示例**:
```typescript
// ❌ 格式不规范
function hello(  name:string  ){
return"Hello, "+name;}
```

**检测结果**:
```
💡 文件可能需要格式化
   运行: npx prettier --write "hello.ts"

建议:
  • 使用 Prettier 格式化代码以保持一致性
```

**自动格式化**:
```bash
npx prettier --write "src/**/*.{ts,tsx,js,jsx}"
```

### 查看所有警告

所有检查结果会汇总显示在效果确认对话框中：

```
┌─────────────────────────────────────┐
│  代码质量检查结果:                   │
│                                     │
│  ⚠️ 检测到 2 个 console.log         │
│  ❌ 发现 1 个 TypeScript 错误        │
│  💡 建议使用 Prettier 格式化         │
│                                     │
│  是否仍要继续？                      │
│  [ Approve ]  [ Deny ]              │
└─────────────────────────────────────┘
```

你可以：
- **Approve**: 忽略警告，继续执行
- **Deny**: 取消操作，先修复问题

---

## 🔧 高级功能

### 自定义系统提示

编辑 AI 的系统提示，让它更符合你的需求。

**位置**: Settings → Custom System Prompt

**示例**:
```
你是一个专业的前端开发助手。

## 编码规范
- 优先使用 TypeScript
- 使用函数式组件和 Hooks
- 遵循 Airbnb 代码规范
- 添加详细的 JSDoc 注释

## 技术栈
- React 18
- TypeScript 5
- Tailwind CSS
- Zustand (状态管理)

## 测试要求
- 每个组件都要有单元测试
- 使用 Jest + React Testing Library
- 测试覆盖率 > 80%
```

### 配置快捷键

**可配置的快捷键**:
- 发送消息: `Enter` / `Ctrl+Enter`
- 换行: `Shift+Enter`
- 打开设置: `Ctrl+,`
- 切换侧边栏: `Ctrl+B`

### 导出会话历史

导出某个会话的完整历史：

1. 在 Chat 界面右上角点击 **···** (更多)
2. 选择 **Export Session**
3. 选择格式:
   - **JSON**: 完整数据
   - **Markdown**: 可读格式
   - **HTML**: 网页格式

**导出内容**:
- 所有消息
- 代码变更
- 效果确认记录
- 学习内容

---

## ❓ 常见问题

### 工作空间相关

**Q: 工作空间的数据存储在哪里？**

A:
- 全局配置: `sidecar/workspaces.json`
- 工作空间数据: `<workspace-path>/.coworkany/`

**Q: 可以在多个工作空间间共享技能吗？**

A:
目前技能是工作空间隔离的。如果需要共享，可以：
1. 手动复制 `.coworkany/skills/` 目录
2. 使用全局技能目录（计划中的功能）

**Q: 删除工作空间会删除项目文件吗？**

A:
不会。只会删除 `.coworkany/` 配置目录，项目文件保持不变。

### Package Manager 相关

**Q: 如何强制使用特定的包管理器？**

A:
创建 `.coworkany/package-manager.json`:
```json
{
  "packageManager": "pnpm"
}
```

或设置环境变量:
```bash
export COWORKANY_PACKAGE_MANAGER=pnpm
```

**Q: Package Manager 检测不准确怎么办？**

A:
检查检测优先级，确保：
1. Lock 文件存在且正确
2. package.json 中的 packageManager 字段正确
3. 或手动在项目中创建配置文件

### AI 对话相关

**Q: AI 说"我无法访问文件"？**

A:
检查：
1. 工作空间路径是否正确
2. 文件路径是否在工作空间内
3. 是否有文件权限问题

**Q: 如何让 AI 记住我的偏好？**

A:
AI 会自动通过 Session Memory 学习，你也可以：
1. 在系统提示中明确说明偏好
2. 多次提及相同的要求，AI 会识别为模式

**Q: 效果确认对话框不显示怎么办？**

A:
检查 Settings 中的 "Auto-approve effects" 选项是否开启。
如果开启，所有操作会自动执行。

### 技能和 MCP 相关

**Q: 技能安装失败？**

A:
常见原因：
1. GitHub URL 格式不正确
2. 网络连接问题
3. 仓库不存在或私有
4. skill.json 格式错误

**Q: MCP 服务器启动失败？**

A:
检查：
1. 环境变量是否正确配置
2. API Key 是否有效
3. 网络是否能访问服务
4. 查看服务器日志了解详细错误

**Q: 如何更新已安装的技能？**

A:
目前需要：
1. 删除旧版本
2. 重新安装最新版本

自动更新功能在开发中。

### 代码质量检查相关

**Q: 如何禁用某个检查？**

A:
目前所有检查都是默认启用的，但你可以：
1. 忽略警告，点击 Approve 继续
2. 修改 `sidecar/src/hooks/codeQualityHooks.ts` 禁用特定检查

**Q: TypeScript 检查太慢？**

A:
如果项目很大，类型检查可能需要几秒。可以：
1. 优化 tsconfig.json 配置
2. 使用 `skipLibCheck` 跳过库文件检查
3. 暂时删除 tsconfig.json 禁用检查

### 性能相关

**Q: 应用启动很慢？**

A:
首次启动会：
1. 加载所有工作空间
2. 初始化 Sidecar 进程
3. 连接 LLM API

后续启动会更快。

**Q: 对话响应很慢？**

A:
取决于：
1. LLM API 的响应速度
2. 网络延迟
3. 项目文件大小

可以尝试：
- 使用更快的模型（如 Haiku）
- 限制上下文长度
- 使用本地 API 服务

---

## 📞 获取帮助

如有问题：

1. 查看本文档
2. 查看 [README.md](../README.md)
3. 提交 [GitHub Issue](https://github.com/your-org/coworkany/issues)
4. 加入社区讨论

---

**祝你使用愉快！** 🎉
