/**
 * Suspend/Resume Manager
 *
 * Handles tasks that need to wait for user action (e.g., login, confirmation)
 * with automatic resume detection via heartbeat checks.
 */

import { EventEmitter } from 'events';

export interface SuspendedTask {
    taskId: string;
    suspendedAt: string;
    reason: string;
    userMessage: string;
    resumeCondition: ResumeCondition;
    context: any; // Saved execution context
    heartbeatInterval?: NodeJS.Timeout;
}

export interface ResumeCondition {
    type: 'manual' | 'auto_detect';
    checkFunction?: () => Promise<boolean>;
    checkInterval?: number; // ms
    maxWaitTime?: number; // ms
}

export interface SuspendResumeConfig {
    defaultHeartbeatInterval: number;
    defaultMaxWaitTime: number;
    enableAutoResume: boolean;
}

const DEFAULT_CONFIG: SuspendResumeConfig = {
    defaultHeartbeatInterval: 5000, // 5 seconds
    defaultMaxWaitTime: 5 * 60 * 1000, // 5 minutes
    enableAutoResume: true,
};

export class SuspendResumeManager extends EventEmitter {
    private config: SuspendResumeConfig;
    private suspendedTasks: Map<string, SuspendedTask> = new Map();

    constructor(config?: Partial<SuspendResumeConfig>) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Suspend a task and wait for user action
     */
    async suspend(
        taskId: string,
        reason: string,
        userMessage: string,
        resumeCondition: ResumeCondition,
        context?: any
    ): Promise<void> {
        console.log(`[SuspendResume] 🔶 Suspending task ${taskId}: ${reason}`);
        console.log(`[SuspendResume] Message to user: ${userMessage}`);

        // Stop existing heartbeat if any
        await this.stopHeartbeat(taskId);

        const suspended: SuspendedTask = {
            taskId,
            suspendedAt: new Date().toISOString(),
            reason,
            userMessage,
            resumeCondition,
            context: context || {},
        };

        this.suspendedTasks.set(taskId, suspended);

        // Emit suspend event
        this.emit('task_suspended', {
            taskId,
            reason,
            userMessage,
            canAutoResume: resumeCondition.type === 'auto_detect',
        });

        // Start heartbeat if auto_detect
        if (this.config.enableAutoResume && resumeCondition.type === 'auto_detect' && resumeCondition.checkFunction) {
            await this.startHeartbeat(suspended);
        }
    }

    /**
     * Resume a suspended task
     */
    async resume(taskId: string, resumeReason?: string): Promise<{ success: boolean; context?: any }> {
        const suspended = this.suspendedTasks.get(taskId);

        if (!suspended) {
            return { success: false };
        }

        console.log(`[SuspendResume] ▶️ Resuming task ${taskId}`);
        if (resumeReason) {
            console.log(`[SuspendResume] Resume reason: ${resumeReason}`);
        }

        // Stop heartbeat
        await this.stopHeartbeat(taskId);

        // Remove from suspended tasks
        this.suspendedTasks.delete(taskId);

        // Emit resume event
        this.emit('task_resumed', {
            taskId,
            suspendDuration: Date.now() - new Date(suspended.suspendedAt).getTime(),
            resumeReason,
        });

        return {
            success: true,
            context: suspended.context,
        };
    }

    /**
     * Cancel a suspended task
     */
    async cancel(taskId: string, reason?: string): Promise<boolean> {
        const suspended = this.suspendedTasks.get(taskId);

        if (!suspended) {
            return false;
        }

        console.log(`[SuspendResume] ❌ Cancelling suspended task ${taskId}`);
        if (reason) {
            console.log(`[SuspendResume] Reason: ${reason}`);
        }

        await this.stopHeartbeat(taskId);
        this.suspendedTasks.delete(taskId);

        this.emit('task_cancelled', { taskId, reason });

        return true;
    }

    /**
     * Check if a task is suspended
     */
    isSuspended(taskId: string): boolean {
        return this.suspendedTasks.has(taskId);
    }

    /**
     * Get suspended task info
     */
    getSuspendedTask(taskId: string): SuspendedTask | undefined {
        return this.suspendedTasks.get(taskId);
    }

    /**
     * Get all suspended tasks
     */
    getAllSuspended(): SuspendedTask[] {
        return Array.from(this.suspendedTasks.values());
    }

