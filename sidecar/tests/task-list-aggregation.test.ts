import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { handleGetTasks } from '../src/handlers/core_skills';
import { taskCreateTool } from '../src/tools/core/tasks';
import { scheduledTaskCreateTool } from '../src/tools/core/scheduledTasks';
import { shutdownHeartbeatEngines } from '../src/proactive/runtime';

const originalCwd = process.cwd();
const tempRoots: string[] = [];

function createTempRoot(): string {
    const root = path.join(originalCwd, '.tmp', `task-list-${randomUUID()}`);
    fs.mkdirSync(root, { recursive: true });
    tempRoots.push(root);
    return root;
}

function createWorkspace(root: string, name = 'workspace'): string {
    const workspacePath = path.join(root, name);
    fs.mkdirSync(workspacePath, { recursive: true });
    return workspacePath;
}

afterEach(() => {
    shutdownHeartbeatEngines();
    process.chdir(originalCwd);
    for (const root of tempRoots.splice(0)) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // ignore cleanup failures in tests
        }
    }
});

describe('task list aggregation', () => {
    test('get_tasks returns regular tasks and scheduled tasks for the active workspace', async () => {
        const root = createTempRoot();
        const workspacePath = createWorkspace(root, 'workspace-a');

        await taskCreateTool.handler(
            {
                title: 'Prepare brief',
                description: 'Create summary for standup',
                priority: 'high',
                tags: ['manual'],
            },
            { workspacePath, taskId: 'task-list-regular' }
        );

        await scheduledTaskCreateTool.handler(
            {
                title: 'Hourly AI digest',
                taskQuery: 'Search latest AI news every hour',
                scheduleType: 'interval',
                intervalMinutes: 60,
            },
            { workspacePath, taskId: 'task-list-scheduled' }
        );

        const triggerFile = path.join(workspacePath, '.coworkany', 'triggers.json');
        const triggerConfig = JSON.parse(fs.readFileSync(triggerFile, 'utf-8')) as {
            triggers: Array<Record<string, unknown>>;
        };
        triggerConfig.triggers[0] = {
            ...triggerConfig.triggers[0],
            lastRunStatus: 'completed',
            lastRunSummary: 'Digest generated successfully.',
            lastRunFinishedAt: new Date().toISOString(),
            recentRuns: [
                {
                    status: 'completed',
                    summary: 'Digest generated successfully.',
                    finishedAt: new Date().toISOString(),
                },
                {
                    status: 'failed',
                    summary: 'Temporary upstream rate limit.',
                    finishedAt: new Date(Date.now() - 60_000).toISOString(),
                },
            ],
        };
        fs.writeFileSync(triggerFile, JSON.stringify(triggerConfig, null, 2));

        const result = handleGetTasks(
            {
                id: 'cmd-1',
                type: 'get_tasks',
                timestamp: new Date().toISOString(),
                payload: { workspacePath },
            } as any,
            {
                taskId: 'cmd-1',
                now: () => new Date().toISOString(),
                nextEventId: () => 'evt-1',
                nextSequence: () => 1,
            }
        );

        const tasks = result.response.payload.tasks as Array<{
            title: string;
            tags: string[];
            latestRunStatus?: string;
            latestRunSummary?: string;
            recentRuns?: Array<{ status: string; summary: string }>;
        }>;
        expect(tasks.length).toBe(2);
        expect(tasks.some((task) => task.title === 'Prepare brief')).toBe(true);
        expect(tasks.some((task) => task.title === 'Hourly AI digest' && task.tags.includes('scheduled'))).toBe(true);
        expect(tasks.some((task) =>
            task.title === 'Hourly AI digest' &&
            task.latestRunStatus === 'completed' &&
            task.latestRunSummary === 'Digest generated successfully.'
        )).toBe(true);
        expect(tasks.some((task) =>
            task.title === 'Hourly AI digest' &&
            task.recentRuns?.length === 2 &&
            task.recentRuns[1]?.summary === 'Temporary upstream rate limit.'
        )).toBe(true);
    });

    test('get_tasks falls back to sidecar root storage when workspace-local task store is empty', async () => {
        const root = createTempRoot();
        const workspacePath = createWorkspace(root, 'workspace-b');
        process.chdir(root);

        await taskCreateTool.handler(
            {
                title: 'Stored in root by legacy path',
                description: 'Compatibility fallback case',
            },
            { workspacePath: root, taskId: 'root-task' }
        );

        await scheduledTaskCreateTool.handler(
            {
                title: 'Root scheduled task',
                taskQuery: 'Run from sidecar root fallback',
                scheduleType: 'interval',
                intervalMinutes: 30,
            },
            { workspacePath: root, taskId: 'root-scheduled-task' }
        );

        const result = handleGetTasks(
            {
                id: 'cmd-2',
                type: 'get_tasks',
                timestamp: new Date().toISOString(),
                payload: { workspacePath },
            } as any,
            {
                taskId: 'cmd-2',
                now: () => new Date().toISOString(),
                nextEventId: () => 'evt-2',
                nextSequence: () => 1,
            }
        );

        const tasks = result.response.payload.tasks as Array<{ title: string }>;
        expect(tasks.some((task) => task.title === 'Stored in root by legacy path')).toBe(true);
        expect(tasks.some((task) => task.title === 'Root scheduled task')).toBe(true);
    });
});
