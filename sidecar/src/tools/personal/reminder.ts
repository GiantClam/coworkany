import { ToolDefinition, ToolContext } from '../standard';

/**
 * Reminder Tool - bound to scheduled task runtime
 *
 * The runtime-bound version (`createSetReminderTool`) delegates to `schedule_task`
 * so reminders survive restarts and are executed by the scheduler heartbeat.
 */
const notImplementedHandler = async (args: Record<string, unknown>) => ({
    success: false,
    error: 'Scheduler not initialized. set_reminder requires runtime binding in main.ts.',
    args,
});

type ReminderRecurring = 'none' | 'daily' | 'weekly' | 'monthly';

type SetReminderArgs = {
    message: string;
    time: string;
    recurring?: ReminderRecurring;
};

export interface SetReminderToolHandlers {
    scheduleTask: (args: {
        task_query: string;
        time: string;
        speak_result?: boolean;
        title?: string;
    }, context: ToolContext) => Promise<unknown>;
}

export const setReminderTool: ToolDefinition = {
    name: 'set_reminder',
    description: 'Set a reminder for a specific time. Runtime-bound mode schedules via scheduler so reminders continue after restarts.',
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
    handler: notImplementedHandler,
};

function normalizeReminderQuery(message: string): string {
    const trimmed = message.trim();
    if (!trimmed) {
        return '提醒你处理待办事项';
    }
    const chineseIntentMatch = trimmed.match(/^(?:请)?(?:叫我|提醒我|记得|让我记得)(.+)$/u);
    if (chineseIntentMatch?.[1]) {
        const action = chineseIntentMatch[1]
            .trim()
            .replace(/(?:一次|一下)$/u, '')
            .trim();
        if (action) {
            return `提醒你${action}`;
        }
    }
    const englishIntentMatch = trimmed.match(/^(?:please\s+)?remind\s+me(?:\s+to)?\s+(.+)$/iu);
    if (englishIntentMatch?.[1]) {
        const action = englishIntentMatch[1].trim();
        if (action) {
            return `remind you to ${action}`;
        }
    }
    if (/(?:提醒|remind)/iu.test(trimmed)) {
        return trimmed
            .replace(/提醒我/gu, '提醒你')
            .replace(/\bremind\s+me\b/giu, 'remind you');
    }
    if (/^[\x00-\x7F]+$/.test(trimmed)) {
        return `remind you to ${trimmed}`;
    }
    return `提醒你${trimmed}`;
}

function buildReminderTitle(message: string): string {
    const normalized = normalizeReminderQuery(message)
        .replace(/^提醒你/u, '')
        .replace(/^remind you to\s+/iu, '')
        .trim();
    if (!normalized) {
        return 'Reminder';
    }
    const title = `提醒：${normalized}`;
    return title.length > 60 ? `${title.slice(0, 60)}...` : title;
}

function buildRecurringScheduleQuery(input: {
    message: string;
    recurring: ReminderRecurring;
    executeAtIso: string;
    originalTimeExpression: string;
}): { taskQuery: string; recurringNote?: string } {
    const normalizedQuery = normalizeReminderQuery(input.message);
    const { recurring, executeAtIso } = input;
    const relativeInterval = parseRelativeIntervalExpression(input.originalTimeExpression);

    if (recurring === 'daily') {
        if (relativeInterval && relativeInterval.unit !== 'day') {
            const unitLabel = relativeInterval.amount === 1
                ? relativeInterval.unit
                : `${relativeInterval.unit}s`;
            return {
                taskQuery: `${executeAtIso} every ${relativeInterval.amount} ${unitLabel} ${normalizedQuery}`,
                recurringNote: `daily recurrence was interpreted as an interval from "${input.originalTimeExpression}"`,
            };
        }
        return {
            taskQuery: `${executeAtIso} every day ${normalizedQuery}`,
        };
    }

    if (recurring === 'weekly') {
        return {
            taskQuery: `${executeAtIso} every 7 days ${normalizedQuery}`,
            recurringNote: 'weekly reminders are approximated as every 7 days',
        };
    }

    if (recurring === 'monthly') {
        return {
            taskQuery: `${executeAtIso} every 30 days ${normalizedQuery}`,
            recurringNote: 'monthly reminders are approximated as every 30 days',
        };
    }

    return {
        taskQuery: normalizedQuery,
    };
}

function parseRelativeIntervalExpression(raw: string): { amount: number; unit: 'minute' | 'hour' | 'day' } | null {
    const match = raw.trim().toLowerCase().match(/^in\s+(\d+)\s+(minute|hour|day)s?$/);
    if (!match) {
        return null;
    }
    const amount = Number(match[1]);
    const unit = match[2] as 'minute' | 'hour' | 'day';
    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }
    return { amount, unit };
}

