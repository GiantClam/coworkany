# 使用示例：集成 ReActController + AdaptiveExecutor + SuspendCoordinator

## 基本用法

### 1. 初始化组件

```typescript
import {
    ReActController,
    createReActController,
    AdaptiveExecutor,
    SuspendResumeManager,
    IntentDetector,
    SuspendCoordinator,
    createIntentDetector,
    createSuspendCoordinator,
} from './agent';

// 1. 创建 AdaptiveExecutor（快速重试引擎）
const adaptiveExecutor = new AdaptiveExecutor({
    maxRetries: 3,
    retryDelay: 2000,
    enableAlternatives: true,
});

// 2. 创建 SuspendResumeManager（挂起/恢复管理）
const suspendResumeManager = new SuspendResumeManager({
    defaultHeartbeatInterval: 5000,
    defaultMaxWaitTime: 5 * 60 * 1000,
    enableAutoResume: true,
});

// 监听挂起/恢复事件
suspendResumeManager.on('task_suspended', (data) => {
    console.log(`⏸ Task ${data.taskId} suspended: ${data.reason}`);
    console.log(`User message: ${data.userMessage}`);
});

suspendResumeManager.on('task_resumed', (data) => {
    console.log(`▶️ Task ${data.taskId} resumed after ${data.suspendDuration}ms`);
});

// 3. 创建 IntentDetector（意图检测）
const intentDetector = createIntentDetector();

// 4. 创建 SuspendCoordinator（统一协调挂起/恢复）
const suspendCoordinator = createSuspendCoordinator(
    suspendResumeManager,
    intentDetector
);

// 5. 创建 ToolExecutor（基础工具执行器）
class MyToolExecutor implements ToolExecutor {
    async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
        // 实际的工具执行逻辑
        // 调用 browser_click, execute_command 等工具
        return 'Tool executed successfully';
    }
}

const baseToolExecutor = new MyToolExecutor();

// 6. 创建 ReActController（自动集成所有组件）
const reActController = createReActController({
    llm: myLlmInterface,              // 实现 ReActLlmInterface
    toolExecutor: baseToolExecutor,   // 基础工具执行器
    adaptiveExecutor,                 // 可选：自动添加重试能力
    suspendCoordinator,               // 可选：自动添加挂起/恢复能力
    maxSteps: 10,
    enableMemory: true,
    enableSelfCorrection: true,
});
```

### 2. 执行任务

```typescript
const context: AgentContext = {
    taskId: 'task-123',
    workspacePath: '/path/to/workspace',
    availableTools: [
        { name: 'browser_navigate', description: 'Navigate to URL', inputSchema: {} },
        { name: 'browser_click', description: 'Click element', inputSchema: {} },
        { name: 'execute_command', description: 'Execute shell command', inputSchema: {} },
        // ... more tools
    ],
};

const query = '帮我在小红书上发布 hello world';

// 执行 ReAct 循环
for await (const step of reActController.execute(query, context)) {
    console.log(`Step ${step.stepNumber}:`);
    console.log(`Thought: ${step.thought}`);

    if (step.action) {
        console.log(`Action: ${step.action.tool}(${JSON.stringify(step.action.args)})`);
        console.log(`Observation: ${step.observation}`);
    }

    if (step.isFinal) {
        console.log('Task completed!');
    }
}
```

---

## 完整示例：小红书发帖

### 场景描述

用户请求："帮我在小红书上发布 hello world"

### 执行流程

