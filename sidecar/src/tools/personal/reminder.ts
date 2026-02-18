import { ToolDefinition, ToolContext } from '../standard';

/**
 * Reminder Tool - Integrated with Task System
 *
 * Creates reminders as high-priority tasks with notifications
 */
export const setReminderTool: ToolDefinition = {
    name: 'set_reminder',
    description: 'Set a reminder for a specific time. Creates a task with notification. Use when user asks to remind them about something.',
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
            // Parse time expression
            const reminderTime = parseTimeExpression(time);

            console.error(`[Reminder] Setting reminder for: ${reminderTime.toISOString()}`);
            console.error(`[Reminder] Message: ${message}`);

            // Use existing task system to create reminder
            const { taskCreateTool } = await import('../core/tasks');

            const taskResult = await taskCreateTool.handler(
                {
                    title: `🔔 ${message}`,
                    priority: 'high',
                    due_date: reminderTime.toISOString(),
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

            console.error(`[Reminder] Successfully created reminder task: ${taskResult.task_id}`);

            return {
                success: true,
                reminder_id: taskResult.task_id,
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
            const time = parseTimeOfDay(lower);
            if (time) {
                tomorrow.setHours(time.hours, time.minutes, 0, 0);
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
        const time = parseTimeOfDay(lower);
        if (time) {
            const result = new Date(now);
            result.setHours(time.hours, time.minutes, 0, 0);

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
