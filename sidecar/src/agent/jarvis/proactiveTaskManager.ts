/**
 * CoworkAny - Proactive Task Manager (主动任务管理器)
 *
 * 像贾维斯一样主动管理任务：
 * - 智能提醒
 * - 建议下一步行动
 * - 优先级管理
 * - 截止日期跟踪
 * - 自动调度
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface Task {
    id: string;
    title: string;
    description: string;
    priority: TaskPriority;
    status: TaskStatus;
    createdAt: string;
    updatedAt: string;
    dueDate?: string;
    estimatedMinutes?: number;
    tags: string[];
    dependencies: string[];  // Task IDs
    blockedBy?: string[];     // Task IDs
    relatedCalendarEvent?: string;
    relatedEmails?: string[];
    context?: Record<string, unknown>;
}

export interface Reminder {
    id: string;
    taskId: string;
    type: 'deadline' | 'followup' | 'suggestion' | 'proactive';
    message: string;
    scheduledFor: string;
    sent: boolean;
    priority: TaskPriority;
}

export interface Suggestion {
    id: string;
    type: 'next_action' | 'time_slot' | 'optimization' | 'learning';
    title: string;
    description: string;
    confidence: number;  // 0-1
    reasoning: string[];
    actionable: boolean;
    actions?: Array<{
        label: string;
        command: string;
    }>;
}

export interface TaskManagerConfig {
    // 提醒设置
    enableReminders: boolean;
    reminderLeadTimes: number[];  // 提前提醒时间（分钟）[60, 30, 10]

    // 主动建议
    enableSuggestions: boolean;
    minSuggestionConfidence: number;

    // 优先级规则
    autoPrioritize: boolean;
    urgentThresholdHours: number;  // 多少小时内算紧急

    // 工作模式
    focusMode: boolean;
    focusModeDuration: number;  // 专注模式持续时间（分钟）
}

export const DEFAULT_TASK_MANAGER_CONFIG: TaskManagerConfig = {
    enableReminders: true,
    reminderLeadTimes: [60, 30, 10],  // 提前1小时、30分钟、10分钟

    enableSuggestions: true,
    minSuggestionConfidence: 0.6,

    autoPrioritize: true,
    urgentThresholdHours: 4,

    focusMode: false,
    focusModeDuration: 25,  // 番茄工作法
};

// ============================================================================
// ProactiveTaskManager Class
// ============================================================================

export class ProactiveTaskManager {
    private config: TaskManagerConfig;
    private tasks: Map<string, Task>;
    private reminders: Map<string, Reminder>;
    private storagePath: string;

    constructor(storagePath: string, config?: Partial<TaskManagerConfig>) {
        this.config = { ...DEFAULT_TASK_MANAGER_CONFIG, ...config };
        this.storagePath = storagePath;
        this.tasks = new Map();
        this.reminders = new Map();

        this.load();
    }

    // ========================================================================
    // Task Management
    // ========================================================================

    /**
     * 创建任务
     */
    createTask(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
        const task: Task = {
            id: crypto.randomUUID(),
            ...taskData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // 自动优先级
        if (this.config.autoPrioritize) {
            task.priority = this.calculatePriority(task);
        }

        this.tasks.set(task.id, task);

        // 创建提醒
        if (task.dueDate && this.config.enableReminders) {
            this.createRemindersForTask(task);
        }

        this.save();
        return task;
    }

    /**
     * 更新任务
     */
    updateTask(taskId: string, updates: Partial<Task>): Task | null {
        const task = this.tasks.get(taskId);
        if (!task) return null;

        const updated: Task = {
            ...task,
            ...updates,
            updatedAt: new Date().toISOString(),
        };

        this.tasks.set(taskId, updated);

        // 更新提醒
        if (updated.dueDate && this.config.enableReminders) {
            this.updateRemindersForTask(updated);
        }

        this.save();
        return updated;
    }

    /**
     * 删除任务
     */
    deleteTask(taskId: string): boolean {
        const deleted = this.tasks.delete(taskId);

        // 删除相关提醒
        for (const [id, reminder] of this.reminders) {
            if (reminder.taskId === taskId) {
                this.reminders.delete(id);
            }
        }

        if (deleted) {
            this.save();
        }

        return deleted;
    }

    /**
     * 获取任务
     */
    getTask(taskId: string): Task | null {
        return this.tasks.get(taskId) || null;
    }

    /**
     * 列出所有任务
     */
    listTasks(filters?: {
        status?: TaskStatus[];
        priority?: TaskPriority[];
        tags?: string[];
        dueBefore?: string;
    }): Task[] {
        let tasks = [...this.tasks.values()];

        if (filters) {
            if (filters.status) {
                tasks = tasks.filter(t => filters.status!.includes(t.status));
            }
            if (filters.priority) {
                tasks = tasks.filter(t => filters.priority!.includes(t.priority));
            }
            if (filters.tags) {
                tasks = tasks.filter(t =>
                    filters.tags!.some(tag => t.tags.includes(tag))
                );
            }
            if (filters.dueBefore) {
                tasks = tasks.filter(t =>
                    t.dueDate && t.dueDate <= filters.dueBefore!
                );
            }
        }

        return tasks.sort((a, b) => {
            // 按优先级排序
            const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
    }

    // ========================================================================
    // Proactive Features
    // ========================================================================

    /**
     * 建议下一步行动
     */
    suggestNextAction(): Suggestion | null {
        const pendingTasks = this.listTasks({ status: ['pending', 'in_progress'] });

        if (pendingTasks.length === 0) {
            return {
                id: crypto.randomUUID(),
                type: 'next_action',
                title: 'No pending tasks',
                description: 'Great! You have no pending tasks. Consider learning something new or reviewing completed tasks.',
                confidence: 1.0,
                reasoning: ['No tasks in queue'],
                actionable: false,
            };
        }

        // 找到最高优先级且未阻塞的任务
        const nextTask = pendingTasks.find(t => !t.blockedBy || t.blockedBy.length === 0);

        if (!nextTask) {
            return {
                id: crypto.randomUUID(),
                type: 'next_action',
                title: 'All tasks are blocked',
                description: 'All pending tasks are blocked by dependencies. Consider unblocking them.',
                confidence: 0.9,
                reasoning: ['All tasks have blocking dependencies'],
                actionable: true,
                actions: [
                    { label: 'View blocked tasks', command: 'list:blocked' },
                ],
            };
        }

        const urgency = this.isUrgent(nextTask) ? 'urgent' : 'normal';

        return {
            id: crypto.randomUUID(),
            type: 'next_action',
            title: `Work on: ${nextTask.title}`,
            description: nextTask.description,
            confidence: 0.85,
            reasoning: [
                `Priority: ${nextTask.priority}`,
                `Status: ${nextTask.status}`,
                urgency === 'urgent' ? 'Due soon!' : 'In pipeline',
            ],
            actionable: true,
            actions: [
                { label: 'Start task', command: `task:start:${nextTask.id}` },
                { label: 'View details', command: `task:view:${nextTask.id}` },
            ],
        };
    }

    /**
     * 获取即将到期的任务
     */
    getUpcomingTasks(hoursAhead: number = 24): Task[] {
        const now = new Date();
        const futureTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

        return this.listTasks({
            status: ['pending', 'in_progress'],
        }).filter(task => {
            if (!task.dueDate) return false;
            const dueDate = new Date(task.dueDate);
            return dueDate >= now && dueDate <= futureTime;
        });
    }

    /**
     * 获取逾期任务
     */
    getOverdueTasks(): Task[] {
        const now = new Date();

        return this.listTasks({
            status: ['pending', 'in_progress'],
        }).filter(task => {
            if (!task.dueDate) return false;
            return new Date(task.dueDate) < now;
        });
    }

    /**
     * 建议时间分配
     */
    suggestTimeSlots(): Suggestion[] {
        const suggestions: Suggestion[] = [];

        // 检查是否有需要长时间的任务
        const longTasks = this.listTasks({
            status: ['pending'],
        }).filter(t => t.estimatedMinutes && t.estimatedMinutes > 60);

        if (longTasks.length > 0) {
            suggestions.push({
                id: crypto.randomUUID(),
                type: 'time_slot',
                title: 'Schedule long tasks',
                description: `You have ${longTasks.length} tasks requiring 60+ minutes. Consider blocking time on your calendar.`,
                confidence: 0.8,
                reasoning: [
                    `${longTasks.length} long tasks detected`,
                    'Long tasks benefit from dedicated time blocks',
                ],
                actionable: true,
                actions: [
                    { label: 'View long tasks', command: 'list:long_tasks' },
                    { label: 'Schedule now', command: 'calendar:schedule_tasks' },
                ],
            });
        }

        // 检查是否建议番茄工作法
        const shortTasks = this.listTasks({
            status: ['pending'],
        }).filter(t => !t.estimatedMinutes || t.estimatedMinutes <= 30);

        if (shortTasks.length >= 3) {
            suggestions.push({
                id: crypto.randomUUID(),
                type: 'time_slot',
                title: 'Batch small tasks',
                description: `You have ${shortTasks.length} short tasks. Consider using Pomodoro technique (25-minute focus sessions).`,
                confidence: 0.75,
                reasoning: [
                    `${shortTasks.length} short tasks detected`,
                    'Small tasks are efficient when batched',
                ],
                actionable: true,
                actions: [
                    { label: 'Start focus session', command: 'focus:start' },
                ],
            });
        }

        return suggestions;
    }

    /**
     * 自动优化任务顺序
     */
    optimizeTaskOrder(): Suggestion {
        const tasks = this.listTasks({ status: ['pending'] });

        // 使用简单的启发式算法优化顺序
        const optimized = tasks.sort((a, b) => {
            // 1. 优先级权重
            const priorityWeight = { critical: 100, high: 50, medium: 20, low: 10 };
            let scoreA = priorityWeight[a.priority];
            let scoreB = priorityWeight[b.priority];

            // 2. 截止日期权重
            if (a.dueDate) {
                const daysUntilA = this.getDaysUntil(a.dueDate);
                scoreA += Math.max(0, 50 - daysUntilA * 5);
            }
            if (b.dueDate) {
                const daysUntilB = this.getDaysUntil(b.dueDate);
                scoreB += Math.max(0, 50 - daysUntilB * 5);
            }

            // 3. 依赖关系（没有依赖的优先）
            if (a.dependencies.length === 0 && b.dependencies.length > 0) {
                scoreA += 30;
            } else if (b.dependencies.length === 0 && a.dependencies.length > 0) {
                scoreB += 30;
            }

            return scoreB - scoreA;
        });

        return {
            id: crypto.randomUUID(),
            type: 'optimization',
            title: 'Optimized task order',
            description: `Reordered ${tasks.length} tasks based on priority, deadlines, and dependencies.`,
            confidence: 0.7,
            reasoning: [
                'Considered priority levels',
                'Factored in due dates',
                'Respected dependencies',
            ],
            actionable: true,
            actions: [
                { label: 'View optimized list', command: 'list:optimized' },
                { label: 'Apply order', command: 'apply:optimized_order' },
            ],
        };
    }

    // ========================================================================
    // Reminders
    // ========================================================================

    private createRemindersForTask(task: Task): void {
        if (!task.dueDate) return;

        const dueDate = new Date(task.dueDate);

        for (const leadTime of this.config.reminderLeadTimes) {
            const reminderTime = new Date(dueDate.getTime() - leadTime * 60 * 1000);

            // 不创建过去的提醒
            if (reminderTime < new Date()) continue;

            const reminder: Reminder = {
                id: crypto.randomUUID(),
                taskId: task.id,
                type: 'deadline',
                message: `Task "${task.title}" is due in ${leadTime} minutes`,
                scheduledFor: reminderTime.toISOString(),
                sent: false,
                priority: task.priority,
            };

            this.reminders.set(reminder.id, reminder);
        }
    }

    private updateRemindersForTask(task: Task): void {
        // 删除旧提醒
        for (const [id, reminder] of this.reminders) {
            if (reminder.taskId === task.id && !reminder.sent) {
                this.reminders.delete(id);
            }
        }

        // 创建新提醒
        if (task.dueDate) {
            this.createRemindersForTask(task);
        }
    }

    /**
     * 获取待发送的提醒
     */
    getPendingReminders(): Reminder[] {
        const now = new Date();

        return [...this.reminders.values()].filter(r =>
            !r.sent && new Date(r.scheduledFor) <= now
        );
    }

    /**
     * 标记提醒已发送
     */
    markReminderSent(reminderId: string): void {
        const reminder = this.reminders.get(reminderId);
        if (reminder) {
            reminder.sent = true;
            this.save();
        }
    }

    // ========================================================================
    // Calendar & Email Integration
    // ========================================================================

    /**
     * Link calendar event to task
     */
    linkCalendarEvent(taskId: string, eventId: string): Task | null {
        const task = this.getTask(taskId);
        if (!task) return null;

        return this.updateTask(taskId, {
            relatedCalendarEvent: eventId,
        });
    }

    /**
     * Link emails to task
     */
    linkEmails(taskId: string, emailIds: string[]): Task | null {
        const task = this.getTask(taskId);
        if (!task) return null;

        const existingEmails = task.relatedEmails || [];
        const updatedEmails = [...new Set([...existingEmails, ...emailIds])];

        return this.updateTask(taskId, {
            relatedEmails: updatedEmails,
        });
    }

    /**
     * Suggest tasks based on calendar events
     * Requires CalendarManager to be initialized
     */
    async suggestTasksFromCalendar(workspacePath: string): Promise<Suggestion[]> {
        try {
            const { getCalendarManager } = await import('../../integrations/calendar/calendarManager');
            const calendarManager = getCalendarManager(workspacePath);

            if (!calendarManager.isConfigured()) {
                return [];
            }

            // Get upcoming events
            const now = new Date();
            const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

            const events = await calendarManager.getEvents({
                timeMin: now.toISOString(),
                timeMax: tomorrow.toISOString(),
            });

            const suggestions: Suggestion[] = [];

            // Find events without preparation tasks
            for (const event of events) {
                // Check if task already exists for this event
                const existingTask = this.listTasks().find(t =>
                    t.relatedCalendarEvent === event.id
                );

                if (!existingTask) {
                    // Suggest preparation task
                    const eventTime = new Date(event.startTime);
                    const hoursUntil = (eventTime.getTime() - now.getTime()) / (1000 * 60 * 60);

                    if (hoursUntil > 0 && hoursUntil < 24) {
                        suggestions.push({
                            id: crypto.randomUUID(),
                            type: 'next_action',
                            title: `Prepare for: ${event.title}`,
                            description: `Meeting starts ${new Date(event.startTime).toLocaleString()}. Consider creating a preparation task.`,
                            confidence: 0.8,
                            reasoning: [
                                `Event "${event.title}" in ${Math.round(hoursUntil)} hours`,
                                'No preparation task found',
                                'Recommended to prepare materials',
                            ],
                            actionable: true,
                            actions: [
                                {
                                    label: 'Create preparation task',
                                    command: `task:create:prepare_${event.id}`,
                                },
                            ],
                        });
                    }
                }
            }

            return suggestions;
        } catch (error) {
            console.warn('[TaskManager] Failed to suggest from calendar:', error);
            return [];
        }
    }

    /**
     * Suggest tasks based on emails
     * Requires EmailManager to be initialized
     */
    async suggestTasksFromEmails(workspacePath: string): Promise<Suggestion[]> {
        try {
            const { getEmailManager } = await import('../../integrations/email/emailManager');
            const emailManager = getEmailManager(workspacePath);

            if (!emailManager.isConfigured()) {
                return [];
            }

            // Get action-required emails
            const unreadEmails = await emailManager.getMessages({
                unreadOnly: true,
                maxResults: 20,
            });

            const actionRequired = emailManager.filterActionRequired(unreadEmails);

            const suggestions: Suggestion[] = [];

            // Create task suggestions for action-required emails
            for (const email of actionRequired) {
                // Check if task already exists for this email
                const existingTask = this.listTasks().find(t =>
                    t.relatedEmails?.includes(email.id)
                );

                if (!existingTask) {
                    // Extract action from email
                    const action = this.extractActionFromEmail(email);

                    suggestions.push({
                        id: crypto.randomUUID(),
                        type: 'next_action',
                        title: `Action required: ${action}`,
                        description: `From ${email.from}: ${email.subject}`,
                        confidence: 0.75,
                        reasoning: [
                            'Email contains action keywords',
                            'Currently unread',
                            'No related task found',
                        ],
                        actionable: true,
                        actions: [
                            {
                                label: 'Create task from email',
                                command: `task:create:email_${email.id}`,
                            },
                        ],
                    });
                }
            }

            return suggestions;
        } catch (error) {
            console.warn('[TaskManager] Failed to suggest from emails:', error);
            return [];
        }
    }

    /**
     * Suggest optimal work time based on calendar
     */
    async suggestOptimalWorkTime(
        workspacePath: string,
        taskMinutes: number
    ): Promise<Suggestion | null> {
        try {
            const { getCalendarManager } = await import('../../integrations/calendar/calendarManager');
            const calendarManager = getCalendarManager(workspacePath);

            if (!calendarManager.isConfigured()) {
                return null;
            }

            // Find free slots today and tomorrow
            const now = new Date();
            const tomorrow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

            const freeSlots = await calendarManager.findFreeSlots({
                durationMinutes: taskMinutes,
                timeMin: now.toISOString(),
                timeMax: tomorrow.toISOString(),
                workingHoursOnly: true,
            });

            if (freeSlots.length === 0) {
                return null;
            }

            const bestSlot = freeSlots[0];
            const slotStart = new Date(bestSlot.start);

            return {
                id: crypto.randomUUID(),
                type: 'time_slot',
                title: `Best time: ${slotStart.toLocaleTimeString()}`,
                description: `Found ${freeSlots.length} available slots for a ${taskMinutes}-minute task`,
                confidence: 0.85,
                reasoning: [
                    'Based on calendar availability',
                    'During working hours',
                    'Sufficient duration',
                ],
                actionable: true,
                actions: [
                    {
                        label: 'Block this time',
                        command: `calendar:block:${bestSlot.start}`,
                    },
                ],
            };
        } catch (error) {
            console.warn('[TaskManager] Failed to suggest optimal time:', error);
            return null;
        }
    }

    /**
     * Extract action from email content
     */
    private extractActionFromEmail(email: any): string {
        const subject = email.subject.toLowerCase();

        // Common patterns
        if (subject.includes('review')) return 'Review';
        if (subject.includes('approve')) return 'Approve';
        if (subject.includes('sign')) return 'Sign document';
        if (subject.includes('confirm')) return 'Confirm';
        if (subject.includes('respond')) return 'Respond';
        if (subject.includes('urgent')) return 'Urgent response';

        // Default
        return email.subject.replace(/^(re:|fwd:)\s*/i, '').slice(0, 50);
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    private calculatePriority(task: Task): TaskPriority {
        let score = 0;

        // 截止日期因素
        if (task.dueDate) {
            const daysUntil = this.getDaysUntil(task.dueDate);
            if (daysUntil < 1) score += 50;
            else if (daysUntil < 3) score += 30;
            else if (daysUntil < 7) score += 10;
        }

        // 估计时间因素（长任务优先规划）
        if (task.estimatedMinutes) {
            if (task.estimatedMinutes > 120) score += 20;
            else if (task.estimatedMinutes > 60) score += 10;
        }

        // 依赖关系（被依赖的优先）
        // 这需要遍历所有任务，暂时简化

        // 转换为优先级
        if (score >= 50) return 'critical';
        if (score >= 30) return 'high';
        if (score >= 10) return 'medium';
        return 'low';
    }

    private isUrgent(task: Task): boolean {
        if (!task.dueDate) return false;

        const hoursUntil = this.getHoursUntil(task.dueDate);
        return hoursUntil <= this.config.urgentThresholdHours;
    }

    private getDaysUntil(dateStr: string): number {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = date.getTime() - now.getTime();
        return diffMs / (1000 * 60 * 60 * 24);
    }

    private getHoursUntil(dateStr: string): number {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = date.getTime() - now.getTime();
        return diffMs / (1000 * 60 * 60);
    }

    // ========================================================================
    // Statistics
    // ========================================================================

    getStatistics(): {
        total: number;
        byStatus: Record<TaskStatus, number>;
        byPriority: Record<TaskPriority, number>;
        overdue: number;
        dueToday: number;
        dueThisWeek: number;
    } {
        const tasks = [...this.tasks.values()];

        const byStatus = tasks.reduce((acc, t) => {
            acc[t.status] = (acc[t.status] || 0) + 1;
            return acc;
        }, {} as Record<TaskStatus, number>);

        const byPriority = tasks.reduce((acc, t) => {
            acc[t.priority] = (acc[t.priority] || 0) + 1;
            return acc;
        }, {} as Record<TaskPriority, number>);

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

        return {
            total: tasks.length,
            byStatus,
            byPriority,
            overdue: this.getOverdueTasks().length,
            dueToday: tasks.filter(t =>
                t.dueDate && new Date(t.dueDate).toDateString() === today.toDateString()
            ).length,
            dueThisWeek: tasks.filter(t =>
                t.dueDate && new Date(t.dueDate) <= weekFromNow
            ).length,
        };
    }

    // ========================================================================
    // Persistence
    // ========================================================================

    private getTasksFilePath(): string {
        return path.join(this.storagePath, 'tasks.json');
    }

    private getRemindersFilePath(): string {
        return path.join(this.storagePath, 'reminders.json');
    }

    private load(): void {
        try {
            // Load tasks
            const tasksPath = this.getTasksFilePath();
            if (fs.existsSync(tasksPath)) {
                const data = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
                this.tasks = new Map(Object.entries(data));
            }

            // Load reminders
            const remindersPath = this.getRemindersFilePath();
            if (fs.existsSync(remindersPath)) {
                const data = JSON.parse(fs.readFileSync(remindersPath, 'utf-8'));
                this.reminders = new Map(Object.entries(data));
            }
        } catch (error) {
            console.warn('[ProactiveTaskManager] Failed to load data:', error);
        }
    }

    private save(): void {
        try {
            const dir = this.storagePath;
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Save tasks
            const tasksData = Object.fromEntries(this.tasks);
            fs.writeFileSync(
                this.getTasksFilePath(),
                JSON.stringify(tasksData, null, 2)
            );

            // Save reminders
            const remindersData = Object.fromEntries(this.reminders);
            fs.writeFileSync(
                this.getRemindersFilePath(),
                JSON.stringify(remindersData, null, 2)
            );
        } catch (error) {
            console.error('[ProactiveTaskManager] Failed to save:', error);
        }
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createProactiveTaskManager(
    storagePath: string,
    config?: Partial<TaskManagerConfig>
): ProactiveTaskManager {
    return new ProactiveTaskManager(storagePath, config);
}
