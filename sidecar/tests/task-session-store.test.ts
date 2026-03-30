import { describe, expect, test } from 'bun:test';
import { TaskSessionStore } from '../src/runtime/taskSessionStore';

type Message = {
    role: 'user' | 'assistant';
    content: string;
};

describe('task session store', () => {
    test('initializes per-task lifecycle state with defaults', () => {
        const store = new TaskSessionStore<Message, { type: string }>({
            getDefaultHistoryLimit: () => 20,
        });

        expect(store.getConversation('task-1')).toEqual([]);
        expect(store.getHistoryLimit('task-1')).toBe(20);
        expect(Array.from(store.getArtifacts('task-1'))).toEqual([]);
        expect(store.getConfig('task-1')).toBeUndefined();
    });

    test('merges config, tracks resume queue, and replaces artifacts independently per task', () => {
        const store = new TaskSessionStore<Message, { type: string }>({
            getDefaultHistoryLimit: () => 12,
        });

        store.setConfig('task-1', { workspacePath: '/tmp/a', modelId: 'gpt-5' });
        store.mergeConfig('task-1', { maxHistoryMessages: 40 });
        store.setHistoryLimit('task-1', 40);
        store.setArtifactContract('task-1', { type: 'artifact-contract' });
        store.setArtifacts('task-1', ['/tmp/out.html']);
        store.enqueueResumeMessage('task-1', {
            content: 'continue after login',
            config: { enabledToolpacks: ['browser'] },
        });
        store.replaceConversation('task-1', [{ role: 'user', content: 'hello' }]);

        expect(store.getConfig('task-1')).toEqual({
            workspacePath: '/tmp/a',
            modelId: 'gpt-5',
            maxHistoryMessages: 40,
        });
        expect(store.getHistoryLimit('task-1')).toBe(40);
        expect(store.getArtifactContract('task-1')).toEqual({ type: 'artifact-contract' });
        expect(Array.from(store.getArtifacts('task-1'))).toEqual(['/tmp/out.html']);
        expect(store.dequeueResumeMessages('task-1')).toEqual([
            {
                content: 'continue after login',
                config: { enabledToolpacks: ['browser'] },
            },
        ]);
        expect(store.dequeueResumeMessages('task-1')).toEqual([]);
        expect(store.getConversation('task-1')).toEqual([{ role: 'user', content: 'hello' }]);
        expect(store.getConversation('task-2')).toEqual([]);
        expect(store.getHistoryLimit('task-2')).toBe(12);
    });
});