```typescript
// ReAct 循环开始
for await (const step of reActController.execute(query, context)) {
    // Step 1: Thought - 决定访问小红书
    // Thought: "需要先访问小红书创作者中心"
    // Action: browser_navigate({ url: "https://creator.xiaohongshu.com" })

    // IntentDetector 检测意图
    const intent = intentDetector.detectIntent(
        "需要先访问小红书创作者中心",
        { tool: 'browser_navigate', args: { url: 'https://creator.xiaohongshu.com' } }
    );
    // 返回: { type: 'browser_automation', requiresAuthentication: true }

    // SuspendCoordinator Pre-execution check
    // 暂不挂起，先执行导航

    // Execute: browser_navigate
    // Observation: "Successfully navigated to https://creator.xiaohongshu.com"

    // SuspendCoordinator Post-execution check
    // 检测到页面有登录按钮！
    // Decision: { shouldSuspend: true, reason: 'authentication_required' }

    // 挂起任务
    suspendCoordinator.suspend('task-123', {
        shouldSuspend: true,
        reason: 'authentication_required',
        userMessage: 'Please login to creator.xiaohongshu.com in the browser.',
        resumeCondition: ResumeConditions.browserPageCheck(
            async () => {
                const page = await browserService.getPage();
                const loginBtn = await page.$('button:has-text("登录")').catch(() => null);
                return !loginBtn; // Resume if login button is gone
            },
            5000,
            5 * 60 * 1000
        ),
    });

    // 输出挂起状态
    // "⏸ Task suspended: Please login to creator.xiaohongshu.com in the browser."

    // 心跳开始（每 5 秒检查一次）
    // ... 用户在浏览器中手动登录 ...

    // 心跳检测到登录完成
    // "✅ Resume condition met for task-123"
    // suspendResumeManager.resume('task-123', 'Auto-detected: condition met')

    // 任务恢复，继续下一步

    // Step 2: Thought - 点击发布按钮
    // Thought: "需要点击发布笔记按钮"
    // Action: browser_click({ text: "发布笔记" })

    // AdaptiveToolExecutor 执行
    // 尝试 1: 点击 "发布笔记" → 未找到
    // DETECT: element_not_found
    // PLAN: 尝试替代文案 ["创作灵感", "发布", "Create"]
    // 尝试 2: 点击 "创作灵感" → 未找到
    // 尝试 3: 点击 "发布" → 成功！
    // Observation: "Successfully clicked: 发布"

    // Step 3: Thought - 填写内容
    // Action: browser_fill({ selector: 'textarea', value: 'hello world' })
    // Observation: "Successfully filled: textarea"

    // Step 4: Thought - 提交发布
    // Action: browser_click({ text: "发布" })
    // Observation: "Successfully clicked: 发布"

    // Step 5: Final Answer
    // "Successfully posted 'hello world' on Xiaohongshu"
}
```

### 日志输出

```
[IntentDetector] Detected intent: browser_automation, requiresAuthentication: true
[ReActController] Executing action: browser_navigate
[BrowserService] Navigating to: https://creator.xiaohongshu.com
[SuspendCoordinator] Post-execution suspend: authentication_required
[SuspendResume] 🔶 Suspending task task-123: authentication_required
[SuspendResume] Message to user: Please login to creator.xiaohongshu.com in the browser.
[SuspendResume] 💓 Starting heartbeat for task-123 (check every 5000ms)
[SuspendResume] 💓 Heartbeat check for task-123...
[SuspendResume] 💓 Heartbeat check for task-123...
[SuspendResume] ✅ Resume condition met for task-123
[SuspendResume] ▶️ Resuming task task-123
[ReActController] Executing action: browser_click
[AdaptiveExecutor] Executing step: browser_click with retry (attempt 1/3)
[AdaptiveExecutor] Detected error: element_not_found - "发布笔记" not found
[AdaptiveExecutor] Trying alternative: "创作灵感"
[AdaptiveExecutor] Detected error: element_not_found - "创作灵感" not found
[AdaptiveExecutor] Trying alternative: "发布"
[AdaptiveExecutor] Success after 3 attempts
[ReActController] Final answer generated
```

---

## 高级用法

### 自定义错误检测

```typescript
// 扩展 AdaptiveExecutor 的错误检测
adaptiveExecutor.detectErrorType = (errorMessage: string): ErrorType => {
    const msg = errorMessage.toLowerCase();

    // 自定义错误类型
    if (msg.includes('captcha') || msg.includes('验证码')) {
        return 'captcha_required';
    }

    if (msg.includes('rate limit')) {
        return 'rate_limit';
    }

    // 默认逻辑
    return adaptiveExecutor.detectErrorType(errorMessage);
};
```

### 自定义挂起条件

```typescript
// 添加新的恢复条件
const customResumeCondition: ResumeCondition = {
    type: 'auto_detect',
    checkFunction: async () => {
        // 自定义检查逻辑
        // 例如：检查文件是否存在
        const fileExists = await fs.existsSync('/path/to/file');
        return fileExists;
    },
    checkInterval: 10000, // 10 秒检查一次
    maxWaitTime: 5 * 60 * 1000, // 最多等 5 分钟
};
```

### 监听所有事件

```typescript
// ReAct 事件
reActController = createReActController({
    // ...
    onEvent: (event: ReActEvent) => {
        switch (event.type) {
            case 'step_start':
                console.log(`⏱ Step ${event.stepNumber} started`);
                break;
            case 'thought':
                console.log(`🤔 Thought: ${event.data.thought}`);
                break;
            case 'action_start':
                console.log(`🔧 Action: ${event.data.tool}`);
                break;
            case 'observation':
                console.log(`👀 Observation: ${event.data.observation}`);
                break;
            case 'final_answer':
                console.log(`✅ Final Answer`);
                break;
        }
    },
});

// Suspend/Resume 事件
suspendResumeManager.on('task_suspended', (data) => {
    // 通知前端显示挂起状态
    emitToFrontend({
        type: 'TASK_SUSPENDED',
        taskId: data.taskId,
        reason: data.reason,
        userMessage: data.userMessage,
        canAutoResume: data.canAutoResume,
    });
});

suspendResumeManager.on('task_resumed', (data) => {
    // 通知前端任务已恢复
    emitToFrontend({
        type: 'TASK_RESUMED',
        taskId: data.taskId,
        suspendDuration: data.suspendDuration,
    });
});
```

