import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
export const createReminderTool = createTool({
    id: 'create_reminder',
    description: 'Create a lightweight reminder record.',
    inputSchema: z.object({
        title: z.string().min(1),
        dueAt: z.string().optional(),
        notes: z.string().optional(),
    }),
    outputSchema: z.object({
        created: z.boolean(),
        reminderId: z.string(),
    }),
    execute: async ({ title }) => {
        const reminderId = `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        console.info('[Mastra Reminder]', { reminderId, title });
        return {
            created: true,
            reminderId,
        };
    },
});
export const enterpriseTools = {
    createReminder: createReminderTool,
};
