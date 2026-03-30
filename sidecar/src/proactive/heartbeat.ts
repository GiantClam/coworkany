import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
export type TriggerType = 'cron' | 'file_watch' | 'webhook' | 'condition' | 'interval';
export interface CronConfig {
    expression: string;  // Cron expression: "*/5 * * * *" = every 5 minutes
}
export interface FileWatchConfig {
    path: string;
    pattern?: string;  // Glob pattern: "*.pdf"
    events: ('create' | 'modify' | 'delete')[];
    recursive?: boolean;
}
export interface WebhookConfig {
    path: string;  // /webhooks/my-hook
    secret?: string;
}
export interface ConditionConfig {
    type: 'http_check' | 'file_exists' | 'expression';
    url?: string;
    method?: 'GET' | 'POST';
    expectedStatus?: number;
    filePath?: string;
    expression?: string;
    intervalMs: number;
}
export interface IntervalConfig {
    intervalMs: number;
}
export interface ClipboardConfig {
    enabled: boolean;
    pattern?: string;
}
export type TriggerConfig = CronConfig | FileWatchConfig | WebhookConfig | ConditionConfig | IntervalConfig | ClipboardConfig;
export interface TriggerAction {
    type: 'notify' | 'execute_task' | 'run_skill' | 'webhook_response' | 'custom';
    message?: string;
    channel?: string;  // For multi-channel support
    taskQuery?: string;
    skillName?: string;
    skillArgs?: Record<string, unknown>;
    customHandler?: string;
}
export interface Trigger {
    id: string;
    name: string;
    description?: string;
    type: TriggerType;
    config: TriggerConfig;
    action: TriggerAction;
    enabled: boolean;
    createdAt: string;
    lastTriggeredAt?: string;
    triggerCount: number;
}
export interface TriggerEvent {
    triggerId: string;
    triggerName: string;
    timestamp: string;
    eventType: string;
    eventData: Record<string, unknown>;
}
export type HeartbeatEventType =
    | 'trigger_fired'
    | 'trigger_action_started'
    | 'trigger_action_completed'
    | 'trigger_action_failed'
    | 'trigger_registered'
    | 'trigger_unregistered'
    | 'engine_started'
    | 'engine_stopped';
