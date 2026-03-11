import { randomUUID } from 'crypto';
import type { ToolDefinition, ToolContext } from '../standard';
import type { Trigger } from '../../proactive/heartbeat';
import { getHeartbeatEngine } from '../../proactive/runtime';

function buildExecuteTaskTrigger(
    args: Record<string, any>,
    context: ToolContext
): Trigger {
    const now = new Date().toISOString();
    const scheduleType = args.scheduleType === 'cron' ? 'cron' : 'interval';

    if (scheduleType === 'cron' && typeof args.cron !== 'string') {
        throw new Error('cron is required when scheduleType is "cron".');
    }

    if (scheduleType === 'interval') {
        const minutes = Number(args.intervalMinutes);
        if (!Number.isFinite(minutes) || minutes <= 0) {
            throw new Error('intervalMinutes must be a positive number.');
        }
    }

    return {
        id: randomUUID(),
        name: String(args.title || 'Scheduled task'),
        description: typeof args.description === 'string' ? args.description : undefined,
        type: scheduleType,
        config: scheduleType === 'cron'
            ? { expression: args.cron }
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
    };
}

function normalizeTriggerSummary(trigger: Trigger) {
    return {
        id: trigger.id,
        title: trigger.name,
        description: trigger.description,
        enabled: trigger.enabled,
        type: trigger.type,
        schedule: trigger.type === 'cron'
            ? { cron: (trigger.config as { expression: string }).expression }
            : { intervalMs: (trigger.config as { intervalMs: number }).intervalMs },
        taskQuery: trigger.action.taskQuery,
        createdAt: trigger.createdAt,
        lastTriggeredAt: trigger.lastTriggeredAt,
        triggerCount: trigger.triggerCount,
    };
}

export const scheduledTaskCreateTool: ToolDefinition = {
    name: 'scheduled_task_create',
    description: 'Create a recurring scheduled task. Use when the user asks to run something every hour, every day, weekly, or on a cron-like schedule.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Human-readable schedule name.' },
            description: { type: 'string', description: 'Optional description.' },
            taskQuery: { type: 'string', description: 'The query/instruction to run each time the schedule fires.' },
            scheduleType: {
                type: 'string',
                enum: ['interval', 'cron'],
                description: 'Use "interval" for every N minutes, or "cron" for cron expressions.',
            },
            intervalMinutes: {
                type: 'number',
                description: 'Required for interval schedules. Example: 60 means every hour.',
            },
            cron: {
                type: 'string',
                description: 'Required for cron schedules. Standard 5-field cron expression.',
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
    description: 'List recurring scheduled tasks.',
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
    description: 'Delete a recurring scheduled task.',
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
