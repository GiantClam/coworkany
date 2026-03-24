import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkRequestStore } from '../src/orchestration/workRequestStore';
import {
    buildPlanUpdatedPayload,
    buildClarificationMessage,
    getScheduledTaskExecutionQuery,
    markWorkRequestExecutionResumed,
    markWorkRequestExecutionStarted,
    markWorkRequestExecutionSuspended,
    prepareExecutionContextFromFrozen,
    planNextScheduledExecutionStage,
    planScheduledExecutionStages,
    markWorkRequestPresentationStarted,
    markWorkRequestReductionStarted,
    prepareWorkRequestContext,
    refreezePreparedWorkRequestForResearch,
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
    test('prepares persisted work request context and seeds planning files for complex tasks', async () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));

        const prepared = await prepareWorkRequestContext({
            sourceText: '帮我规划一个多步架构重构方案，包含任务拆分、测试和验收标准',
            workspacePath,
            workRequestStore: store,
        });

        const persisted = store.getById(prepared.frozenWorkRequest.id);
        expect(persisted?.id).toBe(prepared.frozenWorkRequest.id);
        expect(prepared.executionQuery).toContain('帮我规划一个多步架构重构方案');
        expect(prepared.preferredSkillIds).toContain('task-orchestrator');
        expect(prepared.preferredSkillIds).toContain('planning-with-files');
        expect(prepared.workRequestExecutionPrompt).toContain('Coworkany is the primary task owner');
        expect(prepared.workRequestExecutionPrompt).toContain('Goal Frame');
        expect(prepared.workRequestExecutionPrompt).toContain('Research Summary');
        expect(prepared.workRequestExecutionPrompt).toContain('Planned Deliverables');
        expect(prepared.workRequestExecutionPrompt).toContain('Planned Checkpoints');
        expect(prepared.workRequestExecutionPrompt).toContain('Strategy Options');
        expect(prepared.frozenWorkRequest.goalFrame?.taskCategory).toBe('research');
        expect(prepared.frozenWorkRequest.researchQueries?.length).toBeGreaterThan(0);
        expect(prepared.frozenWorkRequest.researchQueries?.every((query) => query.status !== 'pending')).toBe(true);
        expect(prepared.frozenWorkRequest.frozenResearchSummary?.evidenceCount).toBeGreaterThan(0);
        expect(fs.existsSync(path.join(workspacePath, '.coworkany', 'task_plan.md'))).toBe(true);
        expect(fs.existsSync(path.join(workspacePath, '.coworkany', 'findings.md'))).toBe(true);
        expect(fs.existsSync(path.join(workspacePath, '.coworkany', 'progress.md'))).toBe(true);
    });

    test('resolves scheduled task execution query from linked frozen work request', async () => {
        const dir = makeTempDir();
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));
        const scheduledTaskStore = new ScheduledTaskStore(path.join(dir, 'app-data', 'scheduled-tasks.json'));
        const prepared = await prepareWorkRequestContext({
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

    test('strips synthesized deliverable/checkpoint clauses from scheduled execution query', async () => {
        const dir = makeTempDir();
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));
        const scheduledTaskStore = new ScheduledTaskStore(path.join(dir, 'app-data', 'scheduled-tasks.json'));
        const prepared = await prepareWorkRequestContext({
            sourceText: '1 分钟以后，检索特朗普和伊朗是否有沟通停战的可能性，将结果保存到文件中',
            workspacePath: dir,
            workRequestStore: store,
        });

        const record = scheduledTaskStore.create({
            title: prepared.frozenWorkRequest.tasks[0]?.title || 'Task',
            taskQuery: 'legacy raw query',
            workRequestId: prepared.frozenWorkRequest.id,
            workspacePath: dir,
            executeAt: new Date(prepared.frozenWorkRequest.schedule?.executeAt || new Date().toISOString()),
            speakResult: false,
        });

        const query = getScheduledTaskExecutionQuery({ record, workRequestStore: store });
        expect(query).toContain('将结果保存到文件中');
        expect(query).not.toContain('交付物：');
        expect(query).not.toContain('检查点：');
    });

    test('sanitizes legacy scheduled query fallback when no frozen work request is linked', () => {
        const dir = makeTempDir();
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));
        const scheduledTaskStore = new ScheduledTaskStore(path.join(dir, 'app-data', 'scheduled-tasks.json'));

        const record = scheduledTaskStore.create({
            title: 'legacy',
            taskQuery: [
                '检索特朗普和伊朗是否有沟通停战的可能性，将结果保存到文件中',
                '约束：优先复用上一阶段已产出的结果与文件，不要重复前一阶段工作。',
                '交付物：Planned output artifact (reports/1-x.md)',
                '检查点：Checkpoint before final delivery',
            ].join('\n'),
            workspacePath: dir,
            executeAt: new Date('2026-03-23T05:36:08.000Z'),
            speakResult: false,
        });

        const query = getScheduledTaskExecutionQuery({ record, workRequestStore: store });
        expect(query).toContain('将结果保存到文件中');
        expect(query).not.toContain('约束：');
        expect(query).not.toContain('交付物：');
        expect(query).not.toContain('检查点：');
    });

    test('prefers record taskQuery for scheduled_multi_task stage records', async () => {
        const dir = makeTempDir();
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));
        const scheduledTaskStore = new ScheduledTaskStore(path.join(dir, 'app-data', 'scheduled-tasks.json'));

        const record = scheduledTaskStore.create({
            title: '发布阶段',
            taskQuery: '发布到 X 并附上上一阶段文件摘要',
            workRequestId: 'wr-multi',
            workspacePath: dir,
            executeAt: new Date('2026-03-23T05:36:08.000Z'),
            speakResult: false,
            frozenWorkRequest: {
                schemaVersion: 1,
                id: 'wr-multi',
                frozenAt: '2026-03-23T05:34:08.000Z',
                mode: 'scheduled_multi_task',
                sourceText: '1 分钟后做 A，然后再等 1 分钟做 B',
                workspacePath: dir,
                schedule: {
                    executeAt: '2026-03-23T05:35:08.000Z',
                    timezone: 'Asia/Shanghai',
                    recurrence: null,
                    stages: [
                        {
                            taskId: 'task-1',
                            executeAt: '2026-03-23T05:35:08.000Z',
                        },
                        {
                            taskId: 'task-2',
                            executeAt: '2026-03-23T05:36:08.000Z',
                            delayMsFromPrevious: 60000,
                            originalTimeExpression: '1分钟',
                        },
                    ],
                },
                tasks: [
                    {
                        id: 'task-1',
                        title: 'A',
                        objective: '先做 A',
                        constraints: [],
                        acceptanceCriteria: [],
                        dependencies: [],
                        preferredSkills: [],
                        preferredTools: [],
                    },
                    {
                        id: 'task-2',
                        title: 'B',
                        objective: '再做 B',
                        constraints: [],
                        acceptanceCriteria: [],
                        dependencies: ['task-1'],
                        preferredSkills: [],
                        preferredTools: [],
                    },
                ],
                clarification: {
                    required: false,
                    questions: [],
                    missingFields: [],
                    canDefault: true,
                    assumptions: [],
                },
                presentation: {
                    uiFormat: 'chat_message',
                    ttsEnabled: false,
                    ttsMode: 'full',
                    ttsMaxChars: 0,
                    language: 'zh-CN',
                },
                createdAt: '2026-03-23T05:34:08.000Z',
            },
        });

        expect(getScheduledTaskExecutionQuery({ record, workRequestStore: store })).toBe('发布到 X 并附上上一阶段文件摘要');
    });

    test('derives execution-scoped context from frozen scheduled stage without re-scheduling', async () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));
        const prepared = await prepareWorkRequestContext({
            sourceText: '1分钟后，先把结论写入 reports/a.md。然后再等1分钟，把结果发布到 X 上',
            workspacePath,
            workRequestStore: store,
        });
        const frozen = prepared.frozenWorkRequest;
        const stage0TaskId = frozen.tasks[0]?.id;
        const stage1TaskId = frozen.tasks[1]?.id;
        expect(stage0TaskId).toBeTruthy();
        expect(stage1TaskId).toBeTruthy();

        const stage0Scoped = prepareExecutionContextFromFrozen({
            request: frozen,
            stageTaskId: stage0TaskId,
            stageIndex: 0,
        });
        expect(stage0Scoped.frozenWorkRequest.mode).toBe('scheduled_multi_task');
        expect(stage0Scoped.frozenWorkRequest.schedule).toBeUndefined();
        expect(stage0Scoped.frozenWorkRequest.sourceText).toBe(frozen.sourceText);
        expect(stage0Scoped.frozenWorkRequest.tasks).toHaveLength(1);
        expect(stage0Scoped.frozenWorkRequest.tasks[0]?.id).toBe(stage0TaskId);
        expect(stage0Scoped.frozenWorkRequest.deliverables?.length ?? 0).toBeGreaterThan(0);
        expect(stage0Scoped.frozenWorkRequest.userActionsRequired ?? []).toHaveLength(0);
        expect(stage0Scoped.frozenWorkRequest.checkpoints ?? []).toHaveLength(0);

        const stage1Scoped = prepareExecutionContextFromFrozen({
            request: frozen,
            stageTaskId: stage1TaskId,
            stageIndex: 1,
        });
        expect(stage1Scoped.frozenWorkRequest.mode).toBe('scheduled_multi_task');
        expect(stage1Scoped.frozenWorkRequest.schedule).toBeUndefined();
        expect(stage1Scoped.frozenWorkRequest.sourceText).toBe(frozen.sourceText);
        expect(stage1Scoped.frozenWorkRequest.tasks).toHaveLength(1);
        expect(stage1Scoped.frozenWorkRequest.tasks[0]?.id).toBe(stage1TaskId);
        expect(stage1Scoped.frozenWorkRequest.deliverables ?? []).toHaveLength(0);
        expect(stage1Scoped.frozenWorkRequest.userActionsRequired ?? []).toHaveLength(0);
        expect(stage1Scoped.frozenWorkRequest.checkpoints ?? []).toHaveLength(0);
        expect(stage1Scoped.frozenWorkRequest.hitlPolicy?.requiresPlanConfirmation).toBe(false);
        expect(stage1Scoped.frozenWorkRequest.uncertaintyRegistry?.some((item) => item.status === 'blocking_unknown')).toBe(false);
        expect(stage1Scoped.frozenWorkRequest.frozenResearchSummary?.blockingUnknownCount ?? 0).toBe(0);
        expect(stage1Scoped.executionQuery).toContain('发布到 X');
        expect(stage1Scoped.executionQuery).not.toContain('写入 reports/a.md');
        expect(stage1Scoped.workRequestExecutionPrompt).toContain('Frozen Work Request');
        expect(stage1Scoped.workRequestExecutionPrompt).toContain('Coworkany is the primary task owner');
    });

    test('plans only the first stage for sequential scheduled multi-task execution', () => {
        const request = {
            tasks: [
                {
                    id: 'task-1',
                    title: '阶段 1',
                    objective: '先做 A',
                    constraints: [],
                    acceptanceCriteria: [],
                    dependencies: [],
                    preferredSkills: [],
                    preferredTools: [],
                },
                {
                    id: 'task-2',
                    title: '阶段 2',
                    objective: '再做 B',
                    constraints: [],
                    acceptanceCriteria: [],
                    dependencies: ['task-1'],
                    preferredSkills: [],
                    preferredTools: [],
                },
            ],
            schedule: {
                executeAt: '2026-03-23T05:35:08.000Z',
                timezone: 'Asia/Shanghai',
                recurrence: null,
                stages: [
                    {
                        taskId: 'task-1',
                        executeAt: '2026-03-23T05:35:08.000Z',
                    },
                    {
                        taskId: 'task-2',
                        executeAt: '2026-03-23T05:36:08.000Z',
                        delayMsFromPrevious: 60_000,
                        originalTimeExpression: '1分钟',
                    },
                ],
            },
            deliverables: [],
            checkpoints: [],
        } as any;

        const plans = planScheduledExecutionStages({
            request,
            fallbackTitle: 'Scheduled Task',
            fallbackQuery: 'fallback',
        });

        expect(plans).toHaveLength(1);
        expect(plans[0]).toMatchObject({
            taskId: 'task-1',
            taskQuery: '先做 A',
            stageIndex: 0,
            totalStages: 2,
            executionMode: 'sequential',
        });
    });

    test('plans next sequential stage relative to completion time without mutating stage task query', () => {
        const request = {
            tasks: [
                {
                    id: 'task-1',
                    title: '阶段 1',
                    objective: '先做 A',
                    constraints: [],
                    acceptanceCriteria: [],
                    dependencies: [],
                    preferredSkills: [],
                    preferredTools: [],
                },
                {
                    id: 'task-2',
                    title: '阶段 2',
                    objective: '再做 B',
                    constraints: [],
                    acceptanceCriteria: [],
                    dependencies: ['task-1'],
                    preferredSkills: [],
                    preferredTools: [],
                },
            ],
            schedule: {
                executeAt: '2026-03-23T05:35:08.000Z',
                timezone: 'Asia/Shanghai',
                recurrence: null,
                stages: [
                    {
                        taskId: 'task-1',
                        executeAt: '2026-03-23T05:35:08.000Z',
                    },
                    {
                        taskId: 'task-2',
                        executeAt: '2026-03-23T05:36:08.000Z',
                        delayMsFromPrevious: 60_000,
                        originalTimeExpression: '1分钟',
                    },
                ],
            },
            deliverables: [],
            checkpoints: [],
        } as any;

        const nextStage = planNextScheduledExecutionStage({
            request,
            fallbackTitle: 'Scheduled Task',
            fallbackQuery: 'fallback',
            completedAt: new Date('2026-03-23T05:40:00.000Z'),
            completedStageIndex: 0,
            completedStageTaskId: 'task-1',
        });

        expect(nextStage).not.toBeNull();
        expect(nextStage?.stageIndex).toBe(1);
        expect(nextStage?.executionMode).toBe('sequential');
        expect(nextStage?.executeAt).toBe('2026-03-23T05:41:00.000Z');
        expect(nextStage?.taskQuery).toBe('再做 B');
    });

    test('falls back to original stage gap when delayMsFromPrevious is missing', () => {
        const request = {
            tasks: [
                {
                    id: 'task-1',
                    title: '阶段 1',
                    objective: '先做 A',
                    constraints: [],
                    acceptanceCriteria: [],
                    dependencies: [],
                    preferredSkills: [],
                    preferredTools: [],
                },
                {
                    id: 'task-2',
                    title: '阶段 2',
                    objective: '再做 B',
                    constraints: [],
                    acceptanceCriteria: [],
                    dependencies: ['task-1'],
                    preferredSkills: [],
                    preferredTools: [],
                },
            ],
            schedule: {
                executeAt: '2026-03-23T05:35:08.000Z',
                timezone: 'Asia/Shanghai',
                recurrence: null,
                stages: [
                    {
                        taskId: 'task-1',
                        executeAt: '2026-03-23T05:35:08.000Z',
                    },
                    {
                        taskId: 'task-2',
                        executeAt: '2026-03-23T05:37:08.000Z',
                        originalTimeExpression: '2分钟',
                    },
                ],
            },
            deliverables: [],
            checkpoints: [],
        } as any;

        const nextStage = planNextScheduledExecutionStage({
            request,
            fallbackTitle: 'Scheduled Task',
            fallbackQuery: 'fallback',
            completedAt: new Date('2026-03-23T05:40:00.000Z'),
            completedStageIndex: 0,
            completedStageTaskId: 'task-1',
        });

        expect(nextStage).not.toBeNull();
        expect(nextStage?.executeAt).toBe('2026-03-23T05:42:00.000Z');
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

    test('formats clarification questions from frozen request state', async () => {
        const dir = makeTempDir();
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));
        const prepared = await prepareWorkRequestContext({
            sourceText: '继续处理这个',
            workspacePath: dir,
            workRequestStore: store,
        });

        expect(prepared.frozenWorkRequest.clarification.required).toBe(true);
        expect(buildClarificationMessage(prepared.frozenWorkRequest)).toContain('具体对象');
    });

    test('injects deterministic local workflow guidance into the execution prompt', async () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));

        const prepared = await prepareWorkRequestContext({
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

    test('includes user-action requirements in the execution prompt for manual tasks', async () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));

        const prepared = await prepareWorkRequestContext({
            sourceText: '登录 X 后查看时间线并整理一份总结报告',
            workspacePath,
            workRequestStore: store,
            researchResolvers: {
                connectedAppStatus: async () => ({
                    success: true,
                    summary: 'Connected-app adapter: X login state checked',
                    connectedApps: ['browser:x-auth'],
                }),
            },
        });

        expect(prepared.workRequestExecutionPrompt).toContain('User Actions Required');
        expect(prepared.workRequestExecutionPrompt).toContain('Complete required manual action');
        expect(prepared.workRequestExecutionPrompt).toContain('Coworkany leads the task');
        expect(prepared.workRequestExecutionPrompt).toContain('Known Risks');
        expect(prepared.workRequestExecutionPrompt).toContain('Re-Planning Rules');
    });

    test('runs web and connected-app research resolvers before freezing the contract', async () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));

        const prepared = await prepareWorkRequestContext({
            sourceText: '研究当前项目的日历集成最佳实践，并检查浏览器登录相关可行性',
            workspacePath,
            workRequestStore: store,
            researchResolvers: {
                webSearch: async (query) => ({
                    success: true,
                    summary: `Web adapter searched: ${query}`,
                    resultCount: 3,
                    provider: 'stub',
                }),
                connectedAppStatus: async () => ({
                    success: true,
                    summary: 'Connected-app adapter: calendar configured; browser smart mode available',
                    connectedApps: ['calendar:google', 'browser:smart_mode'],
                }),
            },
        });

        const webQuery = prepared.frozenWorkRequest.researchQueries?.find((query) => query.source === 'web');
        const appQuery = prepared.frozenWorkRequest.researchQueries?.find((query) => query.source === 'connected_app');
        expect(webQuery?.status).toBe('completed');
        expect(appQuery?.status).toBe('completed');
        expect(prepared.frozenWorkRequest.researchEvidence?.some((item) => item.summary.includes('Web adapter searched'))).toBe(true);
        expect(prepared.frozenWorkRequest.researchEvidence?.some((item) => item.summary.includes('Connected-app adapter'))).toBe(true);
        expect(prepared.frozenWorkRequest.frozenResearchSummary?.sourcesChecked).toContain('web');
        expect(prepared.frozenWorkRequest.frozenResearchSummary?.sourcesChecked).toContain('connected_app');
    });

    test('times out required web research and freezes with blocking unknowns', async () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));
        const startedAt = Date.now();

        const prepared = await prepareWorkRequestContext({
            sourceText: '研究当前项目的日历集成最佳实践，并检查浏览器登录相关可行性',
            workspacePath,
            workRequestStore: store,
            researchResolvers: {
                webSearch: async () => await new Promise(() => {}),
                connectedAppStatus: async () => ({
                    success: true,
                    summary: 'Connected-app adapter: browser smart mode unavailable but checked',
                    connectedApps: [],
                }),
            },
            researchOptions: {
                webSearchTimeoutMs: 20,
            },
        });

        const durationMs = Date.now() - startedAt;
        const webQuery = prepared.frozenWorkRequest.researchQueries?.find((query) => query.source === 'web');
        expect(durationMs).toBeLessThan(500);
        expect(webQuery?.status).toBe('failed');
        expect(prepared.frozenWorkRequest.knownRisks?.some((risk) => risk.includes('Web research failed'))).toBe(true);
        expect(prepared.frozenWorkRequest.knownRisks?.some((risk) =>
            risk.includes('Required pre-freeze research is incomplete')
        )).toBe(true);
        expect(prepared.frozenWorkRequest.uncertaintyRegistry?.some((item) =>
            item.status === 'blocking_unknown' && item.topic.startsWith('required_research:')
        )).toBe(true);
        expect(prepared.frozenWorkRequest.frozenResearchSummary?.blockingUnknownCount).toBeGreaterThan(0);
        expect(prepared.executionPlan.steps.some((step) =>
            step.kind === 'execution' && step.status === 'blocked'
        )).toBe(true);
        expect(prepared.frozenWorkRequest.frozenResearchSummary?.evidenceCount).toBeGreaterThan(0);
    });

    test('refreezes a prepared work request after reopen while preserving the work request id', async () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));

        const prepared = await prepareWorkRequestContext({
            sourceText: '研究当前项目的日历集成最佳实践，并检查浏览器登录相关可行性',
            workspacePath,
            workRequestStore: store,
            researchResolvers: {
                webSearch: async (query) => ({
                    success: true,
                    summary: `Web adapter searched: ${query}`,
                    resultCount: 3,
                    provider: 'stub',
                }),
                connectedAppStatus: async () => ({
                    success: true,
                    summary: 'Connected-app adapter: calendar configured; browser smart mode available',
                    connectedApps: ['calendar:google', 'browser:smart_mode'],
                }),
            },
        });

        const originalId = prepared.frozenWorkRequest.id;
        const originalEvidenceCount = prepared.frozenWorkRequest.frozenResearchSummary?.evidenceCount ?? 0;

        const refrozen = await refreezePreparedWorkRequestForResearch({
            prepared,
            reason: 'Artifact contract unmet: expected pptx output (generated markdown only)',
            trigger: 'execution_infeasible',
            workRequestStore: store,
            researchResolvers: {
                webSearch: async (query) => ({
                    success: true,
                    summary: `Web adapter searched: ${query}`,
                    resultCount: 3,
                    provider: 'stub',
                }),
                connectedAppStatus: async () => ({
                    success: true,
                    summary: 'Connected-app adapter: calendar configured; browser smart mode available',
                    connectedApps: ['calendar:google', 'browser:smart_mode'],
                }),
            },
        });

        expect(refrozen.frozenWorkRequest.id).toBe(originalId);
        expect(refrozen.frozenWorkRequest.frozenResearchSummary?.evidenceCount).toBeGreaterThan(originalEvidenceCount);
        expect(refrozen.frozenWorkRequest.researchQueries?.every((query) => query.status !== 'pending')).toBe(true);
        expect(refrozen.frozenWorkRequest.researchEvidence?.some((item) =>
            item.summary.includes('Execution-time evidence triggered contract reopen')
        )).toBe(true);
        expect(store.getById(originalId)?.frozenResearchSummary?.evidenceCount).toBe(
            refrozen.frozenWorkRequest.frozenResearchSummary?.evidenceCount
        );
    });

    test('updates plan step status as execution moves through suspend, resume, reduction, and presentation', async () => {
        const dir = makeTempDir();
        const workspacePath = path.join(dir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const store = new WorkRequestStore(path.join(dir, 'app-data', 'work-requests.json'));

        const prepared = await prepareWorkRequestContext({
            sourceText: '登录 X 后查看时间线并整理一份总结报告',
            workspacePath,
            workRequestStore: store,
            researchResolvers: {
                connectedAppStatus: async () => ({
                    success: true,
                    summary: 'Connected-app adapter: X login status checked',
                    connectedApps: ['browser:x-auth'],
                }),
            },
        });

        expect(buildPlanUpdatedPayload(prepared).summary).toContain('Queued');
        expect(buildPlanUpdatedPayload(prepared).steps[0]?.description).toContain('goal frame');
        markWorkRequestExecutionStarted(prepared);
        expect(buildPlanUpdatedPayload(prepared).steps.some((step) => step.status === 'in_progress')).toBe(true);

        markWorkRequestExecutionSuspended(prepared, 'authentication_required');
        expect(buildPlanUpdatedPayload(prepared).summary).toContain('Blocked');

        markWorkRequestExecutionResumed(prepared, 'user_logged_in');
        expect(buildPlanUpdatedPayload(prepared).summary).toContain('In progress');

        markWorkRequestReductionStarted(prepared);
        expect(
            buildPlanUpdatedPayload(prepared).steps.some((step) => step.description.includes('Condense raw execution output') && step.status === 'in_progress')
        ).toBe(true);

        markWorkRequestPresentationStarted(prepared);
        expect(
            buildPlanUpdatedPayload(prepared).steps.some((step) => step.description.includes('Present the reduced result') && step.status === 'in_progress')
        ).toBe(true);
    });
});