export interface HeartbeatEvent {
    type: HeartbeatEventType;
    timestamp: string;
    data: Record<string, unknown>;
}
export type HeartbeatEventCallback = (event: HeartbeatEvent) => void;
export interface ProactiveTaskExecutor {
    executeTask(query: string, context?: Record<string, unknown>): Promise<{
        success: boolean;
        result?: string;
        error?: string;
    }>;
    runSkill(skillName: string, args?: Record<string, unknown>): Promise<{
        success: boolean;
        result?: string;
        error?: string;
    }>;
    notify(message: string, channel?: string): Promise<void>;
}
interface CronSchedule {
    minute: number[];
    hour: number[];
    dayOfMonth: number[];
    month: number[];
    dayOfWeek: number[];
}
function parseCronExpression(expression: string): CronSchedule {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`Invalid cron expression: ${expression}`);
    }
    return {
        minute: parseCronPart(parts[0], 0, 59),
        hour: parseCronPart(parts[1], 0, 23),
        dayOfMonth: parseCronPart(parts[2], 1, 31),
        month: parseCronPart(parts[3], 1, 12),
        dayOfWeek: parseCronPart(parts[4], 0, 6),
    };
}
function parseCronPart(part: string, min: number, max: number): number[] {
    if (part === '*') {
        return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    }
    if (part.includes('/')) {
        const [range, step] = part.split('/');
        const stepNum = parseInt(step, 10);
        const values: number[] = [];
        const start = range === '*' ? min : parseInt(range, 10);
        for (let i = start; i <= max; i += stepNum) {
            values.push(i);
        }
        return values;
    }
    if (part.includes(',')) {
        return part.split(',').map(v => parseInt(v, 10));
    }
    if (part.includes('-')) {
        const [start, end] = part.split('-').map(v => parseInt(v, 10));
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return [parseInt(part, 10)];
}
function shouldRunCron(schedule: CronSchedule, date: Date): boolean {
    return (
        schedule.minute.includes(date.getMinutes()) &&
        schedule.hour.includes(date.getHours()) &&
        schedule.dayOfMonth.includes(date.getDate()) &&
        schedule.month.includes(date.getMonth() + 1) &&
        schedule.dayOfWeek.includes(date.getDay())
    );
}
export class HeartbeatEngine extends EventEmitter {
    private triggers: Map<string, Trigger> = new Map();
    private cronIntervalId: NodeJS.Timeout | null = null;
    private conditionIntervals: Map<string, NodeJS.Timeout> = new Map();
    private fileWatchers: Map<string, fs.FSWatcher> = new Map();
    private intervalTimers: Map<string, NodeJS.Timeout> = new Map();
    private executor: ProactiveTaskExecutor;
    private eventCallback?: HeartbeatEventCallback;
    private isRunning: boolean = false;
    private configPath: string;
    constructor(options: {
        executor: ProactiveTaskExecutor;
        configPath?: string;
        onEvent?: HeartbeatEventCallback;
    }) {
        super();
        this.executor = options.executor;
        this.configPath = options.configPath ??
            path.join(os.homedir(), '.coworkany', 'triggers.json');
        this.eventCallback = options.onEvent;
    }
    private emitEvent(event: HeartbeatEvent): void {
        this.emit(event.type, event);
        if (this.eventCallback) {
            this.eventCallback(event);
        }
    }
    start(): void {
        if (this.isRunning) {
            console.log('[Heartbeat] Engine already running');
            return;
        }
        console.log('[Heartbeat] Starting engine...');
        this.loadTriggersFromConfig();
        this.cronIntervalId = setInterval(() => {
            this.checkCronTriggers();
        }, 60000);
        this.checkCronTriggers();
        for (const trigger of this.triggers.values()) {
            if (trigger.enabled) {
                this.startTrigger(trigger);
            }
        }
        this.isRunning = true;
        this.emitEvent({
            type: 'engine_started',
            timestamp: new Date().toISOString(),
            data: { triggerCount: this.triggers.size },
        });
        console.log(`[Heartbeat] Engine started with ${this.triggers.size} triggers`);
    }
    stop(): void {
        if (!this.isRunning) {
            return;
        }
        console.log('[Heartbeat] Stopping engine...');
        if (this.cronIntervalId) {
            clearInterval(this.cronIntervalId);
            this.cronIntervalId = null;
        }
        for (const intervalId of this.conditionIntervals.values()) {
            clearInterval(intervalId);
        }
        this.conditionIntervals.clear();
        for (const watcher of this.fileWatchers.values()) {
            watcher.close();
        }
        this.fileWatchers.clear();
        for (const timerId of this.intervalTimers.values()) {
            clearInterval(timerId);
        }
        this.intervalTimers.clear();
        this.isRunning = false;
        this.emitEvent({
            type: 'engine_stopped',
            timestamp: new Date().toISOString(),
            data: {},
        });
        console.log('[Heartbeat] Engine stopped');
    }
    registerTrigger(trigger: Trigger): void {
        this.triggers.set(trigger.id, trigger);
        if (trigger.enabled && this.isRunning) {
            this.startTrigger(trigger);
        }
        this.saveTriggersToConfig();
        this.emitEvent({
            type: 'trigger_registered',
            timestamp: new Date().toISOString(),
            data: { triggerId: trigger.id, triggerName: trigger.name },
        });
        console.log(`[Heartbeat] Registered trigger: ${trigger.name} (${trigger.type})`);
    }
    unregisterTrigger(triggerId: string): boolean {
        const trigger = this.triggers.get(triggerId);
        if (!trigger) {
            return false;
        }
        this.stopTrigger(trigger);
        this.triggers.delete(triggerId);
        this.saveTriggersToConfig();
        this.emitEvent({
            type: 'trigger_unregistered',
            timestamp: new Date().toISOString(),
            data: { triggerId, triggerName: trigger.name },
        });
        console.log(`[Heartbeat] Unregistered trigger: ${trigger.name}`);
        return true;
    }
    setTriggerEnabled(triggerId: string, enabled: boolean): boolean {
        const trigger = this.triggers.get(triggerId);
        if (!trigger) {
            return false;
        }
        trigger.enabled = enabled;
        if (this.isRunning) {
            if (enabled) {
                this.startTrigger(trigger);
            } else {
                this.stopTrigger(trigger);
            }
        }
        this.saveTriggersToConfig();
        return true;
    }
    getTriggers(): Trigger[] {
        return Array.from(this.triggers.values());
    }
    getTrigger(triggerId: string): Trigger | undefined {
        return this.triggers.get(triggerId);
    }
    private startTrigger(trigger: Trigger): void {
        switch (trigger.type) {
            case 'file_watch':
                this.startFileWatcher(trigger);
                break;
            case 'condition':
                this.startConditionChecker(trigger);
                break;
            case 'interval':
                this.startIntervalTimer(trigger);
                break;
        }
    }
    private stopTrigger(trigger: Trigger): void {
        switch (trigger.type) {
            case 'file_watch':
                this.stopFileWatcher(trigger.id);
                break;
            case 'condition':
                this.stopConditionChecker(trigger.id);
                break;
            case 'interval':
                this.stopIntervalTimer(trigger.id);
                break;
        }
    }
    private checkCronTriggers(): void {
        const now = new Date();
        for (const trigger of this.triggers.values()) {
            if (!trigger.enabled || trigger.type !== 'cron') {
                continue;
            }
            try {
                const config = trigger.config as CronConfig;
                const schedule = parseCronExpression(config.expression);
                if (shouldRunCron(schedule, now)) {
                    this.fireTrigger(trigger, {
                        type: 'cron',
                        scheduledTime: now.toISOString(),
                    });
                }
            } catch (error) {
                console.error(`[Heartbeat] Failed to check cron trigger ${trigger.id}:`, error);
            }
        }
    }
    private startFileWatcher(trigger: Trigger): void {
        const config = trigger.config as FileWatchConfig;
        const watchPath = config.path.replace(/^~/, os.homedir());
        if (!fs.existsSync(watchPath)) {
            console.warn(`[Heartbeat] Watch path does not exist: ${watchPath}`);
            return;
        }
        try {
            const watcher = fs.watch(
                watchPath,
                { recursive: config.recursive ?? false },
                (eventType, filename) => {
                    if (!filename) return;
                    if (config.pattern) {
                        const regex = new RegExp(
                            config.pattern
                                .replace(/\./g, '\\.')
                                .replace(/\*/g, '.*')
                        );
                        if (!regex.test(filename)) {
                            return;
                        }
                    }
                    let ourEventType: 'create' | 'modify' | 'delete';
                    if (eventType === 'rename') {
                        const fullPath = path.join(watchPath, filename);
                        ourEventType = fs.existsSync(fullPath) ? 'create' : 'delete';
                    } else {
                        ourEventType = 'modify';
                    }
                    if (!config.events.includes(ourEventType)) {
                        return;
                    }
                    this.fireTrigger(trigger, {
                        type: 'file_watch',
                        eventType: ourEventType,
                        filename,
                        fullPath: path.join(watchPath, filename),
                    });
                }
            );
            this.fileWatchers.set(trigger.id, watcher);
            console.log(`[Heartbeat] Started file watcher for: ${watchPath}`);
        } catch (error) {
            console.error(`[Heartbeat] Failed to start file watcher for ${trigger.id}:`, error);
        }
    }
    private stopFileWatcher(triggerId: string): void {
        const watcher = this.fileWatchers.get(triggerId);
        if (watcher) {
            watcher.close();
            this.fileWatchers.delete(triggerId);
        }
    }
    private startConditionChecker(trigger: Trigger): void {
        const config = trigger.config as ConditionConfig;
        const intervalId = setInterval(async () => {
            const conditionMet = await this.checkCondition(config);
            if (conditionMet) {
                this.fireTrigger(trigger, {
                    type: 'condition',
                    conditionType: config.type,
                });
            }
        }, config.intervalMs);
        this.conditionIntervals.set(trigger.id, intervalId);
        console.log(`[Heartbeat] Started condition checker for: ${trigger.name}`);
    }
    private stopConditionChecker(triggerId: string): void {
        const intervalId = this.conditionIntervals.get(triggerId);
        if (intervalId) {
            clearInterval(intervalId);
            this.conditionIntervals.delete(triggerId);
        }
    }
    private async checkCondition(config: ConditionConfig): Promise<boolean> {
        switch (config.type) {
            case 'http_check':
                try {
                    const response = await fetch(config.url!, {
                        method: config.method ?? 'GET',
                    });
                    return response.status === (config.expectedStatus ?? 200);
                } catch {
                    return false;
                }
            case 'file_exists':
                return fs.existsSync(config.filePath!);
            case 'expression':
                try {
                    return eval(config.expression!);
                } catch {
                    return false;
                }
            default:
                return false;
        }
    }
    private startIntervalTimer(trigger: Trigger): void {
        const config = trigger.config as IntervalConfig;
        const timerId = setInterval(() => {
            this.fireTrigger(trigger, {
                type: 'interval',
                intervalMs: config.intervalMs,
            });
        }, config.intervalMs);
        this.intervalTimers.set(trigger.id, timerId);
        console.log(`[Heartbeat] Started interval timer for: ${trigger.name}`);
    }
    private stopIntervalTimer(triggerId: string): void {
        const timerId = this.intervalTimers.get(triggerId);
        if (timerId) {
            clearInterval(timerId);
            this.intervalTimers.delete(triggerId);
        }
    }
    private async fireTrigger(
        trigger: Trigger,
        eventData: Record<string, unknown>
    ): Promise<void> {
        console.log(`[Heartbeat] Trigger fired: ${trigger.name}`);
        trigger.lastTriggeredAt = new Date().toISOString();
        trigger.triggerCount++;
        this.saveTriggersToConfig();
        this.emitEvent({
            type: 'trigger_fired',
            timestamp: new Date().toISOString(),
            data: {
                triggerId: trigger.id,
                triggerName: trigger.name,
                eventData,
            },
        });
        await this.executeAction(trigger, eventData);
    }
    private async executeAction(
        trigger: Trigger,
        eventData: Record<string, unknown>
    ): Promise<void> {
        const action = trigger.action;
        this.emitEvent({
            type: 'trigger_action_started',
            timestamp: new Date().toISOString(),
            data: {
                triggerId: trigger.id,
                actionType: action.type,
            },
        });
        try {
            switch (action.type) {
                case 'notify':
                    await this.executor.notify(
                        this.interpolateMessage(action.message!, eventData),
                        action.channel
                    );
                    break;
                case 'execute_task':
                    await this.executor.executeTask(
                        this.interpolateMessage(action.taskQuery!, eventData),
                        { triggerEvent: eventData }
                    );
                    break;
                case 'run_skill':
                    await this.executor.runSkill(action.skillName!, action.skillArgs);
                    break;
                case 'custom':
                    console.log(`[Heartbeat] Custom handler: ${action.customHandler}`);
                    break;
            }
            this.emitEvent({
                type: 'trigger_action_completed',
                timestamp: new Date().toISOString(),
                data: {
                    triggerId: trigger.id,
                    actionType: action.type,
                },
            });
        } catch (error) {
            console.error(`[Heartbeat] Action failed for trigger ${trigger.id}:`, error);
            this.emitEvent({
                type: 'trigger_action_failed',
                timestamp: new Date().toISOString(),
                data: {
                    triggerId: trigger.id,
                    actionType: action.type,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }
    private interpolateMessage(
        template: string,
        data: Record<string, unknown>
    ): string {
        return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
            return String(data[key] ?? `{{${key}}}`);
        });
    }
    private loadTriggersFromConfig(): void {
        try {
            if (fs.existsSync(this.configPath)) {
                const content = fs.readFileSync(this.configPath, 'utf-8');
                const data = JSON.parse(content) as { triggers: Trigger[] };
                for (const trigger of data.triggers) {
                    this.triggers.set(trigger.id, trigger);
                }
                console.log(`[Heartbeat] Loaded ${this.triggers.size} triggers from config`);
            }
        } catch (error) {
            console.error('[Heartbeat] Failed to load triggers:', error);
        }
    }
    private saveTriggersToConfig(): void {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = {
                triggers: Array.from(this.triggers.values()),
            };
            fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[Heartbeat] Failed to save triggers:', error);
        }
    }
}
export function createHeartbeatEngine(options: {
    executor: ProactiveTaskExecutor;
    configPath?: string;
    onEvent?: HeartbeatEventCallback;
}): HeartbeatEngine {
    return new HeartbeatEngine(options);
}
export const TriggerPresets = {
    dailySummary: (): Trigger => ({
        id: `daily-summary-${Date.now()}`,
        name: 'Daily Summary',
        description: 'Generate daily work summary every morning',
        type: 'cron',
        config: { expression: '0 9 * * *' } as CronConfig,
        action: {
            type: 'execute_task',
            taskQuery: '总结昨天的工作进展，并规划今天的任务',
        },
        enabled: false,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
    }),
    pdfProcessor: (): Trigger => ({
        id: `pdf-processor-${Date.now()}`,
        name: 'PDF Processor',
        description: 'Process new PDF files in Downloads',
        type: 'file_watch',
        config: {
            path: '~/Downloads',
            pattern: '*.pdf',
            events: ['create'],
        } as FileWatchConfig,
        action: {
            type: 'run_skill',
            skillName: 'pdf-processor',
            message: '检测到新PDF文件: {{filename}}',
        },
        enabled: false,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
    }),
    serverMonitor: (url: string): Trigger => ({
        id: `server-monitor-${Date.now()}`,
        name: 'Server Monitor',
        description: `Monitor server health: ${url}`,
        type: 'condition',
        config: {
            type: 'http_check',
            url,
            method: 'GET',
            expectedStatus: 200,
            intervalMs: 5 * 60 * 1000,
        } as ConditionConfig,
        action: {
            type: 'notify',
            message: `服务器 ${url} 状态异常，请检查`,
        },
        enabled: false,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
    }),
    memoryCompaction: (): Trigger => ({
        id: `memory-compaction-${Date.now()}`,
        name: 'Memory Compaction',
        description: 'Compact old memories weekly',
        type: 'cron',
        config: { expression: '0 3 * * 0' } as CronConfig,  // Sunday 3 AM
        action: {
            type: 'execute_task',
            taskQuery: '压缩整理超过30天的旧记忆，保留重要内容',
        },
        enabled: false,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
    }),
};
