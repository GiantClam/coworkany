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
    });

    test('classifies complex non-scheduled input as immediate task with planning skills', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '帮我规划并拆分一个多步实现方案，包含架构、测试和验收标准',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('superpowers-workflow');
        expect(analyzed.tasks[0]?.preferredSkills).toContain('planning-with-files');
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

        const frozen = freezeWorkRequest(analyzed);
        const plan = buildExecutionPlan(frozen);
        expect(plan.workRequestId).toBe(frozen.id);
        expect(plan.steps.map((step) => step.kind)).toEqual([
            'analysis',
            'clarification',
            'execution',
            'reduction',
            'presentation',
        ]);
        expect(plan.steps[0]?.status).toBe('completed');
        expect(plan.steps[1]?.status).toBe('completed');
        expect(plan.steps[2]?.status).toBe('pending');
        expect(buildExecutionQuery(frozen)).toContain('验收标准');
    });

    test('marks ambiguous immediate follow-up requests for clarification before execution', () => {
        const analyzed = analyzeWorkRequest({
            sourceText: '继续处理这个',
            workspacePath: '/tmp/workspace',
        });

        expect(analyzed.mode).toBe('immediate_task');
        expect(analyzed.clarification.required).toBe(true);
        expect(analyzed.clarification.missingFields).toContain('task_scope');

        const frozen = freezeWorkRequest(analyzed);
        const plan = buildExecutionPlan(frozen);
        expect(plan.steps[1]?.kind).toBe('clarification');
        expect(plan.steps[1]?.status).toBe('blocked');
        expect(plan.steps[2]?.status).toBe('blocked');
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
