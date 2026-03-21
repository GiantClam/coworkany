import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    analyzeWorkRequest,
    buildExecutionPlan,
    buildExecutionQuery,
    freezeWorkRequest,
    reduceWorkResult,
} from '../src/orchestration/workRequestAnalyzer';
import { WorkRequestStore } from '../src/orchestration/workRequestStore';
import { ScheduledTaskStore } from '../src/scheduling/scheduledTasks';

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-control-plane-'));
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

describe('work request control plane', () => {
    test('classifies simple conversational input as chat', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: 'hi',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.mode).toBe('chat');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('task-orchestrator');
        expect(analyzed.tasks[0]?.preferredSkills).not.toContain('planning-with-files');
        expect(analyzed.deliverables?.[0]).toMatchObject({
            type: 'chat_reply',
            required: true,
        });
        expect(analyzed.defaultingPolicy?.uiFormat).toBe('chat_message');
    });

    test('classifies complex non-scheduled input as immediate task with planning skills', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '帮我规划并拆分一个多步实现方案，包含架构、测试和验收标准',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('superpowers-workflow');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('planning-with-files');
        expect(analyzed.checkpoints?.some((checkpoint) => checkpoint.kind === 'pre_delivery')).toBe(true);
        expect(analyzed.deliverables?.[0]?.type).toBe('report_file');
        expect(analyzed.goalFrame).toMatchObject({
            taskCategory: 'research',
        });
        expect(analyzed.researchQueries?.some((query) => query.kind === 'domain_research')).toBe(true);
        expect(analyzed.strategyOptions?.some((option) => option.selected)).toBe(true);
    });

    test('preserves explicit output paths for code file requests', () => {
        const targetPath = '/tmp/.coworkany/gui-test.js';
        const analyzed = analyzeWorkRequest({
            sourceText: `写一个简单的 Hello World 程序，保存到 ${targetPath}`,
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.deliverables).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'artifact_file',
                path: targetPath,
                format: 'js',
            }),
        ]));
        expect(analyzed.deliverables?.some((deliverable) =>
            typeof deliverable.path === 'string' && deliverable.path.endsWith('.md')
        )).toBe(false);
    });

    test('does not require task-scope clarification for explicit path corrections that include normal pronouns', () => {
        const originalPath = '/tmp/workspace/hello.js';
        const correctedPath = '/tmp/workspace/hello.ts';
        const analyzed = analyzeWorkRequest({
            sourceText: [
                `Original task: Write a simple Hello World program and save it to ${originalPath}`,
                `User correction: Actually, save it to ${correctedPath} instead.`,
            ].join('\n'),
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.clarification.required).toBe(false);
        expect(analyzed.clarification.missingFields).toEqual([]);
        expect(analyzed.deliverables).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'artifact_file',
                path: correctedPath,
                format: 'ts',
            }),
        ]));
    });

    test('tags marketplace skill install requests as coworkany self-management tasks', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '从 skillhub 中安装 skill-vetter',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('coworkany-self-management');
    });

    test('tags clawhub marketplace skill install requests as coworkany self-management tasks', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '从 clawhub 安装 claw-vetter',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('coworkany-self-management');
    });

    test('resolves downloads image organization requests into a host-folder local task plan', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '整理 Downloads 文件夹下的图片文件',
            workspacePath: '/tmp/workspace',
            systemContext: {
                homeDir: '/Users/tester',
                platform: 'darwin',
            },
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.tasks[0]?.preferredTools).toEqual([
            'list_dir',
            'create_directory',
            'batch_move_files',
        ]);
        expect(analyzed.tasks[0]?.preferredWorkflow).toBe('organize-downloads-images');
        expect(analyzed.tasks[0]?.resolvedTargets?.[0]).toMatchObject({
            kind: 'well_known_folder',
            folderId: 'downloads',
            sourcePhrase: 'Downloads',
            resolvedPath: '/Users/tester/Downloads',
            os: 'macos',
        });
        expect(analyzed.tasks[0]?.localPlanHint).toMatchObject({
            intent: 'organize_files',
            fileKinds: ['images'],
            traversalScope: 'top_level',
            preferredTools: ['list_dir', 'create_directory', 'batch_move_files'],
            requiredAccess: ['read', 'write', 'move'],
            requiresHostAccessGrant: true,
        });
        expect(analyzed.goalFrame?.taskCategory).toBe('workspace');
        expect(analyzed.runtimeIsolationPolicy).toMatchObject({
            connectorIsolationMode: 'deny_by_default',
            filesystemMode: 'workspace_plus_resolved_targets',
            allowedWorkspacePaths: expect.arrayContaining(['/tmp/workspace', '/Users/tester/Downloads']),
            writableWorkspacePaths: expect.arrayContaining(['/tmp/workspace', '/Users/tester/Downloads']),
            networkAccess: 'none',
        });
        expect(analyzed.researchQueries?.some((query) => query.kind === 'feasibility_research')).toBe(true);
        expect(analyzed.uncertaintyRegistry?.some((item) => item.topic === 'execution_target' && item.status === 'confirmed')).toBe(true);
    });

    test('resolves Chinese system folder phrases without requiring an absolute path', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '查看下载文件夹里的图片',
            workspacePath: '/tmp/workspace',
            systemContext: {
                homeDir: '/home/tester',
                platform: 'linux',
            },
        });

        expect(analyzed.tasks[0]?.resolvedTargets?.[0]).toMatchObject({
            folderId: 'downloads',
            resolvedPath: '/home/tester/Downloads',
            os: 'linux',
        });
        expect(analyzed.tasks[0]?.localPlanHint?.intent).toBe('inspect_folder');
        expect(analyzed.tasks[0]?.preferredTools).toEqual(['list_dir']);
    });

    test('resolves downloads image deduplication requests into a deterministic hash-based workflow', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '给 Downloads 文件夹下的图片去重',
            workspacePath: '/tmp/workspace',
            systemContext: {
                homeDir: '/Users/tester',
                platform: 'darwin',
            },
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.tasks[0]?.preferredTools).toEqual([
            'list_dir',
            'compute_file_hash',
            'create_directory',
            'batch_move_files',
        ]);
        expect(analyzed.tasks[0]?.preferredWorkflow).toBe('deduplicate-downloads-images');
        expect(analyzed.tasks[0]?.localPlanHint).toMatchObject({
            intent: 'deduplicate_files',
            fileKinds: ['images'],
            traversalScope: 'top_level',
            preferredTools: ['list_dir', 'compute_file_hash', 'create_directory', 'batch_move_files'],
            requiredAccess: ['read', 'write', 'move'],
            requiresHostAccessGrant: true,
        });
    });

    test('resolves host-folder delete requests into structured delete tools', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '删除 Downloads 文件夹下的图片文件',
            workspacePath: '/tmp/workspace',
            systemContext: {
                homeDir: '/Users/tester',
                platform: 'darwin',
            },
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.tasks[0]?.preferredTools).toEqual([
            'list_dir',
            'delete_path',
            'batch_delete_paths',
        ]);
        expect(analyzed.tasks[0]?.preferredWorkflow).toBe('delete-host-folder-files');
        expect(analyzed.tasks[0]?.localPlanHint).toMatchObject({
            intent: 'delete_files',
            fileKinds: ['images'],
            traversalScope: 'top_level',
            preferredTools: ['list_dir', 'delete_path', 'batch_delete_paths'],
            requiredAccess: ['read', 'delete'],
            requiresHostAccessGrant: true,
        });
    });

    test('resolves explicit absolute paths into generic host-folder workflows', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '整理 /Users/tester/Pictures/Inbox 里的图片文件',
            workspacePath: '/tmp/workspace',
            systemContext: {
                homeDir: '/Users/tester',
                platform: 'darwin',
            },
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.tasks[0]?.preferredWorkflow).toBe('organize-host-folder-files');
        expect(analyzed.tasks[0]?.resolvedTargets?.[0]).toMatchObject({
            kind: 'explicit_path',
            sourcePhrase: '/Users/tester/Pictures/Inbox',
            resolvedPath: '/Users/tester/Pictures/Inbox',
            os: 'macos',
        });
        expect(analyzed.tasks[0]?.localPlanHint).toMatchObject({
            intent: 'organize_files',
            fileKinds: ['images'],
            traversalScope: 'top_level',
            preferredTools: ['list_dir', 'create_directory', 'batch_move_files'],
            requiresHostAccessGrant: true,
        });
    });

    test('resolves explicit absolute paths for document organization into generic workflows', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '整理 /Users/tester/Documents/Inbox 里的 PDF 文档',
            workspacePath: '/tmp/workspace',
            systemContext: {
                homeDir: '/Users/tester',
                platform: 'darwin',
            },
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.tasks[0]?.preferredWorkflow).toBe('organize-host-folder-files');
        expect(analyzed.tasks[0]?.resolvedTargets?.[0]).toMatchObject({
            kind: 'explicit_path',
            sourcePhrase: '/Users/tester/Documents/Inbox',
            resolvedPath: '/Users/tester/Documents/Inbox',
            os: 'macos',
        });
        expect(analyzed.tasks[0]?.localPlanHint).toMatchObject({
            intent: 'organize_files',
            fileKinds: ['documents'],
            traversalScope: 'top_level',
            preferredTools: ['list_dir', 'create_directory', 'batch_move_files'],
            requiresHostAccessGrant: true,
        });
    });

    test('detects recursive traversal scope for explicit-path document organization', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '递归整理 /Users/tester/Documents/Inbox 里的 PDF 文档和所有子文件夹',
            workspacePath: '/tmp/workspace',
            systemContext: {
                homeDir: '/Users/tester',
                platform: 'darwin',
            },
        });

        expect(analyzed.tasks[0]?.localPlanHint).toMatchObject({
            intent: 'organize_files',
            fileKinds: ['documents'],
            traversalScope: 'recursive',
            requiresHostAccessGrant: true,
        });
    });

    test('analyzes and freezes scheduled requests before execution', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '20秒后，整理 3 篇 Reddit 内容，并将结果用语音播报给我。每篇只保留标题和一句启发。',
            workspacePath: '/tmp/workspace',
            now: new Date('2026-03-18T09:25:00+08:00'),
        });

        expect(analyzed.mode).toBe('scheduled_task');
        expect(analyzed.schedule?.executeAt).toBeTruthy();
        expect(analyzed.presentation.ttsEnabled).toBe(true);
        expect(analyzed.tasks[0]?.objective).toBe('整理 3 篇 Reddit 内容');
        expect(analyzed.tasks[0]?.constraints).toContain('每篇只保留标题和一句启发');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('task-orchestrator');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('superpowers-workflow');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('planning-with-files');
        expect(analyzed.deliverables?.[0]?.type).toBe('chat_reply');
        expect(analyzed.resumeStrategy).toMatchObject({
            mode: 'continue_from_saved_context',
            preserveDeliverables: true,
        });

        const frozen = freezeWorkRequest(analyzed);
        const plan = buildExecutionPlan(frozen);
        expect(plan.workRequestId).toBe(frozen.id);
        expect(plan.steps.map((step) => step.kind)).toEqual([
            'goal_framing',
            'research',
            'uncertainty_resolution',
            'contract_freeze',
            'execution',
            'reduction',
            'presentation',
        ]);
        expect(plan.steps[0]?.status).toBe('completed');
        expect(plan.steps[1]?.status).toBe('completed');
        expect(plan.steps[2]?.status).toBe('completed');
        expect(plan.steps[3]?.status).toBe('completed');
        expect(plan.steps[4]?.status).toBe('pending');
        expect(frozen.frozenResearchSummary?.selectedStrategyTitle).toBeTruthy();
        expect(buildExecutionQuery(frozen)).toContain('验收标准');
    });

    test('treats 以后 phrasing as a scheduled request instead of an immediate task', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '1 分钟以后，查询 minimax 的股价，给出深度分析',
            workspacePath: '/tmp/workspace',
            now: new Date('2026-03-20T09:17:12+08:00'),
        });

        expect(analyzed.mode).toBe('scheduled_task');
        expect(analyzed.schedule?.executeAt).toBe('2026-03-20T01:18:12.000Z');
        expect(analyzed.tasks[0]?.objective).toBe('查询 minimax 的股价，给出深度分析');
    });

    test('marks ambiguous immediate follow-up requests for clarification before execution', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '继续处理这个',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.clarification.required).toBe(true);
        expect(analyzed.clarification.missingFields).toContain('task_scope');
        expect(analyzed.missingInfo?.[0]).toMatchObject({
            field: 'task_scope',
            blocking: true,
        });
        expect(analyzed.userActionsRequired?.[0]).toMatchObject({
            kind: 'clarify_input',
            blocking: true,
        });

        const frozen = freezeWorkRequest(analyzed);
        const plan = buildExecutionPlan(frozen);
        expect(analyzed.uncertaintyRegistry?.some((item) => item.status === 'blocking_unknown')).toBe(true);
        expect(plan.steps[2]?.kind).toBe('uncertainty_resolution');
        expect(plan.steps[2]?.status).toBe('blocked');
        expect(plan.steps[3]?.status).toBe('blocked');
        expect(plan.steps[4]?.status).toBe('blocked');
    });

    test('plans artifact deliverables and checkpoints for report-like tasks', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '分析当前项目的长任务恢复设计，并输出一份总结报告',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.deliverables?.[0]).toMatchObject({
            type: 'report_file',
            path: expect.stringContaining('reports/'),
            format: 'md',
        });
        expect(analyzed.checkpoints?.some((checkpoint) => checkpoint.kind === 'pre_delivery')).toBe(true);
        expect(analyzed.defaultingPolicy?.artifactDirectory).toBe('reports');
        expect(analyzed.runtimeIsolationPolicy).toMatchObject({
            connectorIsolationMode: 'deny_by_default',
            filesystemMode: 'workspace_only',
            allowedWorkspacePaths: ['/tmp/workspace'],
            networkAccess: 'restricted',
        });
        expect(analyzed.researchQueries?.some((query) => query.source === 'workspace')).toBe(true);
        expect(analyzed.knownRisks?.some((risk) => risk.includes('Best-practice assumptions'))).toBe(true);
    });

    test('assigns a blocking high-risk HITL plan review for code-change tasks', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '修复当前项目里的登录 bug，并直接修改代码完成实现',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.hitlPolicy).toMatchObject({
            riskTier: 'high',
            requiresPlanConfirmation: true,
        });
        expect(analyzed.userActionsRequired?.some((action) => action.kind === 'confirm_plan' && action.blocking)).toBe(true);
        expect(analyzed.checkpoints?.some((checkpoint) => checkpoint.kind === 'review' && checkpoint.blocking)).toBe(true);
    });

    test('does not keep asking for plan confirmation after explicit user approval', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: [
                '原始任务：修复当前项目里的登录 bug，并直接修改代码完成实现',
                '用户补充：按这个方案继续执行',
            ].join('\n'),
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.hitlPolicy).toMatchObject({
            riskTier: 'high',
            requiresPlanConfirmation: false,
        });
        expect(analyzed.userActionsRequired?.some((action) => action.kind === 'confirm_plan')).toBe(false);
    });

    test('creates blocking user action requests for login-dependent tasks', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '登录 X 后查看时间线并整理一份总结报告',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.hitlPolicy).toMatchObject({
            riskTier: 'high',
            requiresPlanConfirmation: true,
        });
        expect(analyzed.userActionsRequired?.some((action) => action.kind === 'confirm_plan')).toBe(true);
        expect(analyzed.userActionsRequired?.some((action) => action.kind === 'external_auth')).toBe(true);
        expect(analyzed.checkpoints?.some((checkpoint) => checkpoint.kind === 'review' && checkpoint.blocking)).toBe(true);
        expect(analyzed.checkpoints?.some((checkpoint) => checkpoint.kind === 'manual_action' && checkpoint.blocking)).toBe(true);
        expect(analyzed.defaultingPolicy?.checkpointStrategy).toBe('manual_action');
        expect(analyzed.uncertaintyRegistry?.some((item) => item.topic === 'manual_prerequisite' && item.status === 'inferred')).toBe(true);
    });

    test('reduces raw execution output into separate ui and tts payloads', () => {
        const frozen = freezeWorkRequest(analyzeWorkRequest({
            sourceText: '整理 3 篇 Reddit 内容，并将结果用语音播报给我',
            workspacePath: '/tmp/workspace',
        }));

        const reduced = reduceWorkResult({
            canonicalResult: `好的，按你的要求整理了 3 篇：\n\n1. 标题：A\n2. 标题：B`,
            request: frozen,
        });

        expect(reduced.uiSummary).toContain('1. 标题：A');
        expect(reduced.uiSummary).not.toContain('好的');
        expect(reduced.ttsSummary).not.toContain('好的');
    });

    test('persists frozen work requests and links them from scheduled tasks', () => {
        const dir = makeTempDir();
        const workRequestPath = path.join(dir, 'work-requests.json');
        const scheduledTaskPath = path.join(dir, 'scheduled-tasks.json');
        const workRequestStore = new WorkRequestStore(workRequestPath);
        const scheduledTaskStore = new ScheduledTaskStore(scheduledTaskPath);

        const frozen = freezeWorkRequest(analyzeWorkRequest({
            sourceText: '20秒后，只回复：HELLO，并用语音播报给我',
            workspacePath: '/tmp/workspace',
            now: new Date('2026-03-18T09:10:00+08:00'),
        }));
        workRequestStore.create(frozen);

        const record = scheduledTaskStore.create({
            title: frozen.tasks[0]?.title || 'Task',
            taskQuery: buildExecutionQuery(frozen),
            workRequestId: frozen.id,
            frozenWorkRequest: frozen,
            executeAt: new Date(frozen.schedule?.executeAt || '2026-03-18T01:10:20.000Z'),
            workspacePath: frozen.workspacePath,
            speakResult: frozen.presentation.ttsEnabled,
        });

        const persisted = scheduledTaskStore.read()[0];
        expect(persisted?.workRequestId).toBe(frozen.id);
        expect(persisted?.frozenWorkRequest?.id).toBe(frozen.id);
        expect(record.taskQuery).toContain('只回复：HELLO');
    });
});
