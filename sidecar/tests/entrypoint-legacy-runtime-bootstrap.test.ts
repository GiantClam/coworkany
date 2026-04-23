import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createLegacyRuntimeBootstrapHydrator } from '../src/mastra/entrypointLegacyRuntimeBootstrap';
import type { TaskRuntimeState } from '../src/mastra/taskRuntimeState';

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function getString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

let tempDirInTest: string | null = null;

afterEach(() => {
    if (tempDirInTest && fs.existsSync(tempDirInTest)) {
        fs.rmSync(tempDirInTest, { recursive: true, force: true });
    }
    tempDirInTest = null;
});

describe('entrypointLegacyRuntimeBootstrap', () => {
    test('hydrates legacy runtime records, normalizes deliverables, and rewrites file', () => {
        tempDirInTest = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-legacy-bootstrap-'));
        const legacyRuntimePath = path.join(tempDirInTest, 'task-runtime.json');
        fs.writeFileSync(
            legacyRuntimePath,
            JSON.stringify([
                {
                    taskId: 'task-legacy-1',
                    title: 'Legacy Task',
                    workspacePath: '/tmp/legacy-workspace',
                    createdAt: '2026-04-20T00:00:00.000Z',
                    status: 'running',
                    config: {
                        lastFrozenWorkRequestSnapshot: {
                            primaryObjective: 'prepare legacy output',
                            deliverables: [
                                { path: 'reports/reports/final.md' },
                            ],
                        },
                    },
                    artifactContract: {
                        sourceQuery: 'legacy-query',
                        pathTargets: ['reports/reports/final.md'],
                    },
                    conversation: [
                        { role: 'assistant', content: 'working...' },
                        { role: 'user', content: '请继续' },
                    ],
                },
            ]),
            'utf-8',
        );

        const upsertCalls: Array<{ taskId: string; patch: Partial<TaskRuntimeState> }> = [];
        const deliverablesByTaskId = new Map<string, string[]>();
        const hydrate = createLegacyRuntimeBootstrapHydrator({
            getString,
            toRecord,
            getNowIso: () => '2026-04-23T00:00:00.000Z',
            resolveTaskResourceId: (taskId) => `resource:${taskId}`,
            upsertTaskState: (taskId, patch) => {
                upsertCalls.push({ taskId, patch });
                return {
                    taskId,
                    conversationThreadId: taskId,
                    title: patch.title ?? 'Task',
                    workspacePath: patch.workspacePath ?? '/tmp',
                    createdAt: patch.createdAt ?? '2026-04-23T00:00:00.000Z',
                    status: patch.status ?? 'idle',
                    resourceId: patch.resourceId ?? `resource:${taskId}`,
                };
            },
            setLegacyDeliverables: (taskId, deliverables) => {
                deliverablesByTaskId.set(taskId, deliverables);
            },
            sanitizeLegacyPlannedOutputPath: (value) => value.replace('reports/reports', 'reports'),
            buildLegacyPlannedArtifactContract: (sourceQuery, paths) => ({
                sourceQuery,
                pathTargets: paths,
            }),
            extractLegacyPathTargetsFromArtifactContract: (contract) => {
                const pathTargets = contract.pathTargets;
                return Array.isArray(pathTargets)
                    ? pathTargets.filter((item): item is string => typeof item === 'string')
                    : [];
            },
            buildTaskTurnContract: ({ message, workspacePath, createdAt }) => ({
                hash: `hash:${message}`,
                mode: 'task',
                domain: 'general',
                route: 'direct',
                messageFingerprint: `${workspacePath}:${message}`,
                requiredCapabilities: [],
                createdAt,
            }),
            getDefaultWorkspacePath: () => '/tmp/default-workspace',
        });

        hydrate({ appDataDir: tempDirInTest });

        expect(deliverablesByTaskId.get('task-legacy-1')).toEqual(['reports/final.md']);
        expect(upsertCalls).toHaveLength(1);
        expect(upsertCalls[0]?.taskId).toBe('task-legacy-1');
        expect(upsertCalls[0]?.patch.status).toBe('running');
        expect(upsertCalls[0]?.patch.lastUserMessage).toBe('请继续');
        expect(upsertCalls[0]?.patch.resourceId).toBe('resource:task-legacy-1');
        expect(upsertCalls[0]?.patch.executionPath).toBe('direct');
        expect(upsertCalls[0]?.patch.turnContract).toBeDefined();

        const rewritten = JSON.parse(fs.readFileSync(legacyRuntimePath, 'utf-8')) as Array<Record<string, unknown>>;
        const first = rewritten[0] ?? {};
        const deliverables = toRecord(toRecord(toRecord(first.config).lastFrozenWorkRequestSnapshot).deliverables?.[0]);
        expect(deliverables.path).toBe('reports/final.md');
        const artifactContract = toRecord(first.artifactContract);
        expect(artifactContract.pathTargets).toEqual(['reports/final.md']);
    });

    test('returns early when appDataDir is missing', () => {
        const upsertCalls: Array<{ taskId: string; patch: Partial<TaskRuntimeState> }> = [];
        const hydrate = createLegacyRuntimeBootstrapHydrator({
            getString,
            toRecord,
            getNowIso: () => '2026-04-23T00:00:00.000Z',
            resolveTaskResourceId: (taskId) => `resource:${taskId}`,
            upsertTaskState: (taskId, patch) => {
                upsertCalls.push({ taskId, patch });
                return {
                    taskId,
                    conversationThreadId: taskId,
                    title: 'Task',
                    workspacePath: '/tmp',
                    createdAt: '2026-04-23T00:00:00.000Z',
                    status: 'idle',
                    resourceId: `resource:${taskId}`,
                };
            },
            setLegacyDeliverables: () => undefined,
            sanitizeLegacyPlannedOutputPath: (value) => value,
            buildLegacyPlannedArtifactContract: () => ({}),
            extractLegacyPathTargetsFromArtifactContract: () => [],
            buildTaskTurnContract: ({ message, createdAt }) => ({
                hash: `hash:${message}`,
                mode: 'task',
                domain: 'general',
                route: 'direct',
                messageFingerprint: message,
                requiredCapabilities: [],
                createdAt,
            }),
        });

        hydrate({});
        expect(upsertCalls).toHaveLength(0);
    });
});
