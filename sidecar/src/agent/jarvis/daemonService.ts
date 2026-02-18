/**
 * CoworkAny - Daemon Service (守护进程服务)
 *
 * 持续运行的后台服务，像贾维斯一样24/7工作
 * - 监控环境变化
 * - 定期检查日历和邮件
 * - 主动触发任务
 * - 管理并发任务
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type DaemonState = 'stopped' | 'starting' | 'running' | 'paused' | 'stopping';

export interface DaemonConfig {
    // 核心配置
    enabled: boolean;
    startOnBoot: boolean;

    // 监控间隔（毫秒）
    environmentCheckInterval: number;  // 环境检查
    calendarCheckInterval: number;     // 日历检查
    emailCheckInterval: number;        // 邮件检查
    taskCheckInterval: number;         // 任务检查

    // 工作时段
    workingHours: {
        enabled: boolean;
        start: string;  // "09:00"
        end: string;    // "18:00"
        timezone: string;
    };

    // 主动性配置
    proactiveReminders: boolean;
    proactiveSuggestions: boolean;
    autoLearnDuringIdle: boolean;

    // 资源限制
    maxConcurrentTasks: number;
    maxMemoryUsageMB: number;
}

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
    enabled: true,
    startOnBoot: false,

    environmentCheckInterval: 30000,   // 30秒
    calendarCheckInterval: 300000,     // 5分钟
    emailCheckInterval: 60000,         // 1分钟
    taskCheckInterval: 10000,          // 10秒

    workingHours: {
        enabled: false,
        start: '09:00',
        end: '18:00',
        timezone: 'Asia/Shanghai',
    },

    proactiveReminders: true,
    proactiveSuggestions: true,
    autoLearnDuringIdle: false,

    maxConcurrentTasks: 5,
    maxMemoryUsageMB: 1024,
};

export interface DaemonEvent {
    type: 'started' | 'stopped' | 'paused' | 'resumed' | 'error' | 'task_triggered';
    timestamp: string;
    data?: any;
}

export type DaemonEventHandler = (event: DaemonEvent) => void;

// ============================================================================
// DaemonService Class
// ============================================================================

export class DaemonService extends EventEmitter {
    private config: DaemonConfig;
    private state: DaemonState;
    private timers: Map<string, NodeJS.Timeout>;
    private startTime?: Date;
    private stats: {
        uptime: number;
        tasksTriggered: number;
        errorsCount: number;
        lastActivity: string;
    };

    constructor(config?: Partial<DaemonConfig>) {
        super();
        this.config = { ...DEFAULT_DAEMON_CONFIG, ...config };
        this.state = 'stopped';
        this.timers = new Map();
        this.stats = {
            uptime: 0,
            tasksTriggered: 0,
            errorsCount: 0,
            lastActivity: new Date().toISOString(),
        };
    }

    // ========================================================================
    // Lifecycle Management
    // ========================================================================

    /**
     * 启动守护进程
     */
    async start(): Promise<void> {
        if (this.state === 'running') {
            console.log('[Daemon] Already running');
            return;
        }

        console.log('[Daemon] Starting...');
        this.state = 'starting';

        try {
            // 初始化各个监控器
            await this.initializeMonitors();

            // 启动主循环
            await this.startMainLoop();

            this.state = 'running';
            this.startTime = new Date();

            this.emit('daemon:started', {
                type: 'started',
                timestamp: new Date().toISOString(),
            });

            console.log('[Daemon] Started successfully');
        } catch (error) {
            this.state = 'stopped';
            this.emit('daemon:error', {
                type: 'error',
                timestamp: new Date().toISOString(),
                data: { error: String(error) },
            });
            throw error;
        }
    }

    /**
     * 停止守护进程
     */
    async stop(): Promise<void> {
        if (this.state === 'stopped') {
            console.log('[Daemon] Already stopped');
            return;
        }

        console.log('[Daemon] Stopping...');
        this.state = 'stopping';

        try {
            // 清理所有定时器
            this.clearAllTimers();

            // 等待当前任务完成
            await this.waitForTasksCompletion();

            this.state = 'stopped';

            this.emit('daemon:stopped', {
                type: 'stopped',
                timestamp: new Date().toISOString(),
            });

            console.log('[Daemon] Stopped successfully');
        } catch (error) {
            console.error('[Daemon] Error during stop:', error);
            this.state = 'stopped';
        }
    }

    /**
     * 暂停守护进程
     */
    pause(): void {
        if (this.state !== 'running') return;

        console.log('[Daemon] Pausing...');
        this.clearAllTimers();
        this.state = 'paused';

        this.emit('daemon:paused', {
            type: 'paused',
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * 恢复守护进程
     */
    async resume(): Promise<void> {
        if (this.state !== 'paused') return;

        console.log('[Daemon] Resuming...');
        await this.startMainLoop();
        this.state = 'running';

        this.emit('daemon:resumed', {
            type: 'resumed',
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * 重启守护进程
     */
    async restart(): Promise<void> {
        await this.stop();
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.start();
    }

    // ========================================================================
    // Main Loop
    // ========================================================================

    private async startMainLoop(): Promise<void> {
        // 环境监控循环
        this.timers.set('environment', setInterval(
            () => this.checkEnvironment(),
            this.config.environmentCheckInterval
        ));

        // 日历检查循环
        this.timers.set('calendar', setInterval(
            () => this.checkCalendar(),
            this.config.calendarCheckInterval
        ));

        // 邮件检查循环
        this.timers.set('email', setInterval(
            () => this.checkEmail(),
            this.config.emailCheckInterval
        ));

        // 任务检查循环
        this.timers.set('tasks', setInterval(
            () => this.checkTasks(),
            this.config.taskCheckInterval
        ));

        // 立即执行一次检查
        await this.checkEnvironment();
        await this.checkCalendar();
        await this.checkEmail();
        await this.checkTasks();
    }

    // ========================================================================
    // Monitors
    // ========================================================================

    private async initializeMonitors(): Promise<void> {
        console.log('[Daemon] Initializing monitors...');
        // 初始化各个监控模块
        // 这里可以初始化连接、加载配置等
    }

    /**
     * 检查环境状态
     */
    private async checkEnvironment(): Promise<void> {
        if (this.state !== 'running') return;

        try {
            // 更新统计信息
            if (this.startTime) {
                this.stats.uptime = Date.now() - this.startTime.getTime();
            }
            this.stats.lastActivity = new Date().toISOString();

            // 检查工作时段
            if (this.config.workingHours.enabled) {
                const isWorkingHours = this.isWithinWorkingHours();
                if (!isWorkingHours) {
                    // 非工作时段，减少活动
                    return;
                }
            }

            // 检查内存使用
            const memoryUsage = process.memoryUsage();
            const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;

            if (memoryUsageMB > this.config.maxMemoryUsageMB) {
                console.warn(`[Daemon] High memory usage: ${memoryUsageMB.toFixed(2)} MB`);
                // 触发垃圾回收或警告
            }

            // 发射环境检查事件
            this.emit('environment:checked', {
                memoryUsageMB,
                uptime: this.stats.uptime,
            });
        } catch (error) {
            this.handleError('environment', error);
        }
    }

    /**
     * 检查日历事件
     */
    private async checkCalendar(): Promise<void> {
        if (this.state !== 'running') return;

        try {
            // 这里会调用 CalendarIntegration 模块
            this.emit('calendar:check_requested');

            // 占位：实际实现会在 CalendarIntegration 中
            console.log('[Daemon] Checking calendar...');
        } catch (error) {
            this.handleError('calendar', error);
        }
    }

    /**
     * 检查邮件
     */
    private async checkEmail(): Promise<void> {
        if (this.state !== 'running') return;

        try {
            // 这里会调用 EmailIntegration 模块
            this.emit('email:check_requested');

            // 占位：实际实现会在 EmailIntegration 中
            console.log('[Daemon] Checking email...');
        } catch (error) {
            this.handleError('email', error);
        }
    }

    /**
     * 检查任务状态
     */
    private async checkTasks(): Promise<void> {
        if (this.state !== 'running') return;

        try {
            // 这里会调用 ProactiveTaskManager 模块
            this.emit('tasks:check_requested');

            // 占位：实际实现会在 ProactiveTaskManager 中
        } catch (error) {
            this.handleError('tasks', error);
        }
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    private isWithinWorkingHours(): boolean {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const currentTime = hours * 60 + minutes;

        const [startHour, startMin] = this.config.workingHours.start.split(':').map(Number);
        const [endHour, endMin] = this.config.workingHours.end.split(':').map(Number);

        const startTime = startHour * 60 + startMin;
        const endTime = endHour * 60 + endMin;

        return currentTime >= startTime && currentTime <= endTime;
    }

    private clearAllTimers(): void {
        for (const [name, timer] of this.timers) {
            clearInterval(timer);
            console.log(`[Daemon] Cleared timer: ${name}`);
        }
        this.timers.clear();
    }

    private async waitForTasksCompletion(): Promise<void> {
        // 等待当前任务完成
        // 实际实现需要跟踪正在运行的任务
        console.log('[Daemon] Waiting for tasks to complete...');
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    private handleError(source: string, error: unknown): void {
        this.stats.errorsCount++;
        console.error(`[Daemon] Error in ${source}:`, error);

        this.emit('daemon:error', {
            type: 'error',
            timestamp: new Date().toISOString(),
            data: { source, error: String(error) },
        });
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * 获取当前状态
     */
    getState(): DaemonState {
        return this.state;
    }

    /**
     * 获取配置
     */
    getConfig(): DaemonConfig {
        return { ...this.config };
    }

    /**
     * 更新配置
     */
    async updateConfig(updates: Partial<DaemonConfig>): Promise<void> {
        const needsRestart = this.state === 'running' && (
            updates.environmentCheckInterval !== undefined ||
            updates.calendarCheckInterval !== undefined ||
            updates.emailCheckInterval !== undefined ||
            updates.taskCheckInterval !== undefined
        );

        this.config = { ...this.config, ...updates };

        if (needsRestart) {
            await this.restart();
        }
    }

    /**
     * 获取统计信息
     */
    getStats(): typeof this.stats {
        return { ...this.stats };
    }

    /**
     * 触发手动检查
     */
    async triggerCheck(type: 'environment' | 'calendar' | 'email' | 'tasks'): Promise<void> {
        switch (type) {
            case 'environment':
                await this.checkEnvironment();
                break;
            case 'calendar':
                await this.checkCalendar();
                break;
            case 'email':
                await this.checkEmail();
                break;
            case 'tasks':
                await this.checkTasks();
                break;
        }
    }

    /**
     * 检查是否健康
     */
    isHealthy(): boolean {
        if (this.state !== 'running') return false;

        const now = Date.now();
        const lastActivityTime = new Date(this.stats.lastActivity).getTime();
        const timeSinceLastActivity = now - lastActivityTime;

        // 如果超过5分钟没有活动，认为不健康
        return timeSinceLastActivity < 5 * 60 * 1000;
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let daemonInstance: DaemonService | null = null;

export function getDaemonService(): DaemonService {
    if (!daemonInstance) {
        daemonInstance = new DaemonService();
    }
    return daemonInstance;
}

export function createDaemonService(config?: Partial<DaemonConfig>): DaemonService {
    daemonInstance = new DaemonService(config);
    return daemonInstance;
}
