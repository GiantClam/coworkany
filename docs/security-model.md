# 安全模型设计

> CoworkAny 技术方案 - 详细设计文档

## 1. 设计原则

CoworkAny 的安全模型基于 **Effect-Gated Execution**（副作用门控执行）：AI Agent 的所有副作用必须声明、审批、审计。

```
Agent 意图 → Effect 声明 → Policy 评估 → 用户确认(可选) → 执行 → 审计
```

## 2. 三阶段检测

### 2.1 Pre-Input（输入前）

- 输入内容检测和过滤
- Prompt Injection 防护
- PII 检测和脱敏

### 2.2 Pre-Tool（工具调用前）

每个工具调用前，PolicyBridge 将 Effect 请求发送到 Rust PolicyEngine：

```typescript
interface EffectRequest {
  type: EffectType;
  riskLevel: number;     // 1-10
  description: string;
  metadata: Record<string, any>;
}
```

PolicyEngine 根据策略决定：
- **approve** - 直接执行
- **deny** - 拒绝执行
- **ask** - 弹出确认对话框，等待用户决策

### 2.3 Post-Output（输出后）

- 输出内容检测
- 敏感信息脱敏
- 审计日志记录

## 3. Effect 类型体系

| Effect 类型 | 风险等级 | 默认策略 | 说明 |
|-------------|---------|---------|------|
| filesystem_read | 2 | session | 读取文件，低风险 |
| filesystem_write | 6 | once | 写入文件，中高风险 |
| shell_execute | 8 | once | 执行 Shell 命令，高风险 |
| network_request | 4 | session | 网络请求，中风险 |
| code_execution | 7 | once | 代码执行，高风险 |
| secrets_access | 9 | never | 访问密钥，极高风险 |
| screen_capture | 5 | once | 屏幕截图，中风险 |
| ui_control | 3 | session | UI 控制，低风险 |

### 3.1 确认策略

| 策略 | 行为 |
|------|------|
| never | 始终拒绝，不询问 |
| once | 每次都询问用户 |
| session | 同一会话内首次询问，后续自动批准 |
| always | 始终自动批准（仅限低风险操作） |

## 4. Shadow FS（影子文件系统）

### 4.1 工作流程

```
Agent write_file → Shadow FS 暂存 → 生成 Diff → 前端展示
                                                    ↓
                                              用户审查
                                              ├── 批准 → 写入磁盘
                                              └── 拒绝 → 丢弃
```

### 4.2 Patch 协议

| 事件 | 方向 | 说明 |
|------|------|------|
| PATCH_PROPOSED | Sidecar → UI | 提议文件修改，包含 diff |
| PATCH_APPLIED | UI → Sidecar | 用户批准，原子写入 |
| PATCH_REJECTED | UI → Sidecar | 用户拒绝，丢弃修改 |

### 4.3 Git 集成

Shadow FS 配合 Git 实现安全实验：
- 修改前自动创建 checkpoint 分支
- 支持一键回滚到任意 checkpoint
- 前端提供 `/undo` 和 `/redo` 操作

## 5. Agent Identity（代理身份）

### 5.1 身份模型

```typescript
interface AgentIdentity {
  sessionId: string;        // 会话唯一标识
  parentChain: string[];    // 父代理委托链
  capabilities: string[];   // 能力标签
}
```

### 5.2 委托追踪

Agent 可以委托子 Agent 执行任务，形成委托图：

```
主 Agent → 子 Agent A → 子 Agent A1
         → 子 Agent B
```

每条委托边通过 `record_agent_delegation` 命令记录，支持审计追溯。

## 6. MCP Gateway 安全

### 6.1 策略执行

MCP 工具调用经过 Gateway 的安全检查：

```
MCP 工具调用 → 风险评分 → 策略匹配 → 决策
                                      ├── allow → 执行
                                      ├── deny → 拒绝
                                      └── warn → 记录 + 执行
```

### 6.2 审计

所有 MCP Gateway 决策通过 `MCP_GATEWAY_DECISION` 事件记录：
- 工具名称和参数
- 风险评分
- 决策结果
- 时间戳

## 7. Runtime Security Guard

### 7.1 检测类型

| 检测 | 说明 |
|------|------|
| Prompt Injection | 检测输入中的注入攻击 |
| Data Exfiltration | 检测数据外泄尝试 |
| Privilege Escalation | 检测权限提升尝试 |
| Resource Abuse | 检测资源滥用（过多工具调用等） |

### 7.2 响应动作

| 动作 | 说明 |
|------|------|
| blocked | 阻止执行，通知用户 |
| redacted | 脱敏后继续 |
| flagged | 标记但允许，记录审计 |
| allowed | 正常通过 |

安全告警通过 `RUNTIME_SECURITY_ALERT` 事件上报到前端。

## 8. 记忆安全

### 8.1 Vault 安全控制

| 控制 | 说明 |
|------|------|
| 来源标签 | 每条记忆标记来源（用户输入/网络/推理） |
| 信任评分 | 基于来源和验证状态的信任分数 |
| PII 过滤 | 存储前自动检测和脱敏个人信息 |
| TTL 过期 | 时效性信息自动过期清理 |

### 8.2 检索策略

```
符号索引（精确匹配）→ 向量相似度（语义搜索）→ 信任评分过滤 → 返回结果
```
