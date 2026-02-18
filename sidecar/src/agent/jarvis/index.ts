/**
 * CoworkAny - Jarvis Personal Assistant System
 *
 * 贾维斯级个人助理系统
 *
 * 核心能力：
 * - 🤖 守护进程：24/7 持续运行
 * - 📋 主动任务管理：智能提醒、优先级、建议
 * - 🗣️ 语音交互：语音输入/输出（计划中）
 * - 🧠 自然语言理解：上下文感知对话
 * - 📊 多模态输出：文本、语音、可视化
 * - 📅 日历集成：会议提醒、智能调度
 * - 📧 邮件集成：重要邮件提醒、智能分类
 */

// Types
export * from './types';

// Core Modules
export { DaemonService, createDaemonService, getDaemonService } from './daemonService';
export { ProactiveTaskManager, createProactiveTaskManager } from './proactiveTaskManager';
export { JarvisController, createJarvisController, getJarvisController } from './jarvisController';

// Voice & NLU (NEW)
export { VoiceInterface, createVoiceInterface } from './voiceInterface';
export { NLUEngine, createNLUEngine } from './nluEngine';

// Re-export common types for convenience
export type {
    Task,
    TaskPriority,
    TaskStatus,
    Reminder,
    Suggestion,
} from './proactiveTaskManager';

export type {
    DaemonState,
    DaemonConfig,
    DaemonEvent,
} from './daemonService';

export type {
    JarvisConfig,
} from './jarvisController';
