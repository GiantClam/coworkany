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

    test('times out slow web research and still freezes the contract', async () => {
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
