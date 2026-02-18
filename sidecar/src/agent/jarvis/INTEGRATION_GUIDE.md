# Jarvis System Integration Guide

> 完整的贾维斯系统集成指南 - 包括语音、NLU、任务管理等所有功能

## 📋 目录

1. [系统架构](#系统架构)
2. [快速开始](#快速开始)
3. [语音接口集成](#语音接口集成)
4. [NLU引擎集成](#nlu引擎集成)
5. [完整示例](#完整示例)
6. [Tauri前端集成](#tauri前端集成)
7. [故障排查](#故障排查)

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Jarvis Controller                        │
│  ┌─────────────┐  ┌──────────┐  ┌────────────────────────┐ │
│  │ Voice       │  │   NLU    │  │ Proactive Task Manager │ │
│  │ Interface   │──│  Engine  │──│                        │ │
│  └─────────────┘  └──────────┘  └────────────────────────┘ │
│         │              │                    │                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Daemon Service (24/7)                       ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
           │                 │                  │
    ┌──────────┐      ┌───────────┐     ┌────────────┐
    │ Calendar │      │   Email   │     │  Learning  │
    │Integration│      │Integration│     │   System   │
    └──────────┘      └───────────┘     └────────────┘
```

## 快速开始

### 最小化设置

```typescript
import { createJarvisController } from './agent/jarvis';

// 1. 创建 Jarvis（仅核心功能）
const jarvis = createJarvisController({
    name: 'Jarvis',
    storagePath: '~/.coworkany/jarvis',
    enableDaemon: true,
    enableProactive: true,
    enableVoice: false,  // 暂不启用语音
});

// 2. 初始化
await jarvis.initialize();

// 3. 基础交互
const response = await jarvis.processInput('What should I do next?');
console.log(response.text);
```

### 完整设置（包括语音和NLU）

```typescript
import {
    createJarvisController,
    createVoiceInterface,
    createNLUEngine,
} from './agent/jarvis';

// 1. 创建语音接口
const voice = createVoiceInterface({
    enabled: true,
    asr: {
        provider: 'native',  // 使用本机语音识别
        language: 'en-US',
        continuous: false,
    },
    tts: {
        provider: 'native',  // 使用本机TTS
        voice: 'default',
        rate: 1.0,
        volume: 0.8,
    },
});

await voice.initialize();

// 2. 创建 NLU 引擎
const nlu = createNLUEngine({
    provider: 'claude',
    model: 'claude-3-haiku-20240307',
    temperature: 0.3,
});

// 设置 LLM Provider
nlu.setLLMProvider({
    async call(messages) {
        // 这里接入现有的 LLM API
        // 例如：return await callClaudeAPI(messages);
        return await yourExistingLLMProvider.call(messages);
    },
});

// 3. 创建 Jarvis（完整版）
const jarvis = createJarvisController({
    name: 'Jarvis',
    enableDaemon: true,
    enableProactive: true,
    enableVoice: true,
});

await jarvis.initialize();

// 4. 集成语音和NLU（手动连接）
// Jarvis controller 内部会使用这些模块
```

## 语音接口集成

### 1. 检查本机语音能力

```typescript
import { createVoiceInterface } from './agent/jarvis';

const voice = createVoiceInterface();
await voice.initialize();

// 检查可用性
const availability = voice.isAvailable();
console.log('ASR available:', availability.asr);
console.log('TTS available:', availability.tts);
console.log('Platform:', availability.platform);

// 列出可用的语音
const voices = await voice.listVoices();
voices.forEach(v => {
    console.log(`${v.name} (${v.language})`);
});
```

### 2. 文本转语音 (TTS)

```typescript
// 基础使用
await voice.speak('Hello, I am Jarvis. How can I help you today?');

// 自定义配置
voice.updateConfig({
    tts: {
        provider: 'native',
        voice: 'Microsoft David Desktop',  // Windows
        rate: 1.2,
        volume: 0.9,
    },
});

await voice.speak('This is faster speech');

// 测试语音
await voice.testVoice();
```

### 3. 语音识别 (ASR)

```typescript
// 监听用户语音
console.log('Listening...');
const result = await voice.startListening();

console.log('Recognized:', result.text);
console.log('Confidence:', result.confidence);

// 如果有多个备选
if (result.alternatives) {
    result.alternatives.forEach(alt => {
        console.log(`Alternative: ${alt.text} (${alt.confidence})`);
    });
}
```

### 4. 语音对话循环

```typescript
async function voiceConversationLoop() {
    const jarvis = createJarvisController();
    const voice = createVoiceInterface({ enabled: true });

    await jarvis.initialize();
    await voice.initialize();

    while (true) {
        // 1. 听用户说话
        await voice.speak('Listening...');
        const speechResult = await voice.startListening();

        if (!speechResult.text) {
            await voice.speak('Sorry, I didn\'t catch that.');
            continue;
        }

        console.log(`User: ${speechResult.text}`);

        // 2. 处理输入
        const response = await jarvis.processInput(speechResult.text);

        // 3. 语音回复
        if (response.text) {
            console.log(`Jarvis: ${response.text}`);
            await voice.speak(response.text);
        }

        // 检查退出条件
        if (speechResult.text.toLowerCase().includes('goodbye')) {
            await voice.speak('Goodbye!');
            break;
        }
    }
}

// 启动语音对话
voiceConversationLoop().catch(console.error);
```

### 5. 平台特定配置

#### Windows
```typescript
const voice = createVoiceInterface({
    enabled: true,
    tts: {
        provider: 'native',
        voice: 'Microsoft David Desktop',  // 或其他 SAPI 语音
        rate: 1.0,
        volume: 0.8,
    },
});
```

#### macOS
```typescript
const voice = createVoiceInterface({
    enabled: true,
    tts: {
        provider: 'native',
        voice: 'Alex',  // 或 Samantha, Victoria 等
        rate: 1.0,
        volume: 0.8,
    },
});
```

#### Linux
```typescript
const voice = createVoiceInterface({
    enabled: true,
    tts: {
        provider: 'native',  // 使用 espeak-ng
        voice: 'default',
        rate: 1.0,
        volume: 0.8,
    },
});
```

### 6. 插件模式（本机不可用时）

```typescript
// 如果本机TTS不可用，使用 OpenAI TTS
const voice = createVoiceInterface({
    enabled: true,
    tts: {
        provider: 'openai',  // 需要实现 API 集成
        voice: 'alloy',
        rate: 1.0,
        volume: 0.8,
    },
});

// 或使用插件系统（MCP）
const voice = createVoiceInterface({
    enabled: true,
    tts: {
        provider: 'plugin',  // 通过 MCP 插件
        voice: 'custom-voice',
    },
});
```

## NLU引擎集成

### 1. 基础意图识别

```typescript
import { createNLUEngine } from './agent/jarvis';

const nlu = createNLUEngine();

// 设置 LLM Provider
nlu.setLLMProvider({
    async call(messages) {
        // 接入现有的 Claude API
        return await callClaudeAPI(messages);
    },
});

// 理解用户输入
const context = {
    conversationHistory: [],
    referencedEntities: new Map(),
    userPreferences: {},
};

const intent = await nlu.understand('Create a task to review code tomorrow', context);

console.log('Intent:', intent.type);  // 'task_create'
console.log('Confidence:', intent.confidence);  // 0.9
console.log('Entities:', intent.entities);  // [{ type: 'date', value: '2024-11-16', ... }]
console.log('Slots:', intent.slots);  // { title: 'review code' }
```

### 2. 支持的意图类型

| 意图类型 | 说明 | 示例 |
|---------|------|------|
| `task_create` | 创建任务 | "Create task: Review PR" |
| `task_query` | 查询任务 | "What should I do next?" |
| `task_update` | 更新任务 | "Mark that task as complete" |
| `reminder_set` | 设置提醒 | "Remind me to call John at 3pm" |
| `calendar_check` | 检查日历 | "What's on my calendar?" |
| `email_check` | 检查邮件 | "Any important emails?" |
| `learn_new` | 学习新技能 | "Learn how to use Docker" |
| `execute_command` | 执行命令 | "Run the tests" |
| `question_answer` | 一般问答 | "What is the weather?" |
| `chitchat` | 闲聊 | "How are you?" |

### 3. 实体提取

```typescript
const intent = await nlu.understand(
    'Create high priority task to review PR #456 tomorrow at 3pm',
    context
);

intent.entities.forEach(entity => {
    console.log(`${entity.type}: ${entity.value} (confidence: ${entity.confidence})`);
});

// 输出：
// date: 2024-11-16 (confidence: 0.9)
// time: 15:00 (confidence: 0.85)
// priority: high (confidence: 0.95)
```

### 4. 上下文指代解析

```typescript
// 第一条消息
await jarvis.processInput('Create a task to review code');
// Jarvis 记住了 "review code" 这个任务

// 第二条消息（使用指代）
await jarvis.processInput('Set it to high priority');
// NLU 会解析 "it" 指代上一个任务

// 第三条消息
await jarvis.processInput('Make it due tomorrow');
// "it" 仍然指代同一个任务

// NLU 内部实现
const resolvedInput = nlu.resolveReferences(
    'Set it to high priority',
    context
);
// 结果: 'Set review code task to high priority'
```

### 5. 自定义 LLM Provider

```typescript
// 使用 OpenAI
nlu.setLLMProvider({
    async call(messages) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages,
                temperature: 0.3,
                max_tokens: 500,
            }),
        });
        const data = await response.json();
        return data.choices[0].message.content;
    },
});

// 使用本地模型
nlu.setLLMProvider({
    async call(messages) {
        const response = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            body: JSON.stringify({
                model: 'llama2',
                messages,
            }),
        });
        const data = await response.json();
        return data.message.content;
    },
});
```

### 6. Fallback机制

```typescript
// 即使没有 LLM Provider，NLU 也能工作（使用规则based）
const nlu = createNLUEngine();
// 不设置 LLM Provider

