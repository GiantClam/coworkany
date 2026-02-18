/**
 * CoworkAny - Jarvis Controller (贾维斯主控制器)
 *
 * 整合所有模块，提供类似贾维斯的个人助理体验
 */

import { EventEmitter } from 'events';
import { DaemonService, createDaemonService } from './daemonService';
import { ProactiveTaskManager, createProactiveTaskManager } from './proactiveTaskManager';
import type {
    Intent,
    Context,
    Message,
    MultimodalResponse,
    CalendarSummary,
    EmailSummary,
    ProactiveSuggestion,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface JarvisConfig {
    name: string;  // e.g., "Jarvis", "Friday"
    storagePath: string;
    enableDaemon: boolean;
    enableVoice: boolean;
    enableProactive: boolean;
}

export const DEFAULT_JARVIS_CONFIG: JarvisConfig = {
    name: 'Jarvis',
    storagePath: '~/.coworkany/jarvis',
    enableDaemon: true,
    enableVoice: false,  // 默认关闭语音，需要用户明确启用
    enableProactive: true,
};

// ============================================================================
// JarvisController Class
// ============================================================================

/**
 * @deprecated Use Unified Core Skills (tools/core/*) instead.
 * This controller is being phased out in favor of the Unified Capability Model.
 */
export class JarvisController extends EventEmitter {
    private config: JarvisConfig;
    private daemon?: DaemonService;
    private taskManager: ProactiveTaskManager;
    private context: Context;
    private isInitialized: boolean;

    constructor(config?: Partial<JarvisConfig>) {
        super();
        this.config = { ...DEFAULT_JARVIS_CONFIG, ...config };
        this.isInitialized = false;

        // Initialize context
        this.context = {
            conversationHistory: [],
            referencedEntities: new Map(),
            userPreferences: {},
        };

        // Initialize task manager
        this.taskManager = createProactiveTaskManager(this.config.storagePath);
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * 初始化贾维斯系统
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.log('[Jarvis] Already initialized');
            return;
        }

        console.log(`[${this.config.name}] Initializing...`);

        try {
            // 启动守护进程
            if (this.config.enableDaemon) {
                this.daemon = createDaemonService();
                this.setupDaemonListeners();
                await this.daemon.start();
            }

            this.isInitialized = true;
            console.log(`[${this.config.name}] Initialization complete`);

            // 主动问候
            if (this.config.enableProactive) {
                await this.greetUser();
            }
        } catch (error) {
            console.error(`[${this.config.name}] Initialization failed:`, error);
            throw error;
        }
    }

    /**
     * 关闭贾维斯系统
     */
    async shutdown(): Promise<void> {
        console.log(`[${this.config.name}] Shutting down...`);

        if (this.daemon) {
            await this.daemon.stop();
        }

        this.isInitialized = false;
        console.log(`[${this.config.name}] Shutdown complete`);
    }

    // ========================================================================
    // Main Interaction
    // ========================================================================

    /**
     * 处理用户输入（文本或语音）
     */
    async processInput(input: string): Promise<MultimodalResponse> {
        console.log(`[${this.config.name}] Processing: "${input}"`);

        // 添加到对话历史
        this.addToHistory('user', input);

        try {
            // 1. 理解意图 (NLU)
            const intent = await this.understandIntent(input);

            // 2. 执行相应操作
            const result = await this.executeIntent(intent);

            // 3. 生成响应
            const response = await this.generateResponse(result, intent);

            // 添加到对话历史
            if (response.text) {
                this.addToHistory('assistant', response.text);
            }

            return response;
        } catch (error) {
            console.error(`[${this.config.name}] Error processing input:`, error);

            return {
                mode: 'text',
                text: `I apologize, but I encountered an error: ${error}. Could you please try rephrasing?`,
            };
        }
    }

    /**
     * 理解用户意图
     */
    private async understandIntent(input: string): Promise<Intent> {
        // 简单的意图识别（实际应使用 NLU 模型）
        const lowerInput = input.toLowerCase();

        // 任务相关
        if (lowerInput.includes('create task') || lowerInput.includes('add task') || lowerInput.includes('new task')) {
            return {
                type: 'task_create',
                confidence: 0.9,
                entities: this.extractEntities(input),
                slots: { title: input.replace(/create task|add task|new task/i, '').trim() },
            };
        }

        if (lowerInput.includes('my tasks') || lowerInput.includes('what should i do') || lowerInput.includes('next task')) {
            return {
                type: 'task_query',
                confidence: 0.95,
                entities: [],
                slots: {},
            };
        }

        // 日历相关
        if (lowerInput.includes('calendar') || lowerInput.includes('schedule') || lowerInput.includes('meeting')) {
            return {
                type: 'calendar_check',
                confidence: 0.85,
                entities: this.extractEntities(input),
                slots: {},
            };
        }

        // 邮件相关
        if (lowerInput.includes('email') || lowerInput.includes('mail') || lowerInput.includes('inbox')) {
            return {
                type: 'email_check',
                confidence: 0.85,
                entities: [],
                slots: {},
            };
        }

        // 学习相关
        if (lowerInput.includes('learn') || lowerInput.includes('how to')) {
            return {
                type: 'learn_new',
                confidence: 0.8,
                entities: this.extractEntities(input),
                slots: { topic: input },
            };
        }

        // 默认：问答
        return {
            type: 'question_answer',
            confidence: 0.6,
            entities: [],
            slots: { question: input },
        };
    }

    /**
     * 提取实体
     */
    private extractEntities(text: string): Array<any> {
        const entities: Array<any> = [];

        // 简单的日期识别
        const datePatterns = [
            /tomorrow/i,
            /today/i,
            /next week/i,
            /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i,
        ];

        for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
                entities.push({
                    type: 'date',
                    value: match[0],
                    raw: match[0],
                    confidence: 0.8,
                    position: [match.index!, match.index! + match[0].length],
                });
            }
        }

        return entities;
    }

    /**
     * 执行意图
     */
    private async executeIntent(intent: Intent): Promise<any> {
        switch (intent.type) {
            case 'task_create':
                return this.handleTaskCreate(intent);

            case 'task_query':
                return this.handleTaskQuery(intent);

            case 'calendar_check':
                return this.handleCalendarCheck(intent);

            case 'email_check':
                return this.handleEmailCheck(intent);

            case 'learn_new':
                return this.handleLearning(intent);

            case 'question_answer':
                return this.handleQuestionAnswer(intent);

            default:
                return { error: 'Unknown intent type' };
        }
    }

    /**
     * 生成响应
     */
    private async generateResponse(result: any, intent: Intent): Promise<MultimodalResponse> {
        // 基于结果生成多模态响应
        const response: MultimodalResponse = {
            mode: 'text',
        };

        if (result.error) {
            response.text = `I encountered an issue: ${result.error}`;
            return response;
        }

        switch (intent.type) {
            case 'task_create':
                response.text = `Task created: "${result.task.title}". ${result.task.dueDate
                        ? `Due ${new Date(result.task.dueDate).toLocaleDateString()}.`
                        : ''
                    } Priority: ${result.task.priority}.`;
                break;

            case 'task_query':
                const suggestion = this.taskManager.suggestNextAction();
                if (suggestion) {
                    response.text = `${suggestion.title}. ${suggestion.description}`;
                    response.actions = suggestion.actions as any;
                }
                break;

            case 'calendar_check':
                response.text = result.summary || 'Calendar information retrieved.';
                response.visual = result.events ? [{
                    type: 'list',
                    data: result.events,
                    title: 'Upcoming Events',
                }] : undefined;
                break;

            case 'email_check':
                response.text = result.summary || 'Email summary ready.';
                break;

            default:
                response.text = result.answer || 'I\'ve processed your request.';
        }

        return response;
    }

    // ========================================================================
    // Intent Handlers
    // ========================================================================

    private async handleTaskCreate(intent: Intent): Promise<any> {
        const title = intent.slots.title || 'Untitled Task';

        // 从实体中提取信息
        const dateEntity = intent.entities.find(e => e.type === 'date');
        let dueDate: string | undefined;

        if (dateEntity) {
            // 简单的日期解析
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            dueDate = tomorrow.toISOString();
        }

        const task = this.taskManager.createTask({
            title,
            description: '',
            priority: 'medium',
            status: 'pending',
            tags: [],
            dependencies: [],
            dueDate,
        });

        return { task };
    }

    private async handleTaskQuery(intent: Intent): Promise<any> {
        const suggestion = this.taskManager.suggestNextAction();
        const stats = this.taskManager.getStatistics();

        return {
            suggestion,
            stats,
            overdue: this.taskManager.getOverdueTasks(),
            upcoming: this.taskManager.getUpcomingTasks(24),
        };
    }

    private async handleCalendarCheck(intent: Intent): Promise<any> {
        // 占位实现
        return {
            summary: 'You have 2 meetings today at 10:00 AM and 2:00 PM.',
            events: [
                {
                    title: 'Team Standup',
                    startTime: new Date().toISOString(),
                },
            ],
        };
    }

    private async handleEmailCheck(intent: Intent): Promise<any> {
        // 占位实现
        return {
            summary: 'You have 5 unread emails, 2 marked as important.',
        };
    }

    private async handleLearning(intent: Intent): Promise<any> {
        const topic = intent.slots.topic;

        return {
            answer: `I'll research "${topic}" and learn how to help you with it.`,
            learning: true,
        };
    }

    private async handleQuestionAnswer(intent: Intent): Promise<any> {
        const question = intent.slots.question;

        return {
            answer: `I'm processing your question: "${question}"`,
        };
    }

    // ========================================================================
    // Proactive Features
    // ========================================================================

    /**
     * 主动问候用户
     */
    private async greetUser(): Promise<void> {
        const hour = new Date().getHours();
        let greeting = 'Hello';

        if (hour < 12) greeting = 'Good morning';
        else if (hour < 18) greeting = 'Good afternoon';
        else greeting = 'Good evening';

        const stats = this.taskManager.getStatistics();
        const overdue = this.taskManager.getOverdueTasks();
        const upcoming = this.taskManager.getUpcomingTasks(4);

        let message = `${greeting}. `;

        if (overdue.length > 0) {
            message += `You have ${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}. `;
        }

        if (upcoming.length > 0) {
            message += `${upcoming.length} task${upcoming.length > 1 ? 's' : ''} due in the next 4 hours. `;
        }

        if (stats.dueToday > 0) {
            message += `${stats.dueToday} task${stats.dueToday > 1 ? 's' : ''} due today. `;
        }

        console.log(`[${this.config.name}] ${message}`);
        this.emit('proactive:greeting', { message });
    }

    /**
     * 生成主动建议
     */
    async generateProactiveSuggestions(): Promise<ProactiveSuggestion[]> {
        const suggestions: ProactiveSuggestion[] = [];

        // 检查逾期任务
        const overdue = this.taskManager.getOverdueTasks();
        if (overdue.length > 0) {
            suggestions.push({
                id: crypto.randomUUID(),
                type: 'warning',
                priority: 'high',
                title: 'Overdue tasks',
                message: `You have ${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`,
                reasoning: ['Tasks past due date'],
                timestamp: new Date().toISOString(),
                dismissed: false,
            });
        }

        // 检查即将到期的任务
        const upcoming = this.taskManager.getUpcomingTasks(2);
        if (upcoming.length > 0) {
            suggestions.push({
                id: crypto.randomUUID(),
                type: 'reminder',
                priority: 'medium',
                title: 'Upcoming deadlines',
                message: `${upcoming.length} task${upcoming.length > 1 ? 's' : ''} due in the next 2 hours`,
                reasoning: ['Tasks approaching deadline'],
                timestamp: new Date().toISOString(),
                dismissed: false,
            });
        }

        // 任务建议
        const nextAction = this.taskManager.suggestNextAction();
        if (nextAction && nextAction.actionable) {
            suggestions.push({
                id: crypto.randomUUID(),
                type: 'suggestion',
                priority: 'medium',
                title: nextAction.title,
                message: nextAction.description,
                reasoning: nextAction.reasoning,
                timestamp: new Date().toISOString(),
                actions: nextAction.actions as any,
                dismissed: false,
            });
        }

        return suggestions;
    }

    // ========================================================================
    // Daemon Integration
    // ========================================================================

    private setupDaemonListeners(): void {
        if (!this.daemon) return;

        // 监听守护进程事件
        this.daemon.on('calendar:check_requested', async () => {
            // 检查日历并生成提醒
            console.log(`[${this.config.name}] Checking calendar...`);
        });

        this.daemon.on('email:check_requested', async () => {
            // 检查邮件并生成提醒
            console.log(`[${this.config.name}] Checking emails...`);
        });

        this.daemon.on('tasks:check_requested', async () => {
            // 检查任务并发送提醒
            const reminders = this.taskManager.getPendingReminders();
            for (const reminder of reminders) {
                this.emit('reminder', reminder);
                this.taskManager.markReminderSent(reminder.id);
            }
        });
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    private addToHistory(role: 'user' | 'assistant', content: string): void {
        this.context.conversationHistory.push({
            role,
            content,
            timestamp: new Date().toISOString(),
        });

        // 保留最近50条
        if (this.context.conversationHistory.length > 50) {
            this.context.conversationHistory = this.context.conversationHistory.slice(-50);
        }
    }

    /**
     * 获取系统状态
     */
    getStatus(): {
        initialized: boolean;
        daemonRunning: boolean;
        taskStats: any;
    } {
        return {
            initialized: this.isInitialized,
            daemonRunning: this.daemon?.getState() === 'running',
            taskStats: this.taskManager.getStatistics(),
        };
    }
}

// ============================================================================
// Factory & Singleton
// ============================================================================

let jarvisInstance: JarvisController | null = null;

export function getJarvisController(): JarvisController {
    if (!jarvisInstance) {
        jarvisInstance = new JarvisController();
    }
    return jarvisInstance;
}

export function createJarvisController(config?: Partial<JarvisConfig>): JarvisController {
    jarvisInstance = new JarvisController(config);
    return jarvisInstance;
}
