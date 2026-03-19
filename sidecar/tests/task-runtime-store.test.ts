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
});
