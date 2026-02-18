# Jarvis Personal Assistant System

> 将 CoworkAny 升级为类似钢铁侠电影中贾维斯的个人助理

## 🎯 核心能力对比

| 能力 | 当前实现 | 完成度 |
|------|----------|--------|
| **守护进程** | ✅ 24/7 持续运行 | 90% |
| **主动任务管理** | ✅ 智能提醒、建议、优先级 | 85% |
| **自然语言理解** | ✅ 基础 NLU 引擎 | 60% |
| **多模态输出** | ✅ 文本、可视化、操作按钮 | 70% |
| **日历集成** | 🔶 接口已定义 | 30% |
| **邮件集成** | 🔶 接口已定义 | 30% |
| **语音交互** | 🔶 架构已准备 | 20% |
| **情境感知** | 🔶 基础实现 | 40% |

## 🚀 快速开始

### 安装

```typescript
import { createJarvisController } from './agent/jarvis';

// 创建 Jarvis 实例
const jarvis = createJarvisController({
    name: 'Jarvis',  // 可自定义名字（Jarvis、Friday等）
    storagePath: '~/.coworkany/jarvis',
    enableDaemon: true,
    enableProactive: true,
});

// 初始化
await jarvis.initialize();
```

### 基础对话

```typescript
// 文本交互
const response = await jarvis.processInput('What should I do next?');
console.log(response.text);
// > "Work on: Fix authentication bug. Priority: high, Due soon!"

// 创建任务
await jarvis.processInput('Create task: Review PR #123 tomorrow');
// > "Task created: Review PR #123. Due 2024-11-15. Priority: medium."

// 检查日历
await jarvis.processInput('What\'s on my calendar today?');
// > "You have 2 meetings today at 10:00 AM and 2:00 PM."
```

## 📋 主动任务管理

### 创建和管理任务

```typescript
import { createProactiveTaskManager } from './agent/jarvis';

const taskManager = createProactiveTaskManager('~/.coworkany/jarvis');

// 创建任务
const task = taskManager.createTask({
    title: 'Review code for new feature',
    description: 'Check PR #456 for security vulnerabilities',
    priority: 'high',
    status: 'pending',
    dueDate: '2024-11-15T17:00:00Z',
    estimatedMinutes: 60,
    tags: ['code-review', 'security'],
    dependencies: [],
});

// 获取建议的下一步行动
const suggestion = taskManager.suggestNextAction();
console.log(suggestion.title);  // "Work on: Review code for new feature"
console.log(suggestion.actions);  // [{ label: "Start task", command: "task:start:..." }]

// 获取统计信息
const stats = taskManager.getStatistics();
console.log(`Total: ${stats.total}, Overdue: ${stats.overdue}`);

// 获取逾期任务
const overdue = taskManager.getOverdueTasks();
overdue.forEach(task => {
    console.log(`⚠️  Overdue: ${task.title}`);
});
```

### 智能提醒

```typescript
// 系统会自动创建提醒（提前 60、30、10 分钟）
const reminders = taskManager.getPendingReminders();

reminders.forEach(reminder => {
    console.log(`🔔 ${reminder.message}`);
    // "Task 'Review code' is due in 30 minutes"

    taskManager.markReminderSent(reminder.id);
});
```

### 任务优化建议

```typescript
// 获取时间分配建议
const timeSlotSuggestions = taskManager.suggestTimeSlots();
timeSlotSuggestions.forEach(s => {
    console.log(`💡 ${s.title}: ${s.description}`);
});
// > "Schedule long tasks: You have 3 tasks requiring 60+ minutes..."
// > "Batch small tasks: You have 5 short tasks. Use Pomodoro technique..."

// 优化任务顺序
const optimization = taskManager.optimizeTaskOrder();
console.log(optimization.description);
// > "Reordered 10 tasks based on priority, deadlines, and dependencies."
```

## 🤖 守护进程

### 启动守护进程

