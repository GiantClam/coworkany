import { ToolDefinition, ToolContext } from '../standard';
import { randomUUID } from 'crypto';
import { getHeartbeatEngine } from '../../proactive/runtime';
import type { Trigger } from '../../proactive/heartbeat';

/**
 * Reminder Tool - Integrated with Task System
 *
 * Creates reminders as high-priority tasks with notification metadata.
 */
export const setReminderTool: ToolDefinition = {
    name: 'set_reminder',
    description: 'Set a reminder for a specific time. Creates a notify-only reminder task. Use only when the user asks to be reminded, not when the user wants substantive work to execute later.',
    effects: ['state:remember', 'ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'Reminder message/content',
            },
            time: {
                type: 'string',
                description: 'When to remind (ISO 8601 timestamp or natural language like "tomorrow 3pm", "in 2 hours")',
            },
            recurring: {
                type: 'string',
                enum: ['none', 'daily', 'weekly', 'monthly'],
                description: 'Recurring pattern',
                default: 'none',
            },
        },
        required: ['message', 'time'],
    },
    handler: async (
        args: {
            message: string;
            time: string;
            recurring?: string;
        },
        context: ToolContext
    ) => {
        const { message, time, recurring = 'none' } = args;

        try {
            const reminderTime = parseTimeExpression(time);

            if (looksLikeDeferredTaskExecution(message)) {
                const { scheduledTaskCreateTool } = await import('../core/scheduledTasks');
                const scheduledResult = await scheduledTaskCreateTool.handler(
                    {
                        title: buildDeferredTaskTitle(message),
                        description: `One-off scheduled task for ${reminderTime.toISOString()}`,
                        taskQuery: message,
                        scheduleType: 'date',
                        runAt: reminderTime.toISOString(),
                    },
                    context
                );

                if (!scheduledResult.success) {
                    return scheduledResult;
                }

                return {
                    success: true,
                    converted_from_reminder: true,
                    execution_type: 'scheduled_task',
                    message,
                    scheduled_at: reminderTime.toISOString(),
                    recurring: 'none',
                    human_readable: formatReminderTime(reminderTime),
                    trigger_id: scheduledResult.trigger_id,
                    triggerId: scheduledResult.triggerId,
                    scheduled_task: scheduledResult.trigger,
                };
            }

            console.error(`[Reminder] Setting reminder for: ${reminderTime.toISOString()}`);
            console.error(`[Reminder] Message: ${message}`);

            const { taskCreateTool } = await import('../core/tasks');

            const taskResult = await taskCreateTool.handler(
                {
                    title: `Reminder: ${message}`,
                    description: `Reminder scheduled for ${reminderTime.toISOString()}`,
                    priority: 'high',
                    dueDate: reminderTime.toISOString(),
                    tags: ['reminder'],
                    metadata: {
                        type: 'reminder',
                        recurring,
                        notification_enabled: true,
                        original_time_expression: time,
                    },
                },
                context
            );

            if (!taskResult.success) {
                return {
                    success: false,
                    error: `Failed to create reminder task: ${taskResult.error}`,
                };
            }

            const humanReadable = formatReminderTime(reminderTime);
            const reminderId = taskResult.taskId ?? taskResult.task_id;
            const engine = getHeartbeatEngine(context.workspacePath);
            const trigger = buildReminderTrigger(reminderId, message, reminderTime, context.workspacePath);

            engine.registerTrigger(trigger);

            console.error(`[Reminder] Successfully created reminder task: ${reminderId}`);

            return {
                success: true,
                reminder_id: reminderId,
                trigger_id: trigger.id,
                message,
                scheduled_at: reminderTime.toISOString(),
                recurring,
                human_readable: humanReadable,
                task_details: taskResult,
            };
        } catch (error) {
            console.error('[Reminder] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                suggestion: 'Try using a clearer time format like "tomorrow 3pm" or ISO 8601 timestamp',
            };
        }
    },
};

