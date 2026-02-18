import {
    type GetTasksCommand,
    type GetTasksResponse,
} from '../protocol';
import {
    type HandlerContext,
    type HandlerResult,
} from './identity_security';
import * as path from 'path';
import { createProactiveTaskManager } from '../agent/jarvis/proactiveTaskManager';

function getTaskManager(workspacePath: string) {
    const storagePath = path.join(workspacePath, '.coworkany', 'jarvis');
    return createProactiveTaskManager(storagePath);
}

export function handleGetTasks(
    command: GetTasksCommand,
    context: HandlerContext
): HandlerResult<GetTasksResponse> {
    const workspacePath = command.payload.workspacePath;
    const manager = getTaskManager(workspacePath);

    const filters: any = {};
    if (command.payload.status) {
        filters.status = command.payload.status;
    }

    const tasks = manager.listTasks(filters);
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
