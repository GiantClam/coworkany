import { promises as fs } from 'fs';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
export const deleteFilesTool = createTool({
    id: 'delete_files',
    description: 'Delete files or directories in batch. Always requires approval.',
    inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1),
        reason: z.string().min(1),
    }),
    outputSchema: z.object({
        deleted: z.number().int().nonnegative(),
        failedPaths: z.array(z.string()),
    }),
    requireApproval: true,
    execute: async ({ paths }) => {
        let deleted = 0;
        const failedPaths: string[] = [];
        for (const filePath of paths) {
            try {
                await fs.rm(filePath, { recursive: true, force: true });
                deleted += 1;
            } catch {
                failedPaths.push(filePath);
            }
        }
        return {
            deleted,
            failedPaths,
        };
    },
});
export const sendEmailTool = createTool({
    id: 'send_email',
    description: 'Send email through enterprise mail provider. Always requires approval.',
    inputSchema: z.object({
        to: z.string().email(),
        subject: z.string().min(1),
        body: z.string().min(1),
    }),
    outputSchema: z.object({
        sent: z.boolean(),
        provider: z.string(),
        message: z.string(),
    }),
    requireApproval: true,
    execute: async ({ to, subject }) => {
        return {
            sent: false,
            provider: 'stub',
            message: `Email queued for provider integration: ${to} / ${subject}`,
        };
    },
});
