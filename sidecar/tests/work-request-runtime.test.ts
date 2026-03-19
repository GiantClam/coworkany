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

    test('migrates legacy scheduled task presentation to full TTS on read', () => {
        const dir = makeTempDir();
        const scheduledTaskPath = path.join(dir, 'app-data', 'scheduled-tasks.json');
        fs.mkdirSync(path.dirname(scheduledTaskPath), { recursive: true });
        fs.writeFileSync(scheduledTaskPath, JSON.stringify([
            {
                id: 'legacy-task',
                title: 'legacy',
                taskQuery: 'legacy query',
                workspacePath: dir,
                createdAt: '2026-03-18T05:30:53.858Z',
                executeAt: '2026-03-18T05:31:53.812Z',
                status: 'scheduled',
                speakResult: true,
                frozenWorkRequest: {
                    schemaVersion: 1,
                    id: 'legacy-work-request',
                    frozenAt: '2026-03-18T05:30:53.831Z',
                    mode: 'scheduled_task',
                    sourceText: '1 分钟后，检索 Reddit 并播报给我',
                    workspacePath: dir,
                    schedule: {
                        executeAt: '2026-03-18T05:31:53.812Z',
                        timezone: 'Asia/Shanghai',
                        recurrence: null,
                    },
                    tasks: [],
                    clarification: {
                        required: false,
                        questions: [],
                        missingFields: [],
                        canDefault: true,
                        assumptions: [],
                    },
                    presentation: {
                        uiFormat: 'chat_message',
                        ttsEnabled: true,
                        ttsMode: 'summary',
                        ttsMaxChars: 500,
                        language: 'zh-CN',
                    },
                    createdAt: '2026-03-18T05:30:53.831Z',
                },
            },
        ], null, 2), 'utf-8');

        const scheduledTaskStore = new ScheduledTaskStore(scheduledTaskPath);
        const [migrated] = scheduledTaskStore.read();

        expect(migrated?.frozenWorkRequest?.presentation.ttsMode).toBe('full');
        expect(migrated?.frozenWorkRequest?.presentation.ttsMaxChars).toBe(0);

        const persisted = JSON.parse(fs.readFileSync(scheduledTaskPath, 'utf-8'));
        expect(persisted[0]?.frozenWorkRequest?.presentation?.ttsMode).toBe('full');
        expect(persisted[0]?.frozenWorkRequest?.presentation?.ttsMaxChars).toBe(0);
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

    test('injects deterministic local workflow guidance into the execution prompt', () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));

        const prepared = prepareWorkRequestContext({
            sourceText: '整理 Downloads 文件夹下的图片文件',
            workspacePath,
            workRequestStore: store,
        });

        expect(prepared.workRequestExecutionPrompt).toContain('Deterministic Local Workflow Guidance');
        expect(prepared.workRequestExecutionPrompt).toContain('organize-downloads-images');
        expect(prepared.workRequestExecutionPrompt).toContain('Required access: read, write, move');
        expect(prepared.workRequestExecutionPrompt).toContain('Traversal scope: top_level');
        expect(prepared.workRequestExecutionPrompt).toContain('Preferred tools: list_dir, create_directory, batch_move_files');
        expect(prepared.workRequestExecutionPrompt).toContain('batch_move_files');
    });
});
