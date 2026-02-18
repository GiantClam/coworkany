/**
 * Core Email Tools
 *
 * Provides email management capabilities (Check, Send, Reply, Get Thread).
 * Integrates with Gmail API and task system.
 * Part of the OpenClaw-compatible tool architecture.
 */

import { ToolDefinition, ToolContext } from '../standard';
import { getEmailManager } from '../../integrations/email/emailManager';

/**
 * email_check - Check and filter emails
 */
export const emailCheckTool: ToolDefinition = {
    name: 'email_check',
    description: 'Check emails with intelligent filtering. Returns unread, important, or action-required messages. Use for email summaries and inbox management.',
    effects: ['network:outbound', 'state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            filter: {
                type: 'string',
                enum: ['unread', 'important', 'action_required', 'all'],
                description: 'Filter emails by type (default: unread)',
            },
            max_results: {
                type: 'number',
                description: 'Maximum number of emails to return (default: 20)',
            },
            query: {
                type: 'string',
                description: 'Optional search query (e.g., "from:sarah@company.com", "subject:invoice")',
            },
            since: {
                type: 'string',
                description: 'Only show emails since this timestamp (ISO 8601)',
            },
        },
    },
    handler: async (args: any, context: ToolContext) => {
        try {
            const manager = getEmailManager(context.workspacePath);

            // Check if email is configured
            if (!manager.isConfigured()) {
                return {
                    success: false,
                    error: 'Email not configured',
                    message: 'Email integration requires Google API credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
                };
            }

            const options: any = {
                maxResults: args.max_results || 20,
                query: args.query,
                since: args.since,
            };

            // Apply filter
            const filter = args.filter || 'unread';
            if (filter === 'unread') {
                options.unreadOnly = true;
            } else if (filter === 'important') {
                options.important = true;
                options.unreadOnly = true;
            }

            const messages = await manager.getMessages(options);

            // Additional filtering for action_required
            let filtered = messages;
            if (filter === 'action_required') {
                filtered = manager.filterActionRequired(messages);
            } else if (filter === 'important') {
                filtered = manager.filterImportant(messages);
            }

            return {
                success: true,
                filter,
                count: filtered.length,
                emails: filtered.map(formatEmailForDisplay),
            };
        } catch (error) {
            return {
                success: false,
                error: String(error),
                message: 'Failed to check emails.',
            };
        }
    },
};

/**
 * email_send - Send a new email
 */
export const emailSendTool: ToolDefinition = {
    name: 'email_send',
    description: 'Send a new email. Can optionally create a follow-up task for tracking responses.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            to: {
                type: 'array',
                items: { type: 'string' },
                description: 'Recipient email addresses',
            },
            cc: {
                type: 'array',
                items: { type: 'string' },
                description: 'CC email addresses',
            },
            bcc: {
                type: 'array',
                items: { type: 'string' },
                description: 'BCC email addresses',
            },
            subject: {
                type: 'string',
                description: 'Email subject',
            },
            body: {
                type: 'string',
                description: 'Email body (plain text)',
            },
            body_html: {
                type: 'string',
                description: 'Email body (HTML format)',
            },
            create_task: {
                type: 'boolean',
                description: 'Create a follow-up task to track response (default: false)',
            },
        },
        required: ['to', 'subject', 'body'],
    },
    handler: async (args: any, context: ToolContext) => {
        try {
            const manager = getEmailManager(context.workspacePath);

            // Check if email is configured
            if (!manager.isConfigured()) {
                return {
                    success: false,
                    error: 'Email not configured',
                    message: 'Email integration requires Google API credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
                };
            }

            const email = await manager.sendEmail({
                to: args.to,
                cc: args.cc,
                bcc: args.bcc,
                subject: args.subject,
                body: args.body,
                bodyHtml: args.body_html,
            });

            // Create follow-up task if requested
            let task = null;
            if (args.create_task) {
                const { taskCreateTool } = await import('./tasks');
                const taskResult = await taskCreateTool.handler(
                    {
                        title: `Follow up: ${args.subject}`,
                        description: `Sent to: ${args.to.join(', ')}`,
                        priority: 'medium',
                        tags: ['email', 'follow-up'],
                    },
                    context
                );

                if (taskResult.success) {
                    task = taskResult.task;
                    // Link email to task
                    const { createProactiveTaskManager } = await import('../../agent/jarvis/proactiveTaskManager');
                    const path = await import('path');
                    const storagePath = path.default.join(context.workspacePath, '.coworkany', 'jarvis');
                    const taskManager = createProactiveTaskManager(storagePath);
                    taskManager.updateTask(task.id, {
                        relatedEmails: [email.id],
                    });
                }
            }

            return {
                success: true,
                email: formatEmailForDisplay(email),
                message: `Email sent to ${args.to.join(', ')}`,
                task: task,
            };
        } catch (error) {
            return {
                success: false,
                error: String(error),
                message: 'Failed to send email.',
            };
        }
    },
};

