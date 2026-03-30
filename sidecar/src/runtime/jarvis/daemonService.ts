
import { EventEmitter } from 'events';

export type DaemonState = 'stopped' | 'starting' | 'running' | 'paused' | 'stopping';

export interface DaemonConfig {
    enabled: boolean;
    startOnBoot: boolean;

    environmentCheckInterval: number;  // 环境检查
    calendarCheckInterval: number;     // 日历检查
    emailCheckInterval: number;        // 邮件检查
    taskCheckInterval: number;         // 任务检查

    workingHours: {
        enabled: boolean;
        start: string;  // "09:00"
        end: string;    // "18:00"
        timezone: string;
    };

    proactiveReminders: boolean;
    proactiveSuggestions: boolean;
    autoLearnDuringIdle: boolean;

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

    async start(): Promise<void> {
        if (this.state === 'running') {
            console.log('[Daemon] Already running');
            return;
        }

        console.log('[Daemon] Starting...');
        this.state = 'starting';

        try {
            await this.initializeMonitors();

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

    async stop(): Promise<void> {
        if (this.state === 'stopped') {
            console.log('[Daemon] Already stopped');
            return;
        }

        console.log('[Daemon] Stopping...');
        this.state = 'stopping';

        try {
            this.clearAllTimers();

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

    async restart(): Promise<void> {
        await this.stop();
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.start();
    }

    private async startMainLoop(): Promise<void> {
        this.timers.set('environment', setInterval(
            () => this.checkEnvironment(),
            this.config.environmentCheckInterval
        ));

        this.timers.set('calendar', setInterval(
            () => this.checkCalendar(),
            this.config.calendarCheckInterval
        ));

        this.timers.set('email', setInterval(
            () => this.checkEmail(),
            this.config.emailCheckInterval
        ));

        this.timers.set('tasks', setInterval(
            () => this.checkTasks(),
            this.config.taskCheckInterval
        ));

        await this.checkEnvironment();
        await this.checkCalendar();
        await this.checkEmail();
        await this.checkTasks();
    }

    private async initializeMonitors(): Promise<void> {
        console.log('[Daemon] Initializing monitors...');
    }

    private async checkEnvironment(): Promise<void> {
        if (this.state !== 'running') return;

        try {
            if (this.startTime) {
                this.stats.uptime = Date.now() - this.startTime.getTime();
            }
            this.stats.lastActivity = new Date().toISOString();

            if (this.config.workingHours.enabled) {
                const isWorkingHours = this.isWithinWorkingHours();
                if (!isWorkingHours) {
                    return;
                }
            }

            const memoryUsage = process.memoryUsage();
            const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;

            if (memoryUsageMB > this.config.maxMemoryUsageMB) {
                console.warn(`[Daemon] High memory usage: ${memoryUsageMB.toFixed(2)} MB`);
            }

            this.emit('environment:checked', {
                memoryUsageMB,
                uptime: this.stats.uptime,
            });
        } catch (error) {
            this.handleError('environment', error);
        }
    }

    private async checkCalendar(): Promise<void> {
        if (this.state !== 'running') return;

        try {
            this.emit('calendar:check_requested');

            console.log('[Daemon] Checking calendar...');
        } catch (error) {
            this.handleError('calendar', error);
        }
    }

    private async checkEmail(): Promise<void> {
        if (this.state !== 'running') return;

        try {
            this.emit('email:check_requested');

            console.log('[Daemon] Checking email...');
        } catch (error) {
            this.handleError('email', error);
        }
    }

    private async checkTasks(): Promise<void> {
        if (this.state !== 'running') return;

        try {
            this.emit('tasks:check_requested');

        } catch (error) {
            this.handleError('tasks', error);
        }
    }

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

    getState(): DaemonState {
        return this.state;
    }

    getConfig(): DaemonConfig {
        return { ...this.config };
    }

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

    getStats(): typeof this.stats {
        return { ...this.stats };
    }

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

    isHealthy(): boolean {
        if (this.state !== 'running') return false;

        const now = Date.now();
        const lastActivityTime = new Date(this.stats.lastActivity).getTime();
        const timeSinceLastActivity = now - lastActivityTime;

        return timeSinceLastActivity < 5 * 60 * 1000;
    }
}

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