const intent = await nlu.understand('Create task: Review code', context);
// 仍然能识别基本意图，但准确率较低
```

## 完整示例

### 示例 1: 带语音的完整助手

```typescript
import {
    createJarvisController,
    createVoiceInterface,
    createNLUEngine,
} from './agent/jarvis';

async function setupFullJarvis() {
    // 1. 创建语音接口
    const voice = createVoiceInterface({
        enabled: true,
        asr: { provider: 'native', language: 'en-US' },
        tts: { provider: 'native', voice: 'default', rate: 1.0, volume: 0.8 },
    });

    await voice.initialize();

    // 2. 创建 NLU
    const nlu = createNLUEngine({
        provider: 'claude',
        model: 'claude-3-haiku-20240307',
    });

    nlu.setLLMProvider({
        async call(messages) {
            // 使用现有的 Claude API
            return await callClaudeAPI(messages);
        },
    });

    // 3. 创建 Jarvis
    const jarvis = createJarvisController({
        name: 'Jarvis',
        enableDaemon: true,
        enableProactive: true,
        enableVoice: true,
    });

    await jarvis.initialize();

    // 4. 设置事件监听
    jarvis.on('proactive:greeting', ({ message }) => {
        console.log(`[Jarvis] ${message}`);
        voice.speak(message);
    });

    jarvis.on('reminder', (reminder) => {
        console.log(`[Reminder] ${reminder.message}`);
        voice.speak(reminder.message);
    });

    // 5. 主循环
    console.log('Jarvis is ready. Say "Hey Jarvis" to wake up.');

    while (true) {
        // 听用户说话
        const speechResult = await voice.startListening();

        if (speechResult.text) {
            console.log(`User: ${speechResult.text}`);

            // 处理输入
            const response = await jarvis.processInput(speechResult.text);

            // 语音回复
            if (response.text) {
                console.log(`Jarvis: ${response.text}`);
                await voice.speak(response.text);
            }

            // 显示可操作按钮
            if (response.actions) {
                response.actions.forEach(action => {
                    console.log(`[Action] ${action.label}`);
                });
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

setupFullJarvis().catch(console.error);
```

### 示例 2: 纯文本模式（无语音）

```typescript
import { createJarvisController } from './agent/jarvis';

async function setupTextJarvis() {
    const jarvis = createJarvisController({
        name: 'Jarvis',
        enableDaemon: true,
        enableProactive: true,
        enableVoice: false,  // 禁用语音
    });

    await jarvis.initialize();

    // 文本交互
    async function chat(input: string) {
        const response = await jarvis.processInput(input);
        console.log(`Jarvis: ${response.text}`);

        if (response.visual) {
            console.log('Visual elements:', response.visual);
        }

        if (response.actions) {
            console.log('Available actions:');
            response.actions.forEach(a => console.log(`  - ${a.label}`));
        }

        return response;
    }

    // 使用
    await chat('What should I do today?');
    await chat('Create task: Write documentation');
    await chat('Show my calendar');
}

setupTextJarvis().catch(console.error);
```

### 示例 3: 集成到现有应用

```typescript
// 在你的主应用中
import { getJarvisController } from './agent/jarvis';

export class YourApp {
    private jarvis = getJarvisController();

    async initialize() {
        // 初始化 Jarvis
        await this.jarvis.initialize();

        // 设置监听器
        this.setupJarvisListeners();
    }

    private setupJarvisListeners() {
        // 监听提醒
        this.jarvis.on('reminder', (reminder) => {
            this.showNotification(reminder.message);
        });

        // 监听主动建议
        this.jarvis.on('proactive:suggestion', (suggestion) => {
            this.showSuggestion(suggestion);
        });
    }

    async handleUserInput(input: string) {
        // 处理用户输入
        const response = await this.jarvis.processInput(input);

        // 显示响应
        this.displayResponse(response);

        return response;
    }

    async getTaskSuggestion() {
        // 获取任务建议
        const suggestions = await this.jarvis.generateProactiveSuggestions();
        return suggestions;
    }
}
```

## Tauri前端集成

### React组件示例

```typescript
// src/components/JarvisInterface.tsx
import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api';

export const JarvisInterface: React.FC = () => {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Array<{role: string; content: string}>>([]);
    const [listening, setListening] = useState(false);

    // 发送消息
    const sendMessage = async () => {
        if (!input.trim()) return;

        // 添加用户消息
        setMessages(prev => [...prev, { role: 'user', content: input }]);

        // 调用 Jarvis (通过 Tauri backend)
        const response = await invoke('jarvis_process_input', { input });

        // 添加 Jarvis 响应
        setMessages(prev => [...prev, {
            role: 'assistant',
            content: response.text,
        }]);

        setInput('');
    };

    // 语音输入
    const startVoiceInput = async () => {
        setListening(true);
        const speechResult = await invoke('jarvis_voice_listen');
        setListening(false);

        if (speechResult.text) {
            setInput(speechResult.text);
        }
    };

    return (
        <div className="jarvis-interface">
            <div className="messages">
                {messages.map((msg, i) => (
                    <div key={i} className={`message ${msg.role}`}>
                        {msg.content}
                    </div>
                ))}
            </div>

            <div className="input-area">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="Ask Jarvis..."
                />
                <button onClick={sendMessage}>Send</button>
                <button
                    onClick={startVoiceInput}
                    disabled={listening}
                >
                    {listening ? '🎤 Listening...' : '🎤'}
                </button>
            </div>
        </div>
    );
};
```

### Tauri Backend Commands

```rust
// src-tauri/src/main.rs
#[tauri::command]
async fn jarvis_process_input(input: String) -> Result<JarvisResponse, String> {
    // 调用 sidecar 中的 Jarvis
    let response = jarvis_controller.process_input(&input).await
        .map_err(|e| e.to_string())?;

    Ok(response)
}

#[tauri::command]
async fn jarvis_voice_listen() -> Result<SpeechResult, String> {
    let result = voice_interface.start_listening().await
        .map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
async fn jarvis_speak(text: String) -> Result<(), String> {
    voice_interface.speak(&text).await
        .map_err(|e| e.to_string())?;

    Ok(())
}
```

## 故障排查

### 问题 1: 语音功能不工作

**症状**: TTS 或 ASR 失败

**解决方案**:
```typescript
const voice = createVoiceInterface();
await voice.initialize();

// 检查可用性
const availability = voice.isAvailable();
if (!availability.tts) {
    console.log('Native TTS not available');
    // 切换到插件模式
    voice.updateConfig({
        tts: { provider: 'plugin' }
    });
}
```

### 问题 2: NLU 理解不准确

**症状**: 意图识别错误

**解决方案**:
```typescript
// 1. 确保 LLM Provider 已设置
nlu.setLLMProvider(yourProvider);

// 2. 检查温度设置
nlu.updateConfig({ temperature: 0.2 });  // 更低的温度

// 3. 使用更强大的模型
nlu.updateConfig({
    model: 'claude-3-sonnet-20240229',  // 从 haiku 升级到 sonnet
});
```

### 问题 3: 守护进程消耗资源

**症状**: CPU/内存使用率高

**解决方案**:
```typescript
const daemon = getDaemonService();

// 调整检查间隔
await daemon.updateConfig({
    environmentCheckInterval: 60000,   // 从30秒改为1分钟
    calendarCheckInterval: 600000,     // 从5分钟改为10分钟
});

// 或暂停守护进程
daemon.pause();

// 需要时恢复
await daemon.resume();
```

### 问题 4: 内存泄漏

**症状**: 长时间运行后内存持续增长

**解决方案**:
```typescript
// 限制对话历史
nlu.updateConfig({
    contextWindow: 5,  // 只保留最近5条消息
});

// 定期清理
setInterval(() => {
    context.conversationHistory = context.conversationHistory.slice(-10);
    context.referencedEntities.clear();
}, 3600000);  // 每小时清理一次
```

## 性能优化

### 1. 使用更快的模型
```typescript
const nlu = createNLUEngine({
    model: 'claude-3-haiku-20240307',  // 最快
    temperature: 0.3,
    maxTokens: 300,  // 减少 token 数量
});
```

### 2. 缓存常见意图
```typescript
const intentCache = new Map<string, Intent>();

async function understandWithCache(input: string, context: Context) {
    const cacheKey = input.toLowerCase().trim();

    if (intentCache.has(cacheKey)) {
        return intentCache.get(cacheKey)!;
    }

    const intent = await nlu.understand(input, context);
    intentCache.set(cacheKey, intent);

    return intent;
}
```

### 3. 异步处理
```typescript
// 不阻塞主线程
jarvis.on('reminder', async (reminder) => {
    // 异步发送通知
    setImmediate(async () => {
        await sendNotification(reminder);
    });
});
```

## 下一步

- [ ] 实现 Google Calendar 集成
- [ ] 实现 Gmail 集成
- [ ] 添加更多语音唤醒词
- [ ] 创建 Web UI 仪表盘
- [ ] 支持更多语言

## 反馈

遇到问题或有建议？请创建 Issue 或 PR！
