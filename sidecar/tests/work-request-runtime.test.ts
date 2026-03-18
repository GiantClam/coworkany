import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkRequestStore } from '../src/orchestration/workRequestStore';
import {
    buildClarificationMessage,
    getScheduledTaskExecutionQuery,
    prepareWorkRequestContext,
} from '../src/orchestration/workRequestRuntime';
import { ScheduledTaskStore } from '../src/scheduling/scheduledTasks';

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-work-runtime-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('workRequestRuntime', () => {
    test('prepares persisted work request context and seeds planning files for complex tasks', () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));

        const prepared = prepareWorkRequestContext({
            sourceText: '帮我规划一个多步架构重构方案，包含任务拆分、测试和验收标准',
            workspacePath,
            workRequestStore: store,
        });

        const persisted = store.getById(prepared.frozenWorkRequest.id);
        expect(persisted?.id).toBe(prepared.frozenWorkRequest.id);
        expect(prepared.executionQuery).toContain('帮我规划一个多步架构重构方案');
        expect(prepared.preferredSkillIds).toContain('task-orchestrator');
        expect(prepared.preferredSkillIds).toContain('planning-with-files');
        expect(prepared.workRequestExecutionPrompt).toBeUndefined();
        expect(fs.existsSync(path.join(workspacePath, '.coworkany', 'task_plan.md'))).toBe(true);
        expect(fs.existsSync(path.join(workspacePath, '.coworkany', 'findings.md'))).toBe(true);
        expect(fs.existsSync(path.join(workspacePath, '.coworkany', 'progress.md'))).toBe(true);
    });

    test('resolves scheduled task execution query from linked frozen work request', () => {
        const dir = makeTempDir();
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));
        const scheduledTaskStore = new ScheduledTaskStore(path.join(dir, 'app-data', 'scheduled-tasks.json'));
        const prepared = prepareWorkRequestContext({
            sourceText: '20秒后，只回复：HELLO，并将结果用语音播报给我',
            workspacePath: dir,
            workRequestStore: store,
        });

        const record = scheduledTaskStore.create({
            title: prepared.frozenWorkRequest.tasks[0]?.title || 'Task',
            taskQuery: 'legacy raw query',
            workRequestId: prepared.frozenWorkRequest.id,
            workspacePath: dir,
            executeAt: new Date(prepared.frozenWorkRequest.schedule?.executeAt || new Date().toISOString()),
            speakResult: true,
        });

        expect(getScheduledTaskExecutionQuery({ record, workRequestStore: store })).toContain('只回复：HELLO');
    });

    test('formats clarification questions from frozen request state', () => {
        const dir = makeTempDir();
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));
        const prepared = prepareWorkRequestContext({
            sourceText: '继续处理这个',
            workspacePath: dir,
            workRequestStore: store,
        });

        expect(prepared.frozenWorkRequest.clarification.required).toBe(true);
        expect(buildClarificationMessage(prepared.frozenWorkRequest)).toContain('具体对象');
    });
});