export function createSetReminderTool(handlers: SetReminderToolHandlers): ToolDefinition {
    return {
        ...setReminderTool,
        handler: async (args: SetReminderArgs, context: ToolContext) => {
            const { message, time, recurring = 'none' } = args;

            try {
                const reminderTime = parseTimeExpression(time);
                const executeAtIso = reminderTime.toISOString();
                const recurringPlan = buildRecurringScheduleQuery({
                    message,
                    recurring,
                    executeAtIso,
                    originalTimeExpression: time,
                });

                const scheduleResult = await handlers.scheduleTask({
                    task_query: recurringPlan.taskQuery,
                    time: executeAtIso,
                    speak_result: false,
                    title: buildReminderTitle(message),
                }, context) as {
                    success?: boolean;
                    error?: string;
                    scheduledTaskId?: string;
                    scheduledAt?: string;
                };

                if (!scheduleResult?.success) {
                    return {
                        success: false,
                        error: `Failed to schedule reminder: ${scheduleResult?.error || 'unknown scheduler error'}`,
                    };
                }

                const scheduledAt = typeof scheduleResult.scheduledAt === 'string'
                    ? scheduleResult.scheduledAt
                    : executeAtIso;

                return {
                    success: true,
                    reminder_id: scheduleResult.scheduledTaskId,
                    message,
                    scheduled_at: scheduledAt,
                    recurring,
                    recurring_note: recurringPlan.recurringNote,
                    human_readable: formatReminderTime(new Date(scheduledAt)),
                    schedule_details: scheduleResult,
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
}

/**
 * Parse time expressions (natural language and ISO 8601)
 */
function parseTimeExpression(expr: string): Date {
    // Try parsing ISO 8601 first
    const isoDate = new Date(expr);
    if (!isNaN(isoDate.getTime()) && expr.includes('T')) {
        return isoDate;
    }

    // Natural language parsing
    const now = new Date();
    const lower = expr.toLowerCase().trim();

    // Relative time: "in X minutes/hours/days"
    const relativeMatch = lower.match(/in\s+(\d+)\s+(minute|hour|day)s?/);
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1]);
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

    // Tomorrow with optional time
    if (lower.includes('tomorrow')) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const timeMatch = lower.match(/(\d{1,2})\s*(am|pm|:)/);
        if (timeMatch) {
            const parsedTime = parseTimeOfDay(lower);
            if (parsedTime) {
                tomorrow.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
            } else {
                tomorrow.setHours(9, 0, 0, 0); // Default 9am
            }
        } else {
            tomorrow.setHours(9, 0, 0, 0); // Default 9am
        }
        return tomorrow;
    }

    // Today with time
    if (lower.includes('today') || lower.match(/\d{1,2}\s*(am|pm)/)) {
        const parsedTime = parseTimeOfDay(lower);
        if (parsedTime) {
            const result = new Date(now);
            result.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);

            // If time is in the past, set for tomorrow
            if (result < now) {
                result.setDate(result.getDate() + 1);
            }
            return result;
        }
    }

    // Next week
    if (lower.includes('next week')) {
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        nextWeek.setHours(9, 0, 0, 0);
        return nextWeek;
    }

    // Day of week (e.g., "Monday", "next Friday")
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

        const parsedTime = parseTimeOfDay(lower);
        if (parsedTime) {
            targetDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
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

/**
 * Parse time of day from text (e.g., "3pm", "10:30am")
 */
function parseTimeOfDay(text: string): { hours: number; minutes: number } | null {
    // Match formats: "3pm", "10am", "3:30pm", "10:30am", "15:00"
    const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const meridiem = timeMatch[3];

    if (meridiem) {
        // 12-hour format
        if (meridiem === 'pm' && hours < 12) hours += 12;
        if (meridiem === 'am' && hours === 12) hours = 0;
    }

    // Validate
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }

    return { hours, minutes };
}

/**
 * Format reminder time for human-readable display
 */
function formatReminderTime(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const diffMinutes = Math.floor(diff / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString();

    if (diffMinutes < 60) {
        return `in ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} (${timeStr})`;
    } else if (diffHours < 24) {
        return `in ${diffHours} hour${diffHours !== 1 ? 's' : ''} (${timeStr})`;
    } else if (diffDays === 1) {
        return `tomorrow at ${timeStr}`;
    } else if (diffDays < 7) {
        return `in ${diffDays} days at ${timeStr} (${dateStr})`;
    } else {
        return `on ${dateStr} at ${timeStr}`;
    }
}
