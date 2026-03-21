import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskRuntimeStore } from '../src/execution/taskRuntimeStore';

describe('TaskRuntimeStore', () => {
    test('persists and reloads suspended runtime records', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-task-runtime-'));
        const filePath = path.join(root, 'task-runtime.json');

        const store = new TaskRuntimeStore(filePath);
        store.upsert({
            taskId: 'task-1',
            title: 'Long task',
            workspacePath: '/tmp/workspace',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'suspended',
            conversation: [{ role: 'user', content: 'hello' }],
            config: { modelId: 'gpt-4o' },
            historyLimit: 42,
            artifactContract: { type: 'artifact' },
            artifactsCreated: ['/tmp/out.md'],
            suspension: {
                reason: 'authentication_required',
                userMessage: 'Please log in',
                canAutoResume: true,
                maxWaitTimeMs: 300000,
            },
        });

        const reloaded = new TaskRuntimeStore(filePath).get('task-1');

        expect(reloaded?.status).toBe('suspended');
        expect(reloaded?.historyLimit).toBe(42);
        expect(reloaded?.config?.modelId).toBe('gpt-4o');
        expect(reloaded?.artifactsCreated).toEqual(['/tmp/out.md']);
        expect(reloaded?.suspension?.reason).toBe('authentication_required');

        fs.rmSync(root, { recursive: true, force: true });
    });

    test('persists and reloads interrupted runtime records', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-task-runtime-'));
        const filePath = path.join(root, 'task-runtime.json');

        const store = new TaskRuntimeStore(filePath);
        store.upsert({
            taskId: 'task-2',
            title: 'Interrupted task',
            workspacePath: '/tmp/workspace',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'interrupted',
            conversation: [{ role: 'assistant', content: 'partial progress' }],
            historyLimit: 25,
            artifactsCreated: ['/tmp/out.txt'],
        });

        const reloaded = new TaskRuntimeStore(filePath).get('task-2');

        expect(reloaded?.status).toBe('interrupted');
        expect(reloaded?.historyLimit).toBe(25);
        expect(reloaded?.artifactsCreated).toEqual(['/tmp/out.txt']);
        expect(reloaded?.conversation).toEqual([{ role: 'assistant', content: 'partial progress' }]);

        fs.rmSync(root, { recursive: true, force: true });
    });

    test('persists and reloads finished runtime records for post-restart follow-up context', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-task-runtime-'));
        const filePath = path.join(root, 'task-runtime.json');

        const store = new TaskRuntimeStore(filePath);
        store.upsert({
            taskId: 'task-3',
            title: 'Finished task',
            workspacePath: '/tmp/workspace',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'finished',
            conversation: [{ role: 'assistant', content: 'done' }],
            config: {
                workspacePath: '/tmp/workspace',
                lastFrozenWorkRequestSnapshot: {
                    mode: 'immediate_task',
                    sourceText: 'write report to /tmp/report.md',
                    primaryObjective: 'write report',
                    preferredWorkflows: [],
                    resolvedTargets: [],
                    deliverables: [{ type: 'report_file', path: '/tmp/report.md', format: 'md' }],
                },
            },
            historyLimit: 10,
            artifactsCreated: ['/tmp/report.md'],
        });

        const reloaded = new TaskRuntimeStore(filePath).get('task-3');

        expect(reloaded?.status).toBe('finished');
        expect(reloaded?.config?.lastFrozenWorkRequestSnapshot?.deliverables).toEqual([
            { type: 'report_file', path: '/tmp/report.md', format: 'md' },
        ]);
        expect(reloaded?.conversation).toEqual([{ role: 'assistant', content: 'done' }]);

        fs.rmSync(root, { recursive: true, force: true });
    });

    test('prunes only the oldest archived terminal records while preserving active ones', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-task-runtime-'));
        const filePath = path.join(root, 'task-runtime.json');
        const store = new TaskRuntimeStore(filePath);

        for (let index = 0; index < 105; index += 1) {
            store.upsert({
                taskId: `finished-${index}`,
                title: `Finished ${index}`,
                workspacePath: '/tmp/workspace',
                createdAt: new Date(2026, 2, 21, 0, 0, index).toISOString(),
                updatedAt: new Date(2026, 2, 21, 0, 1, index).toISOString(),
                status: 'finished',
                conversation: [],
                historyLimit: 20,
                artifactsCreated: [],
            });
        }

        store.upsert({
            taskId: 'suspended-keep',
            title: 'Suspended keep',
            workspacePath: '/tmp/workspace',
            createdAt: new Date(2026, 2, 21, 1, 0, 0).toISOString(),
            updatedAt: new Date(2026, 2, 21, 1, 0, 1).toISOString(),
            status: 'suspended',
            conversation: [],
            historyLimit: 20,
            artifactsCreated: [],
            suspension: {
                reason: 'auth',
                userMessage: 'Please log in',
                canAutoResume: false,
            },
        });

        const reloaded = new TaskRuntimeStore(filePath).list();
        const finishedIds = reloaded
            .filter((record) => record.status === 'finished')
            .map((record) => record.taskId)
            .sort();

        expect(finishedIds).toHaveLength(100);
        expect(finishedIds).not.toContain('finished-0');
        expect(finishedIds).not.toContain('finished-1');
        expect(finishedIds).not.toContain('finished-2');
        expect(finishedIds).not.toContain('finished-3');
        expect(finishedIds).not.toContain('finished-4');
        expect(finishedIds).toContain('finished-104');
        expect(reloaded.some((record) => record.taskId === 'suspended-keep')).toBe(true);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