---

## 与现有代码集成

### 在 main.ts 中初始化

```typescript
// sidecar/src/main.ts

// 初始化 AdaptiveExecutor 和 SuspendCoordinator
const adaptiveExecutor = new AdaptiveExecutor({
    maxRetries: 3,
    retryDelay: 2000,
    enableAlternatives: true,
});

const suspendResumeManager = new SuspendResumeManager({
    defaultHeartbeatInterval: 5000,
    defaultMaxWaitTime: 5 * 60 * 1000,
    enableAutoResume: true,
});

const intentDetector = createIntentDetector();

const suspendCoordinator = createSuspendCoordinator(
    suspendResumeManager,
    intentDetector
);

// 在创建 ReActController 时传入
const reActController = createReActController({
    llm: autonomousLlmAdapter,
    toolExecutor: baseToolExecutor,
    adaptiveExecutor,          // ✅ 添加自适应重试
    suspendCoordinator,         // ✅ 添加挂起/恢复
    maxSteps: 10,
    enableMemory: true,
    enableSelfCorrection: true,
});
```

---

## 测试建议

### 单元测试

```typescript
import { IntentDetector } from './agent';

describe('IntentDetector', () => {
    const detector = new IntentDetector();

    it('should detect browser authentication intent', () => {
        const intent = detector.detectIntent(
            'I need to login to Xiaohongshu',
            { tool: 'browser_navigate', args: { url: 'https://xiaohongshu.com' } }
        );

        expect(intent.type).toBe('browser_automation');
        expect(intent.requiresAuthentication).toBe(true);
    });

    it('should detect interactive command', () => {
        const intent = detector.detectIntent(
            'Connect to the server',
            { tool: 'execute_command', args: { command: 'ssh user@server' } }
        );

        expect(intent.type).toBe('command_execution');
        expect(intent.requiresUserInput).toBe(true);
    });
});
```

### 集成测试

```typescript
describe('ReActController with adaptive retry', () => {
    it('should retry on element not found', async () => {
        const reActController = createReActController({
            llm: mockLlm,
            toolExecutor: mockToolExecutor,
            adaptiveExecutor: new AdaptiveExecutor(),
            maxSteps: 5,
        });

        // Mock browser_click to fail first time, succeed second time
        let attempts = 0;
        mockToolExecutor.execute = async (tool, args) => {
            attempts++;
            if (attempts === 1) {
                throw new Error('Element not found: 发布笔记');
            }
            return 'Successfully clicked';
        };

        const result = await reActController.execute('Click publish button', context);

        expect(attempts).toBeGreaterThan(1);
        expect(result.finalAnswer).toContain('Success');
    });
});
```

---

## 常见问题

### Q: AdaptiveExecutor 会拖慢执行速度吗？
**A**: 不会。只有在工具执行失败时才会重试。成功的执行和之前一样快。

### Q: 挂起的任务如何恢复？
**A**:
- 自动恢复：心跳检测满足条件后自动恢复
- 手动恢复：调用 `suspendCoordinator.resume(taskId)`

### Q: 可以禁用自适应重试或挂起/恢复吗？
**A**: 可以。在创建 ReActController 时不传入这些参数即可：

```typescript
const reActController = createReActController({
    llm: myLlm,
    toolExecutor: baseToolExecutor,
    // 不传 adaptiveExecutor → 禁用自适应重试
    // 不传 suspendCoordinator → 禁用挂起/恢复
});
```

### Q: 如何添加新的挂起场景？
**A**: 在 `SuspendCoordinator` 的 `checkPreExecutionSuspend` 或 `checkPostExecutionSuspend` 中添加新的检测逻辑。参考 REFACTOR_SUMMARY.md 中的扩展示例。

---

## 总结

新的集成架构提供了：

1. **无缝集成**: 只需在创建 ReActController 时传入可选参数
2. **分层清晰**: 工具层、意图层、循环层各司其职
3. **通用性强**: 支持任何工具、任何挂起场景
4. **易于扩展**: 添加新功能只需几行代码

使用这个架构，您的 AI Agent 将具备：
- ✅ 自动重试失败的工具调用
- ✅ 智能检测需要用户操作的场景
- ✅ 自动挂起和恢复任务
- ✅ 完整的事件日志和状态追踪

立即开始使用，让您的 AI Agent 更加智能和健壮！🚀