function parseTimeExpression(expr: string): Date {
    const isoDate = new Date(expr);
    if (!Number.isNaN(isoDate.getTime()) && expr.includes('T')) {
        return isoDate;
    }

    const now = new Date();
    const lower = expr.toLowerCase().trim();

    const relativeMatch = lower.match(/in\s+(\d+)\s+(minute|hour|day)s?/);
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1], 10);
        const unit = relativeMatch[2];
        const result = new Date(now);

        switch (unit) {
            case 'minute':
                result.setMinutes(result.getMinutes() + amount);
                break;
            case 'hour':
                result.setHours(result.getHours() + amount);
                break;
            case 'day':
                result.setDate(result.getDate() + amount);
                break;
        }
        return result;
    }

    const chineseRelativeMatch = lower.match(/(\d+)\s*(分钟|小时|天)\s*后/);
    if (chineseRelativeMatch) {
        const amount = parseInt(chineseRelativeMatch[1], 10);
        const unit = chineseRelativeMatch[2];
        const result = new Date(now);

        switch (unit) {
            case '分钟':
                result.setMinutes(result.getMinutes() + amount);
                break;
            case '小时':
                result.setHours(result.getHours() + amount);
                break;
            case '天':
                result.setDate(result.getDate() + amount);
                break;
        }
        return result;
    }

    if (lower.includes('tomorrow')) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const time = parseTimeOfDay(lower);
        if (time) {
            tomorrow.setHours(time.hours, time.minutes, 0, 0);
        } else {
            tomorrow.setHours(9, 0, 0, 0);
        }
        return tomorrow;
    }

    if (lower.includes('today') || lower.match(/\d{1,2}\s*(am|pm)/)) {
        const time = parseTimeOfDay(lower);
        if (time) {
            const result = new Date(now);
            result.setHours(time.hours, time.minutes, 0, 0);

            if (result < now) {
                result.setDate(result.getDate() + 1);
            }
            return result;
        }
    }

    if (lower.includes('next week')) {
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        nextWeek.setHours(9, 0, 0, 0);
        return nextWeek;
    }

    const dayOfWeekMatch = lower.match(/(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (dayOfWeekMatch) {
        const targetDay = dayOfWeekMatch[1];
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDayIndex = dayNames.indexOf(targetDay);
        const currentDayIndex = now.getDay();

        let daysToAdd = targetDayIndex - currentDayIndex;
        if (daysToAdd <= 0 || lower.includes('next')) {
            daysToAdd += 7;
        }

        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + daysToAdd);

        const time = parseTimeOfDay(lower);
        if (time) {
            targetDate.setHours(time.hours, time.minutes, 0, 0);
        } else {
            targetDate.setHours(9, 0, 0, 0);
        }

        return targetDate;
    }

    throw new Error(
        `Unable to parse time expression: "${expr}". ` +
            'Examples: "tomorrow 3pm", "in 2 hours", "Monday 10am", "2026-02-12T15:00:00Z"'
    );
}

function parseTimeOfDay(text: string): { hours: number; minutes: number } | null {
    const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3];

    if (meridiem) {
        if (meridiem === 'pm' && hours < 12) hours += 12;
        if (meridiem === 'am' && hours === 12) hours = 0;
    }

    if (hours > 23 || minutes > 59) {
        return null;
    }

    return { hours, minutes };
}

function formatReminderTime(date: Date): string {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));

    if (diffHours < 24) {
        if (diffHours < 1) {
            const diffMinutes = Math.round(diffMs / (1000 * 60));
            return `in ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;
        }
        return `in ${diffHours} hour${diffHours === 1 ? '' : 's'}`;
    }

    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) {
        return `in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
    }

    return date.toLocaleString();
}

function looksLikeDeferredTaskExecution(message: string): boolean {
    const text = message.trim();
    if (!text) {
        return false;
    }

    const reminderOnlyPatterns = [
        /\b(remind me|reminder|don't let me forget)\b/i,
        /提醒我|提醒一下|记得|别忘了/i,
    ];
    if (reminderOnlyPatterns.some((pattern) => pattern.test(text))) {
        return false;
    }

    const actionablePatterns = [
        /reddit|email|calendar|report|summary|summarize|summarise|digest|check|search|research|analy[sz]e|crawl|collect|monitor|review|run|execute|send/i,
        /总结|摘要|整理|检索|搜索|调研|分析|检查|抓取|收集|监控|执行|运行|发送/i,
    ];
    return actionablePatterns.some((pattern) => pattern.test(text));
}

function buildDeferredTaskTitle(message: string): string {
    const trimmed = message.trim();
    if (!trimmed) {
        return 'Scheduled task';
    }

    const snippet = trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed;
    return `Scheduled task: ${snippet}`;
}

function buildReminderTrigger(reminderId: string, message: string, reminderTime: Date, workspacePath: string): Trigger {
    return {
        id: randomUUID(),
        name: `Reminder: ${message}`,
        description: `One-off reminder for task ${reminderId}`,
        type: 'date',
        config: {
            runAt: reminderTime.toISOString(),
        },
        action: {
            type: 'notify',
            message,
            channel: 'reminder',
            workspacePath,
            taskConfig: {
                source: 'reminder',
                reminderTaskId: reminderId,
            },
        },
        enabled: true,
        createdAt: new Date().toISOString(),
        triggerCount: 0,
        runOnce: true,
    };
}
