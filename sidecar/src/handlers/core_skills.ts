import {
    type GetTasksCommand,
    type GetTasksResponse,
} from '../protocol';
import {
    type HandlerContext,
    type HandlerResult,
} from './identity_security';
import * as fs from 'fs';
import * as path from 'path';
import { createProactiveTaskManager } from '../agent/jarvis/proactiveTaskManager';
import type { Trigger } from '../proactive/heartbeat';

type TaskListItem = {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
    priority: 'critical' | 'high' | 'medium' | 'low';
    dueDate?: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
};

function getTaskManager(workspacePath: string) {
    const storagePath = path.join(workspacePath, '.coworkany', 'jarvis');
    return createProactiveTaskManager(storagePath);
}

function getTriggerFilePath(workspacePath: string): string {
    return path.join(workspacePath, '.coworkany', 'triggers.json');
}

function listRegularTasks(
    workspacePath: string,
    filters: { status?: string[] }
): TaskListItem[] {
    const manager = getTaskManager(workspacePath);
    return manager.listTasks(filters as any) as TaskListItem[];
}

function loadScheduledTasks(
    workspacePath: string,
    filters: { status?: string[] }
): TaskListItem[] {
    const triggerPath = getTriggerFilePath(workspacePath);
    if (!fs.existsSync(triggerPath)) {
        return [];
    }

    try {
        const content = fs.readFileSync(triggerPath, 'utf-8');
        const parsed = JSON.parse(content) as { triggers?: Trigger[] };
        const triggers = Array.isArray(parsed.triggers) ? parsed.triggers : [];
        const mapped = triggers
            .filter((trigger) => trigger.action.type === 'execute_task')
            .map<TaskListItem>((trigger) => ({
                id: trigger.id,
                title: trigger.name,
                description: trigger.description || trigger.action.taskQuery || '',
                status: trigger.enabled
                    ? (trigger.triggerCount > 0 ? 'in_progress' : 'pending')
                    : 'cancelled',
                priority: 'medium',
                tags: [
                    'scheduled',
                    trigger.type === 'cron' ? 'cron' : 'interval',
                ],
                createdAt: trigger.createdAt,
                updatedAt: trigger.lastTriggeredAt || trigger.createdAt,
            }));

        if (!filters.status || filters.status.length === 0) {
            return mapped;
        }

        return mapped.filter((task) => filters.status!.includes(task.status));
    } catch {
        return [];
    }
}

function dedupeTasks(tasks: TaskListItem[]): TaskListItem[] {
    const deduped = new Map<string, TaskListItem>();
    for (const task of tasks) {
        deduped.set(task.id, task);
    }
    return Array.from(deduped.values());
}

function sortTasks(tasks: TaskListItem[]): TaskListItem[] {
    return [...tasks].sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt).getTime();
        return bTime - aTime;
    });
}

export function handleGetTasks(
    command: GetTasksCommand,
    context: HandlerContext
): HandlerResult<GetTasksResponse> {
    const workspacePath = command.payload.workspacePath;
    const filters: any = {};
    if (command.payload.status) {
        filters.status = command.payload.status;
    }

    const rootWorkspacePath = process.cwd();
    const regularTasks = listRegularTasks(workspacePath, filters);
    const scheduledTasks = loadScheduledTasks(workspacePath, filters);

    // Compatibility fallback:
    // older task/tool execution paths sometimes persisted data under sidecar root
    // instead of the active workspace, so surface that data until creation paths
    // are fully normalized.
    const fallbackRegularTasks =
        regularTasks.length === 0 && workspacePath !== rootWorkspacePath
            ? listRegularTasks(rootWorkspacePath, filters)
            : [];
    const fallbackScheduledTasks =
        scheduledTasks.length === 0 && workspacePath !== rootWorkspacePath
            ? loadScheduledTasks(rootWorkspacePath, filters)
            : [];

    const tasks = sortTasks(
        dedupeTasks([
            ...regularTasks,
            ...scheduledTasks,
            ...fallbackRegularTasks,
            ...fallbackScheduledTasks,
        ])
    );
    const limit = command.payload.limit;
    const resultTasks = limit ? tasks.slice(0, limit) : tasks;

    return {
        response: {
            commandId: command.id,
            timestamp: context.now(),
            type: 'get_tasks_response',
            payload: {
                success: true,
                tasks: resultTasks,
                count: resultTasks.length
            }
        },
        events: []
    };
}
