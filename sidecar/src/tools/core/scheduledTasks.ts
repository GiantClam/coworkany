import { randomUUID } from 'crypto';
import type { ToolDefinition, ToolContext } from '../standard';
import type { Trigger } from '../../proactive/heartbeat';
import { getHeartbeatEngine } from '../../proactive/runtime';

type ScheduleType = 'interval' | 'cron' | 'date';

function buildExecuteTaskTrigger(
    args: Record<string, any>,
    context: ToolContext
): Trigger {
    const now = new Date().toISOString();
    const scheduleType: ScheduleType =
        args.scheduleType === 'cron' || args.scheduleType === 'date'
            ? args.scheduleType
            : 'interval';

    if (scheduleType === 'cron' && typeof args.cron !== 'string') {
        throw new Error('cron is required when scheduleType is "cron".');
    }

    if (scheduleType === 'interval') {
        const minutes = Number(args.intervalMinutes);
        if (!Number.isFinite(minutes) || minutes <= 0) {
            throw new Error('intervalMinutes must be a positive number.');
        }
    }

    if (scheduleType === 'date') {
        if (typeof args.runAt !== 'string' || args.runAt.trim().length === 0) {
            throw new Error('runAt is required when scheduleType is "date".');
        }

        const runAt = new Date(args.runAt);
        if (Number.isNaN(runAt.getTime())) {
            throw new Error('runAt must be a valid ISO timestamp.');
        }
    }

    return {
        id: randomUUID(),
        name: String(args.title || 'Scheduled task'),
        description: typeof args.description === 'string' ? args.description : undefined,
        type: scheduleType,
        config:
            scheduleType === 'cron'
                ? { expression: String(args.cron) }
                : scheduleType === 'date'
                    ? { runAt: String(args.runAt) }
                    : { intervalMs: Math.max(1000, Math.round(Number(args.intervalMinutes) * 60_000)) },
        action: {
            type: 'execute_task',
            taskQuery: String(args.taskQuery),
            workspacePath: context.workspacePath,
            taskConfig: {
                source: 'scheduled_task',
                createdByTool: 'scheduled_task_create',
            },
        },
        enabled: args.enabled !== false,
        createdAt: now,
        triggerCount: 0,
        runOnce: scheduleType === 'date',
    };
}

function normalizeTriggerSummary(trigger: Trigger) {
    return {
        id: trigger.id,
        title: trigger.name,
        description: trigger.description,
        enabled: trigger.enabled,
        type: trigger.type,
        schedule:
            trigger.type === 'cron'
                ? { cron: (trigger.config as { expression: string }).expression }
                : trigger.type === 'date'
                    ? { runAt: (trigger.config as { runAt: string }).runAt }
                    : { intervalMs: (trigger.config as { intervalMs: number }).intervalMs },
        taskQuery: trigger.action.taskQuery,
        createdAt: trigger.createdAt,
        lastTriggeredAt: trigger.lastTriggeredAt,
        triggerCount: trigger.triggerCount,
    };
}

export const scheduledTaskCreateTool: ToolDefinition = {
    name: 'scheduled_task_create',
    description: 'Create a scheduled task that executes work in the future. Supports one-off delayed execution with scheduleType "date", recurring intervals with scheduleType "interval", and cron-like schedules with scheduleType "cron".',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Human-readable schedule name.' },
            description: { type: 'string', description: 'Optional description.' },
            taskQuery: { type: 'string', description: 'The query/instruction to execute when the trigger fires.' },
            scheduleType: {
                type: 'string',
                enum: ['interval', 'cron', 'date'],
                description: 'Use "interval" for every N minutes, "cron" for cron expressions, or "date" for one-off delayed execution.',
            },
            intervalMinutes: {
                type: 'number',
                description: 'Required for interval schedules. Example: 60 means every hour.',
            },
            cron: {
                type: 'string',
                description: 'Required for cron schedules. Standard 5-field cron expression.',
            },
            runAt: {
                type: 'string',
                description: 'Required for one-off schedules. ISO 8601 timestamp for when the task should execute.',
            },
            enabled: {
                type: 'boolean',
                description: 'Whether the schedule is enabled immediately.',
            },
        },
        required: ['title', 'taskQuery', 'scheduleType'],
    },
    handler: async (args: Record<string, any>, context: ToolContext) => {
        try {
            const engine = getHeartbeatEngine(context.workspacePath);
            const trigger = buildExecuteTaskTrigger(args, context);
            engine.registerTrigger(trigger);

            return {
                success: true,
                triggerId: trigger.id,
                trigger_id: trigger.id,
                message: `Scheduled task "${trigger.name}" created.`,
                trigger: normalizeTriggerSummary(trigger),
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

export const scheduledTaskListTool: ToolDefinition = {
    name: 'scheduled_task_list',
    description: 'List scheduled tasks, including both recurring schedules and one-off delayed execution tasks.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            enabledOnly: {
                type: 'boolean',
                description: 'If true, only return enabled schedules.',
            },
        },
    },
    handler: async (args: Record<string, any>, context: ToolContext) => {
        try {
            const engine = getHeartbeatEngine(context.workspacePath);
            let triggers = engine.getTriggers().filter(trigger => trigger.action.type === 'execute_task');
            if (args.enabledOnly) {
                triggers = triggers.filter(trigger => trigger.enabled);
            }

            return {
                success: true,
                count: triggers.length,
                triggers: triggers.map(normalizeTriggerSummary),
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

export const scheduledTaskDeleteTool: ToolDefinition = {
    name: 'scheduled_task_delete',
    description: 'Delete a scheduled task.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            triggerId: { type: 'string', description: 'ID of the scheduled task trigger.' },
        },
        required: ['triggerId'],
    },
    handler: async (args: Record<string, any>, context: ToolContext) => {
        try {
            const engine = getHeartbeatEngine(context.workspacePath);
            const removed = engine.unregisterTrigger(String(args.triggerId));
            if (!removed) {
                return {
                    success: false,
                    error: `Scheduled task ${String(args.triggerId)} not found.`,
                };
            }

            return {
                success: true,
                triggerId: String(args.triggerId),
                trigger_id: String(args.triggerId),
                message: `Scheduled task ${String(args.triggerId)} deleted.`,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};
