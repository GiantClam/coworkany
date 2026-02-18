/**
 * Core Task Skill
 * 
 * Provides task management capabilities (Create, List, Update).
 * Part of the Unified Capability Model.
 */

import * as path from 'path';
import { ToolDefinition, ToolContext } from '../standard';
import { createProactiveTaskManager } from '../../agent/jarvis/proactiveTaskManager';

// Helper to get manager for current workspace context
function getTaskManager(workspacePath: string) {
    const storagePath = path.join(workspacePath, '.coworkany', 'jarvis');
    return createProactiveTaskManager(storagePath);
}

export const taskCreateTool: ToolDefinition = {
    name: 'task_create',
    description: 'Create a new task in the user\'s personal task list.',
    effects: ['state:remember'], // Persistent state modification
    input_schema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Task title' },
            description: { type: 'string', description: 'Detailed description' },
            priority: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low'],
                description: 'Task priority (default: medium)'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorization'
            }
        },
        required: ['title'],
    },
    handler: async (args: any, context: ToolContext) => {
        const manager = getTaskManager(context.workspacePath);

        try {
            const task = manager.createTask({
                title: args.title,
                description: args.description || '',
                priority: args.priority || 'medium',
                status: 'pending',
                tags: args.tags || [],
                dependencies: []
            });

            return {
                success: true,
                taskId: task.id,
                message: `Task "${task.title}" created.`,
                task: task
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
};

export const taskListTool: ToolDefinition = {
    name: 'task_list',
    description: 'List user\'s tasks with optional filtering.',
    effects: ['state:remember'], // Reading persistent state
    input_schema: {
        type: 'object',
        properties: {
            status: {
                type: 'array',
                items: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] },
                description: 'Filter by status (default: pending, in_progress)'
            },
            limit: { type: 'number', description: 'Max number of tasks to return' }
        }
    },
    handler: async (args: any, context: ToolContext) => {
        const manager = getTaskManager(context.workspacePath);

        try {
            const filters = {
                status: args.status || ['pending', 'in_progress']
            };

            const tasks = manager.listTasks(filters);
            const limitedTasks = args.limit ? tasks.slice(0, args.limit) : tasks;

            return {
                success: true,
                count: limitedTasks.length,
                total: tasks.length,
                tasks: limitedTasks
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
};

export const taskUpdateTool: ToolDefinition = {
    name: 'task_update',
    description: 'Update the status or details of an existing task.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            taskId: { type: 'string', description: 'The ID of the task to update' },
            status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'blocked', 'cancelled']
            },
            notes: { type: 'string', description: 'Add a note/comment to the task context' }
        },
        required: ['taskId']
    },
    handler: async (args: any, context: ToolContext) => {
        const manager = getTaskManager(context.workspacePath);

        try {
            const updates: any = {};
            if (args.status) updates.status = args.status;

            if (args.notes) {
                const task = manager.getTask(args.taskId);
                if (task) {
                    const ctx = task.context || {};
                    const notes = (ctx.notes as string[]) || [];
                    notes.push(`${new Date().toISOString()}: ${args.notes}`);
                    updates.context = { ...ctx, notes };
                }
            }

            const updatedTask = manager.updateTask(args.taskId, updates);

            if (!updatedTask) {
                return { success: false, error: `Task ${args.taskId} not found` };
            }

            return {
                success: true,
                message: `Task updated to ${updatedTask.status}`,
                task: updatedTask
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
};
