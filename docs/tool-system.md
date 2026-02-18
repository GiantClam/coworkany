# 工具系统设计

> CoworkAny 技术方案 - 详细设计文档

## 1. 架构概览

工具系统采用注册表模式，统一管理内置工具、MCP 外部工具和存根工具。

```
ToolRegistry (优先级解析)
  ├── MCP Tools (最高优先级)     -- 外部 MCP Server 提供
  ├── Builtin Tools (中优先级)   -- 内置实现
  └── Stub Tools (最低优先级)    -- 占位/降级实现
```

## 2. 工具定义格式

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;       // Zod 验证的输入参数
  effects: EffectDeclaration[];  // 声明的副作用
  handler: (input: any) => Promise<ToolResult>;
}
```

每个工具必须声明其副作用（Effect），执行前由 PolicyBridge 审批。

## 3. 工具清单

### 3.1 核心工具 (`tools/core/`)

| 工具 | 文件 | 功能 |
|------|------|------|
| calendar_check | calendar.ts | 查看日程、查找空闲时间 |
| calendar_create | calendar.ts | 创建日程事件 |
| email_check | email.ts | 检查收件箱、过滤邮件 |
| email_send | email.ts | 发送邮件、回复 |
| get_system_info | system.ts | 获取系统信息（OS、CPU、内存） |
| voice_input | voice.ts | 语音转文字 |
| voice_output | voice.ts | 文字转语音 |
| create_task | tasks.ts | 创建任务 |
| list_tasks | tasks.ts | 列出任务 |
| update_task | tasks.ts | 更新任务状态 |

### 3.2 编程工具 (`tools/coding/`)

| 工具 | 功能 |
|------|------|
| read_file | 读取文件内容 |
| write_file | 写入文件（通过 Shadow FS） |
| search_code | 代码搜索（正则/语义） |
| run_command | 执行 Shell 命令 |
| check_code_quality | 代码质量检查（复杂度/安全/异味） |

### 3.3 文件工具 (`tools/files/`)

| 工具 | 功能 |
|------|------|
| list_directory | 列出目录内容 |
| create_directory | 创建目录 |
| move_file | 移动/重命名文件 |

### 3.4 网络工具 (`tools/web/`)

| 工具 | 功能 |
|------|------|
| crawl_url | 爬取网页内容，转为 Markdown |
| web_search | 网络搜索 |

### 3.5 浏览器自动化 (`tools/browser*.ts`)

| 工具 | 功能 |
|------|------|
| browser_navigate | 导航到 URL |
| browser_click | 点击元素 |
| browser_type | 输入文本 |
| browser_screenshot | 截图 |
| browser_evaluate | 执行 JavaScript |

基于 Playwright，支持复用用户登录会话。配合 SuspendCoordinator 实现任务挂起/恢复（等待用户手动登录等场景）。

### 3.6 记忆工具 (`tools/memory/`)

| 工具 | 功能 |
|------|------|
| save_to_vault | 保存知识到 Vault |
| search_vault | 语义搜索 Vault |

### 3.7 个人工具 (`tools/personal/`)

| 工具 | 功能 |
|------|------|
| quick_note | 快速记录笔记 |
| get_news | 获取新闻摘要 |
| check_weather | 查看天气 |

### 3.8 代码质量工具 (`tools/codeQuality.ts`)

| 工具 | 功能 |
|------|------|
| check_code_quality | 综合代码质量检查 |
| batch_check_quality | 批量检查多个文件 |

## 4. MCP Gateway

### 4.1 生命周期管理

```
安装 → 配置 → 启动 → 工具发现 → 注册到 Registry → 运行 → 停止
```

MCP Server 作为子进程运行，Gateway 管理其生命周期。

### 4.2 工具发现

MCP Server 启动后，Gateway 通过 MCP 协议发现其提供的工具，自动注册到 ToolRegistry。MCP 工具优先级最高，可覆盖同名内置工具。

### 4.3 策略执行

每个 MCP 工具调用经过：
1. 风险评分（1-10）
2. 策略决策（allow/deny/warn）
3. 审计日志记录

### 4.4 存储

`toolpacks.json` 结构：

```json
{
  "toolpack-name": {
    "source": "github:user/repo",
    "enabled": true,
    "lastUsed": "2026-02-14T00:00:00Z",
    "config": { ... }
  }
}
```

## 5. 工具链执行器

### 5.1 链定义

```typescript
interface ToolChain {
  id: string;
  name: string;
  description: string;
  tags: string[];
  steps: ChainStep[];
}

interface ChainStep {
  id: string;
  tool: string;
  args: Record<string, any>;
  condition?: string;        // 条件表达式
  onError?: 'stop' | 'skip' | 'retry';
  retryCount?: number;
}
```

### 5.2 执行流程

```
Chain Registry → 查找链 → Chain Executor → 逐步执行
                                            ├── 条件检查
                                            ├── 工具调用
                                            ├── 结果传递
                                            ├── 错误处理
                                            └── 事件通知
```

### 5.3 事件

| 事件 | 时机 |
|------|------|
| chain_started | 链开始执行 |
| step_started | 步骤开始 |
| step_completed | 步骤完成 |
| step_failed | 步骤失败 |
| chain_completed | 链执行完成 |
| chain_failed | 链执行失败 |

## 6. 工具注册优先级

```
1. MCP Tools      -- 外部工具，最高优先级，可覆盖内置
2. Builtin Tools  -- 内置实现，标准功能
3. Stub Tools     -- 占位实现，返回"功能未配置"提示
```

热重载：`reload_tools` 命令触发从磁盘重新加载工具定义，无需重启 Sidecar。