/**
 * email_reply - Reply to an email
 */
export const emailReplyTool: ToolDefinition = {
    name: 'email_reply',
    description: 'Reply to an existing email. Supports reply-all for group conversations.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            email_id: {
                type: 'string',
                description: 'ID of the email to reply to',
            },
            body: {
                type: 'string',
                description: 'Reply message body',
            },
            reply_all: {
                type: 'boolean',
                description: 'Reply to all recipients (default: false)',
            },
        },
        required: ['email_id', 'body'],
    },
    handler: async (args: any, context: ToolContext) => {
        try {
            const manager = getEmailManager(context.workspacePath);

            // Check if email is configured
            if (!manager.isConfigured()) {
                return {
                    success: false,
                    error: 'Email not configured',
                    message: 'Email integration requires Google API credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
                };
            }

            const reply = await manager.replyToEmail(
                args.email_id,
                args.body,
                args.reply_all || false
            );

            return {
                success: true,
                email: formatEmailForDisplay(reply),
                message: `Reply sent`,
                reply_all: args.reply_all || false,
            };
        } catch (error) {
            return {
                success: false,
                error: String(error),
                message: `Failed to reply to email ${args.email_id}.`,
            };
        }
    },
};

/**
 * email_get_thread - Get complete email thread
 */
export const emailGetThreadTool: ToolDefinition = {
    name: 'email_get_thread',
    description: 'Retrieve a complete email conversation thread. Useful for understanding context and history.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            thread_id: {
                type: 'string',
                description: 'Thread ID to retrieve',
            },
        },
        required: ['thread_id'],
    },
    handler: async (args: any, context: ToolContext) => {
        try {
            const manager = getEmailManager(context.workspacePath);

            // Check if email is configured
            if (!manager.isConfigured()) {
                return {
                    success: false,
                    error: 'Email not configured',
                    message: 'Email integration requires Google API credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
                };
            }

            const thread = await manager.getThread(args.thread_id);

            return {
                success: true,
                thread: {
                    id: thread.id,
                    subject: thread.subject,
                    message_count: thread.messageCount,
                    participants: thread.participants,
                    last_message_time: thread.lastMessageTime,
                    messages: thread.messages.map(formatEmailForDisplay),
                },
            };
        } catch (error) {
            return {
                success: false,
                error: String(error),
                message: `Failed to retrieve thread ${args.thread_id}.`,
            };
        }
    },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format email for display
 */
function formatEmailForDisplay(email: any) {
    return {
        id: email.id,
        thread_id: email.threadId,
        from: email.from,
        to: email.to,
        cc: email.cc,
        subject: email.subject,
        body_preview: email.body?.slice(0, 200) + (email.body?.length > 200 ? '...' : ''),
        timestamp: email.timestamp,
        timestamp_display: new Date(email.timestamp).toLocaleString(),
        read: email.read,
        starred: email.starred,
        important: email.important,
        labels: email.labels,
        has_attachments: email.attachments && email.attachments.length > 0,
        attachment_count: email.attachments?.length || 0,
    };
}
