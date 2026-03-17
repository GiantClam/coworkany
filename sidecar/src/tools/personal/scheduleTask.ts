import type { ToolContext, ToolDefinition } from '../standard';

const notImplementedHandler = async (args: Record<string, unknown>) => ({
    success: false,
    error: 'Scheduler not initialized. schedule_task requires runtime binding in main.ts.',
    args,
});

export const scheduleTaskTool: ToolDefinition = {
    name: 'schedule_task',
    description: 'Schedule a task to run in the future. Use this when the user asks for something to happen later, such as "两分钟后帮我总结..." or "in 2 hours research X".',
    effects: ['state:remember', 'ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            task_query: {
                type: 'string',
                description: 'The task to execute later.',
            },
            time: {
                type: 'string',
                description: 'When to execute the task. Supports ISO 8601 or natural language like "in 2 minutes" or "两分钟后".',
            },
            speak_result: {
                type: 'boolean',
                description: 'Whether to read the result aloud after the task completes.',
                default: false,
            },
            title: {
                type: 'string',
                description: 'Optional short title for the scheduled task.',
            },
        },
        required: ['task_query', 'time'],
    },
    handler: notImplementedHandler,
};

export interface ScheduleTaskToolHandlers {
    scheduleTask: (args: {
        task_query: string;
        time: string;
        speak_result?: boolean;
        title?: string;
    }, context: ToolContext) => Promise<unknown>;
}

export function createScheduleTaskTool(handlers: ScheduleTaskToolHandlers): ToolDefinition {
    return {
        ...scheduleTaskTool,
        handler: handlers.scheduleTask,
    };
}
