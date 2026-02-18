# 如何使用自适应执行和任务挂起/恢复

## 快速开始

这些功能已经自动集成到浏览器工具中，无需额外配置。

### 场景 1：在小红书发帖（自动处理登录）

```
用户: "帮我在小红书上发布 hello world"

系统自动处理:
1. 打开浏览器，访问小红书创作者中心
2. 检测到需要登录 → 自动挂起任务
3. 提示用户: "请在浏览器中登录 creator.xiaohongshu.com，任务将自动恢复"
4. 每 5 秒心跳检测是否登录完成
5. 检测到登录成功 → 自动恢复任务
6. 继续执行：点击发布按钮，填写内容，提交
```

### 场景 2：按钮文本找不到时自动尝试替代方案

```
AI 执行: browser_click({text: "发布笔记"})

如果按钮未找到，自动尝试:
  尝试 1: "发布笔记" ❌
  尝试 2: "创作灵感" ❌
  尝试 3: "发布" ✅

成功点击 "发布" 按钮，继续执行
```

## 工作原理

### 1. 自适应重试（AdaptiveExecutor）

当工具执行失败时，系统会：
- **检测错误类型**：元素未找到、超时、网络错误等
- **生成替代方案**：不同的按钮文本、选择器、超时时间
- **自动重试**：最多尝试 3 次
- **反馈结果**：成功或最终失败

**支持的工具**:
- `browser_click` - 点击按钮/链接
- `browser_fill` - 填写表单
- `browser_wait` - 等待元素出现

### 2. 任务挂起/恢复（SuspendResumeManager）

当任务需要等待用户操作时：
- **自动检测**：识别登录页面、验证码页面等
- **挂起任务**：保存执行上下文，停止 AI 执行
- **心跳检测**：每 5 秒检查是否满足恢复条件
- **自动恢复**：条件满足后自动继续执行

**检测条件**:
- 页面包含登录按钮（"登录", "Sign in", "Log in"）
- 需要验证码
- 需要二维码扫描
- （可扩展更多条件）

## 查看执行日志

系统会输出详细日志，帮助理解执行过程：

### 重试日志
```
[AdaptiveExecutor] Executing step: browser_click with retry (attempt 1/3)
[AdaptiveExecutor] Detected error: element_not_found - "发布笔记" not found
[AdaptiveExecutor] Trying alternative: "创作灵感"
[AdaptiveExecutor] Success after 2 attempts
```

### 挂起/恢复日志
```
[SuspendResume] 🔶 Suspending task task-abc123: authentication_required
[SuspendResume] Message to user: Please login to creator.xiaohongshu.com...
[SuspendResume] 💓 Starting heartbeat for task-abc123 (check every 5000ms)
[SuspendResume] 💓 Heartbeat check for task-abc123...
[SuspendResume] ✅ Resume condition met for task-abc123
[SuspendResume] ▶️ Resuming task task-abc123
```

## 配置参数

如果需要调整配置，在 `main.ts` 中修改：

### AdaptiveExecutor 配置
```typescript
const adaptiveExecutor = new AdaptiveExecutor({
    maxRetries: 3,              // 最大重试次数（默认 3）
    retryDelay: 2000,           // 重试延迟 ms（默认 2000）
    enableAlternatives: true,   // 启用替代方案（默认 true）
});
```

### SuspendResumeManager 配置
```typescript
const suspendResumeManager = new SuspendResumeManager({
    defaultHeartbeatInterval: 5000,        // 心跳间隔 ms（默认 5000）
    defaultMaxWaitTime: 5 * 60 * 1000,     // 最大等待时间 ms（默认 5分钟）
    enableAutoResume: true,                // 启用自动恢复（默认 true）
});
```

## 常见问题

### Q: 任务挂起后多久会超时？
**A:** 默认 5 分钟。超时后任务会自动取消，并发出 `task_cancelled` 事件。

### Q: 如何手动恢复挂起的任务？
**A:** 当前版本只支持自动恢复。如果需要手动恢复，可以添加 IPC 命令（参考 INTEGRATION_SUMMARY.md）。

### Q: 可以禁用自动重试吗？
**A:** 可以。在 AdaptiveExecutor 配置中设置 `maxRetries: 1` 或 `enableAlternatives: false`。

### Q: 如何添加自定义的恢复条件？
**A:** 在 `suspendResumeManager.ts` 中的 `ResumeConditions` 添加新的工厂方法。例如：

```typescript
export const ResumeConditions = {
    // ... existing methods

    customCheck(
        checkFunction: () => Promise<boolean>,
        interval = 5000,
        maxWaitTime = 5 * 60 * 1000
    ): ResumeCondition {
        return {
            type: 'auto_detect',
            checkFunction,
            checkInterval: interval,
            maxWaitTime,
        };
    },
};
```

### Q: 重试 3 次后仍然失败会怎样？
**A:** 返回失败结果给 AI，AI 会根据错误信息决定下一步操作（例如报告给用户、尝试其他方法等）。

## 扩展示例

### 添加自定义错误检测
在 `adaptiveExecutor.ts` 的 `detectErrorType()` 中添加：

```typescript
private detectErrorType(errorMessage: string): ErrorType {
    const msg = errorMessage.toLowerCase();

    // ... existing checks

    if (msg.includes('captcha') || msg.includes('验证码')) {
        return 'captcha_required';
    }

    return 'unknown';
}
```

### 添加自定义替代策略
在 `adaptiveExecutor.ts` 的 `planAlternative()` 中添加：

```typescript
private planAlternative(
    step: ExecutionStep,
    errorType: ErrorType,
    attempt: number
): AlternativeStrategy | null {
    // ... existing strategies

    if (errorType === 'captcha_required') {
        return {
            description: 'Wait for captcha input',
            args: {
                ...step.args,
                timeout_ms: 60000, // Wait 1 minute for user to solve captcha
            },
        };
    }

    return null;
}
```

## 性能提示

- **心跳检测**: 轻量级 DOM 查询，对浏览器性能影响很小
- **重试延迟**: 2 秒延迟避免过度请求，可根据实际情况调整
- **内存使用**: 挂起任务存储在内存中，任务完成后自动清理

## 最佳实践

1. **让 AI 自然处理**: 无需在 prompt 中特别说明，AI 会自动利用这些能力
2. **观察日志**: 出现问题时查看日志，了解重试和挂起的详细过程
3. **及时登录**: 检测到需要登录时，尽快在浏览器中完成登录（5分钟内）
4. **保持页面打开**: 任务挂起期间不要关闭浏览器窗口

## 下一步

- [ ] 前端 UI 显示挂起状态和心跳进度
- [ ] 添加手动恢复按钮
- [ ] 支持更多网站的登录检测
- [ ] 支持验证码自动识别
- [ ] 支持二维码扫描等待