    /**
     * Start heartbeat checking for auto-resume
     */
    private async startHeartbeat(suspended: SuspendedTask): Promise<void> {
        const { taskId, resumeCondition } = suspended;

        if (!resumeCondition.checkFunction) {
            return;
        }

        const interval = resumeCondition.checkInterval || this.config.defaultHeartbeatInterval;
        const maxWaitTime = resumeCondition.maxWaitTime || this.config.defaultMaxWaitTime;
        const startTime = Date.now();

        console.log(`[SuspendResume] 💓 Starting heartbeat for ${taskId} (check every ${interval}ms)`);

        const heartbeat = setInterval(async () => {
            try {
                // Check if task was resumed or cancelled
                if (!this.suspendedTasks.has(taskId)) {
                    clearInterval(heartbeat);
                    return;
                }

                // Check if max wait time exceeded
                if (Date.now() - startTime > maxWaitTime) {
                    console.log(`[SuspendResume] ⏰ Max wait time exceeded for ${taskId}, cancelling`);
                    clearInterval(heartbeat);
                    await this.cancel(taskId, 'Max wait time exceeded');
                    return;
                }

                // Check resume condition
                console.log(`[SuspendResume] 💓 Heartbeat check for ${taskId}...`);
                const shouldResume = await resumeCondition.checkFunction!();

                if (shouldResume) {
                    console.log(`[SuspendResume] ✅ Resume condition met for ${taskId}`);
                    clearInterval(heartbeat);
                    await this.resume(taskId, 'Auto-detected: condition met');
                }
            } catch (error) {
                console.error(`[SuspendResume] Error in heartbeat for ${taskId}:`, error);
            }
        }, interval);

        suspended.heartbeatInterval = heartbeat;
    }

    /**
     * Stop heartbeat for a task
     */
    private async stopHeartbeat(taskId: string): Promise<void> {
        const suspended = this.suspendedTasks.get(taskId);

        if (suspended?.heartbeatInterval) {
            clearInterval(suspended.heartbeatInterval);
            suspended.heartbeatInterval = undefined;
            console.log(`[SuspendResume] Stopped heartbeat for ${taskId}`);
        }
    }

    /**
     * Cleanup all suspended tasks
     */
    async cleanup(): Promise<void> {
        console.log(`[SuspendResume] Cleaning up ${this.suspendedTasks.size} suspended tasks`);

        for (const taskId of Array.from(this.suspendedTasks.keys())) {
            await this.stopHeartbeat(taskId);
        }

        this.suspendedTasks.clear();
    }
}

/**
 * Factory function
 */
export function createSuspendResumeManager(config?: Partial<SuspendResumeConfig>): SuspendResumeManager {
    return new SuspendResumeManager(config);
}

/**
 * Common resume condition factories
 */
export const ResumeConditions = {
    /**
     * Manual resume - user must explicitly resume
     */
    manual(): ResumeCondition {
        return {
            type: 'manual',
        };
    },

    /**
     * Browser page condition check
     */
    browserPageCheck(
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

    /**
     * Xiaohongshu login check using content-based detection
     * Works with both CDP and Bridge page proxies
     */
    xiaohongshuLoginCheck(
        browserService: any,
        interval = 5000,
        maxWaitTime = 5 * 60 * 1000
    ): ResumeCondition {
        return {
            type: 'auto_detect',
            checkFunction: async () => {
                try {
                    // Use content-based detection instead of page.$()
                    // This is compatible with both CDP and Node.js bridge modes
                    const contentResult = await browserService.getContent(true);
                    const pageText = contentResult?.content || '';

                    // Check if login keywords are gone or logged-in keywords appeared
                    const loginKeywords = ['登录', '登 录', '验证码'];
                    const loggedInKeywords = ['退出', '注销', '我的主页', '创作中心', '发布笔记'];

                    const stillHasLogin = loginKeywords.some((kw: string) => pageText.includes(kw));
                    const nowLoggedIn = loggedInKeywords.some((kw: string) => pageText.includes(kw));

                    return nowLoggedIn || !stillHasLogin;
                } catch {
                    return false;
                }
            },
            checkInterval: interval,
            maxWaitTime,
        };
    },
};