```typescript
import { createDaemonService } from './agent/jarvis';

const daemon = createDaemonService({
    enabled: true,
    environmentCheckInterval: 30000,   // 30秒
    calendarCheckInterval: 300000,     // 5分钟
    emailCheckInterval: 60000,         // 1分钟
    taskCheckInterval: 10000,          // 10秒

    workingHours: {
        enabled: true,
        start: '09:00',
        end: '18:00',
        timezone: 'Asia/Shanghai',
    },

    proactiveReminders: true,
    proactiveSuggestions: true,
});

// 启动
await daemon.start();
console.log('Jarvis is now running 24/7');

// 监听事件
daemon.on('daemon:started', () => {
    console.log('✅ Daemon started');
});

daemon.on('tasks:check_requested', () => {
    console.log('⏰ Checking tasks...');
});

// 手动触发检查
await daemon.triggerCheck('calendar');
await daemon.triggerCheck('email');

// 暂停和恢复
daemon.pause();
await daemon.resume();

// 停止
await daemon.stop();
```

### 监控守护进程

```typescript
// 获取状态
const state = daemon.getState();  // 'running' | 'stopped' | 'paused'

// 获取统计
const stats = daemon.getStats();
console.log(`Uptime: ${stats.uptime}ms`);
console.log(`Tasks triggered: ${stats.tasksTriggered}`);
console.log(`Errors: ${stats.errorsCount}`);

// 健康检查
if (daemon.isHealthy()) {
    console.log('✅ Daemon is healthy');
} else {
    console.log('⚠️  Daemon may have issues');
    await daemon.restart();
}
```

## 🧠 主动建议系统

### 获取主动建议

```typescript
const jarvis = getJarvisController();

// 生成主动建议
const suggestions = await jarvis.generateProactiveSuggestions();

suggestions.forEach(suggestion => {
    console.log(`[${suggestion.priority}] ${suggestion.title}`);
    console.log(`  ${suggestion.message}`);
    console.log(`  Reasoning: ${suggestion.reasoning.join(', ')}`);

    if (suggestion.actions) {
        suggestion.actions.forEach(action => {
            console.log(`  Action: ${action.label}`);
        });
    }
});

/* 输出示例：
[high] Overdue tasks
  You have 2 overdue tasks
  Reasoning: Tasks past due date

[medium] Upcoming deadlines
  3 tasks due in the next 2 hours
  Reasoning: Tasks approaching deadline

[medium] Work on: Fix authentication bug
  High priority task in your queue
  Reasoning: Priority: high, Status: pending, Due soon!
  Action: Start task
  Action: View details
*/
```

## 💬 对话交互

### 支持的命令

```typescript
// 任务管理
await jarvis.processInput('Create task: Update documentation');
await jarvis.processInput('What should I do next?');
await jarvis.processInput('Show my tasks');

// 日历
await jarvis.processInput('What\'s on my calendar?');
await jarvis.processInput('Do I have meetings today?');

// 邮件
await jarvis.processInput('Check my email');
await jarvis.processInput('Any important emails?');

// 学习
await jarvis.processInput('Learn how to use Docker');
await jarvis.processInput('Research React best practices');

// 一般问答
await jarvis.processInput('What is the weather like?');
await jarvis.processInput('Remind me about the project deadline');
```

### 上下文感知

```typescript
// Jarvis 会记住对话上下文
await jarvis.processInput('Create task: Review code');
await jarvis.processInput('Set it to high priority');  // "it" 指代上一个任务
await jarvis.processInput('Make it due tomorrow');      // "it" 仍然指代同一任务
```

## 🔔 事件监听

```typescript
const jarvis = getJarvisController();

// 监听主动问候
jarvis.on('proactive:greeting', ({ message }) => {
    console.log(`🤖 ${message}`);
});

// 监听提醒
jarvis.on('reminder', (reminder) => {
    console.log(`⏰ ${reminder.message}`);

    // 可以通过桌面通知、语音等方式提醒用户
    showDesktopNotification(reminder.message);
});

// 监听守护进程事件
jarvis.on('daemon:error', ({ data }) => {
    console.error(`❌ Daemon error:`, data.error);
});
```

## 📊 获取系统状态

```typescript
const status = jarvis.getStatus();

console.log('System Status:');
console.log(`  Initialized: ${status.initialized}`);
console.log(`  Daemon: ${status.daemonRunning ? 'Running' : 'Stopped'}`);
console.log(`  Total tasks: ${status.taskStats.total}`);
console.log(`  Overdue: ${status.taskStats.overdue}`);
console.log(`  Due today: ${status.taskStats.dueToday}`);
console.log(`  Due this week: ${status.taskStats.dueThisWeek}`);
```

## 🎨 多模态响应

```typescript
const response = await jarvis.processInput('Show my tasks');

// 文本响应
console.log(response.text);

// 可视化元素
if (response.visual) {
    response.visual.forEach(element => {
        if (element.type === 'chart') {
            renderChart(element.data);
        } else if (element.type === 'table') {
            renderTable(element.data);
        } else if (element.type === 'list') {
            renderList(element.data, element.title);
        }
    });
}

// 可操作按钮
if (response.actions) {
    response.actions.forEach(action => {
        createButton(action.label, () => {
            executeCommand(action.command);
        });
    });
}
```

## 🔧 配置

### 任务管理器配置

```typescript
const taskManager = createProactiveTaskManager('~/.coworkany/jarvis', {
    enableReminders: true,
    reminderLeadTimes: [120, 60, 30, 10],  // 2小时、1小时、30分钟、10分钟

    enableSuggestions: true,
    minSuggestionConfidence: 0.7,

    autoPrioritize: true,
    urgentThresholdHours: 4,

    focusMode: false,
    focusModeDuration: 25,  // 番茄工作法
});
```

### 守护进程配置

```typescript
const daemon = createDaemonService({
    enabled: true,
    startOnBoot: false,

    // 检查间隔
    environmentCheckInterval: 30000,
    calendarCheckInterval: 300000,
    emailCheckInterval: 60000,
    taskCheckInterval: 10000,

    // 工作时段
    workingHours: {
        enabled: true,
        start: '09:00',
        end: '18:00',
        timezone: 'Asia/Shanghai',
    },

    // 主动性
    proactiveReminders: true,
    proactiveSuggestions: true,
    autoLearnDuringIdle: true,

    // 资源限制
    maxConcurrentTasks: 5,
    maxMemoryUsageMB: 1024,
});
```

## 🌟 实战示例

### 场景 1: 早晨工作流

```typescript
// 初始化 Jarvis
const jarvis = createJarvisController();
await jarvis.initialize();

// Jarvis 会主动问候
// > "Good morning. You have 1 overdue task. 3 tasks due today."

// 查看今日安排
const response = await jarvis.processInput('What should I focus on today?');
// > "Work on: Fix authentication bug. Priority: critical, Due in 2 hours!"

// 开始工作
await jarvis.processInput('Start the authentication task');
```

### 场景 2: 任务管理

```typescript
// 添加新任务
await jarvis.processInput('Create task: Review PR #456 tomorrow at 3pm');
await jarvis.processInput('Create task: Update documentation by Friday');
await jarvis.processInput('Create task: Call John about the project');

// 查看所有任务
const taskResponse = await jarvis.processInput('Show all my tasks');

// 获取优化建议
const taskManager = createProactiveTaskManager('~/.coworkany/jarvis');
const optimization = taskManager.optimizeTaskOrder();
console.log(optimization.description);
```

### 场景 3: 主动提醒

```typescript
// 守护进程会自动检查并发送提醒
const daemon = getDaemonService();

daemon.on('tasks:check_requested', async () => {
    const taskManager = createProactiveTaskManager('~/.coworkany/jarvis');
    const reminders = taskManager.getPendingReminders();

    for (const reminder of reminders) {
        // 发送桌面通知
        showNotification(reminder.message, {
            priority: reminder.priority,
            actions: [
                { label: 'Start Task', action: () => startTask(reminder.taskId) },
                { label: 'Snooze 10min', action: () => snooze(reminder.id, 10) },
            ],
        });

        taskManager.markReminderSent(reminder.id);
    }
});
```

## 🔮 未来计划

| 功能 | 状态 | 预计完成 |
|------|------|----------|
| 🗣️ **语音输入/输出** | 计划中 | Q1 2025 |
| 📧 **真实邮件集成** (Gmail/Outlook) | 开发中 | Q4 2024 |
| 📅 **真实日历集成** (Google/Outlook) | 开发中 | Q4 2024 |
| 🤖 **高级 NLU** (GPT-4 集成) | 计划中 | Q1 2025 |
| 📊 **数据可视化** (图表、仪表盘) | 计划中 | Q1 2025 |
| 🏠 **智能家居集成** | 计划中 | Q2 2025 |
| 🚗 **IoT 设备控制** | 计划中 | Q3 2025 |

## 🤝 贡献

欢迎贡献！特别是以下方面：
- 语音识别/合成集成
- 日历服务适配器
- 邮件服务适配器
- NLU 模型改进
- UI 组件

## 📄 许可证

MIT
