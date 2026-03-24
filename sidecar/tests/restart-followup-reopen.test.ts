import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    buildBootstrapRuntimeContextCommand,
    buildSendTaskMessageCommand,
    EventCollector,
    SidecarProcess,
} from './helpers/sidecar-harness';

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-restart-followup-'));
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

async function waitForEventType(
    collector: EventCollector,
    type: string,
    matcher?: (payload: Record<string, unknown>) => boolean,
    timeoutMs: number = 30000
): Promise<any | undefined> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const match = collector.events.find((event) =>
            event.type === type && (!matcher || matcher(event.payload))
        );
        if (match) {
            return match;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return undefined;
}

describe('sidecar restart follow-up reopen', () => {
    test('sanitizes restored artifact contract from frozen snapshot during bootstrap', async () => {
        const appDataDir = makeTempDir();
        const workspacePath = path.join(appDataDir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const runtimePath = path.join(appDataDir, 'task-runtime.json');
        const taskId = randomUUID();
        const plannedPath = path.join(workspacePath, 'restored.md');

        fs.writeFileSync(runtimePath, JSON.stringify([
            {
                taskId,
                title: 'Restored finished task',
                workspacePath,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: 'finished',
                conversation: [
                    { role: 'user', content: `写一个总结并保存到 ${plannedPath}` },
                    { role: 'assistant', content: '已完成。' },
                ],
                config: {
                    workspacePath,
                    lastFrozenWorkRequestSnapshot: {
                        mode: 'immediate_task',
                        sourceText: `写一个总结并保存到 ${plannedPath}`,
                        primaryObjective: '写一个总结并保存到文件',
                        preferredWorkflows: [],
                        resolvedTargets: [],
                        deliverables: [
                            {
                                type: 'report_file',
                                path: plannedPath,
                                format: 'md',
                            },
                        ],
                    },
                },
                historyLimit: 20,
                artifactContract: {
                    sourceQuery: 'stale query',
                    requirements: [
                        {
                            id: 'stale-file',
                            kind: 'file',
                            description: 'stale',
                            strictness: 'hard',
                            payload: {
                                extension: '.md',
                                path: path.join(workspacePath, 'stale.md'),
                                source: 'planned_deliverable',
                            },
                        },
                    ],
                },
                artifactsCreated: [],
            },
        ], null, 2), 'utf-8');

        const collector = new EventCollector();
        const sidecar = new SidecarProcess(collector, {
            cwd: path.join(process.cwd(), 'sidecar'),
            env: {
                COWORKANY_APP_DATA_DIR: appDataDir,
            },
        });

        await sidecar.start();
        sidecar.sendCommand(buildBootstrapRuntimeContextCommand({
            appDataDir,
            appDir: path.join(process.cwd(), 'sidecar'),
            shell: process.env.SHELL || '/bin/zsh',
        }));
        await new Promise((resolve) => setTimeout(resolve, 1200));
        sidecar.kill();

        const restoredRecords = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as any[];
        const restored = restoredRecords.find((record) => record.taskId === taskId);
        const plannedPaths = (restored?.artifactContract?.requirements ?? [])
            .filter((item: any) => item?.kind === 'file' && item?.payload?.source === 'planned_deliverable')
            .map((item: any) => item?.payload?.path);

        expect(restored).toBeTruthy();
        expect(restored?.artifactContract?.sourceQuery).toContain('写一个总结并保存到文件');
        expect(plannedPaths).toEqual([plannedPath]);
    }, 45000);

    test('normalizes leaked planned-deliverable filenames during bootstrap restore', async () => {
        const appDataDir = makeTempDir();
        const workspacePath = path.join(appDataDir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const runtimePath = path.join(appDataDir, 'task-runtime.json');
        const taskId = randomUUID();

        fs.writeFileSync(runtimePath, JSON.stringify([
            {
                taskId,
                title: 'Leaked path task',
                workspacePath,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: 'interrupted',
                conversation: [
                    { role: 'user', content: '检索并保存分析结果' },
                ],
                config: {
                    workspacePath,
                    lastFrozenWorkRequestSnapshot: {
                        mode: 'immediate_task',
                        sourceText: '检索并保存分析结果',
                        primaryObjective: '检索并保存分析结果',
                        preferredWorkflows: [],
                        resolvedTargets: [],
                        deliverables: [
                            {
                                type: 'report_file',
                                path: 'reports/1-x-planned-output-artifact-reports-1-x-md-checkpoint-before-final-delivery.md',
                                format: 'md',
                            },
                        ],
                    },
                },
                historyLimit: 20,
                artifactContract: {
                    sourceQuery: 'stale query',
                    requirements: [],
                },
                artifactsCreated: [],
            },
        ], null, 2), 'utf-8');

        const collector = new EventCollector();
        const sidecar = new SidecarProcess(collector, {
            cwd: path.join(process.cwd(), 'sidecar'),
            env: {
                COWORKANY_APP_DATA_DIR: appDataDir,
            },
        });

        await sidecar.start();
        sidecar.sendCommand(buildBootstrapRuntimeContextCommand({
            appDataDir,
            appDir: path.join(process.cwd(), 'sidecar'),
            shell: process.env.SHELL || '/bin/zsh',
        }));
        await new Promise((resolve) => setTimeout(resolve, 1200));
        sidecar.kill();

        const restoredRecords = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as any[];
        const restored = restoredRecords.find((record) => record.taskId === taskId);
        const snapshotPath = restored?.config?.lastFrozenWorkRequestSnapshot?.deliverables?.[0]?.path;
        const plannedPaths = (restored?.artifactContract?.requirements ?? [])
            .filter((item: any) => item?.kind === 'file' && item?.payload?.source === 'planned_deliverable')
            .map((item: any) => item?.payload?.path);

        expect(restored).toBeTruthy();
        expect(snapshotPath).toBe('reports/task-output.md');
        expect(plannedPaths).toEqual(['reports/task-output.md']);
    }, 45000);

    test('restores finished task context after bootstrap and reopens the contract on follow-up correction', async () => {
        const appDataDir = makeTempDir();
        const workspacePath = path.join(appDataDir, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        const runtimePath = path.join(appDataDir, 'task-runtime.json');
        const taskId = randomUUID();
        const originalPath = path.join(workspacePath, 'hello.js');
        const correctedPath = path.join(workspacePath, 'hello.ts');

        fs.writeFileSync(runtimePath, JSON.stringify([
            {
                taskId,
                title: 'Finished report task',
                workspacePath,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: 'finished',
                conversation: [
                    { role: 'user', content: `写一个简单的 Hello World 程序，保存到 ${originalPath}` },
                    { role: 'assistant', content: '已完成，并保存到指定路径。' },
                ],
                config: {
                    workspacePath,
                    lastFrozenWorkRequestSnapshot: {
                        mode: 'immediate_task',
                        sourceText: `写一个简单的 Hello World 程序，保存到 ${originalPath}`,
                        primaryObjective: '写一个简单的 Hello World 程序',
                        preferredWorkflows: [],
                        resolvedTargets: [],
                        deliverables: [
                            {
                                type: 'artifact_file',
                                path: originalPath,
                                format: 'js',
                            },
                        ],
                    },
                },
                historyLimit: 20,
                artifactContract: {
                    type: 'file_artifact_contract',
                    query: `写一个简单的 Hello World 程序，保存到 ${originalPath}`,
                    expectedArtifacts: [originalPath],
                },
                artifactsCreated: [originalPath],
            },
        ], null, 2), 'utf-8');

        const collector = new EventCollector();
        const sidecar = new SidecarProcess(collector, {
            cwd: path.join(process.cwd(), 'sidecar'),
            env: {
                COWORKANY_APP_DATA_DIR: appDataDir,
            },
        });

        await sidecar.start();
        sidecar.sendCommand(buildBootstrapRuntimeContextCommand({
            appDataDir,
            appDir: path.join(process.cwd(), 'sidecar'),
            shell: process.env.SHELL || '/bin/zsh',
        }));

        await new Promise((resolve) => setTimeout(resolve, 1000));

        sidecar.sendCommand(buildSendTaskMessageCommand({
            taskId,
            content: `Actually, save it to ${correctedPath} instead.`,
        }));

        const reopened = await waitForEventType(
            collector,
            'TASK_CONTRACT_REOPENED',
            (payload) => payload.trigger === 'contradictory_evidence',
            30000
        );
        const planReady = await waitForEventType(
            collector,
            'TASK_PLAN_READY',
            undefined,
            10000
        );
        const clarificationRequired = collector.events.find((event) => event.type === 'TASK_CLARIFICATION_REQUIRED');

        sidecar.kill();

        expect(reopened).toBeTruthy();
        expect(reopened?.payload?.trigger).toBe('contradictory_evidence');
        expect(String(reopened?.payload?.reason ?? '')).toContain('corrected the previous contract');
        expect(reopened?.payload?.diff?.changedFields).toContain('deliverables');
        expect(String(reopened?.payload?.diff?.deliverablesChanged?.after?.join('|') ?? '')).toContain(correctedPath);
        expect(planReady).toBeTruthy();
        expect(collector.events.some((event) => event.type === 'TASK_RESEARCH_UPDATED')).toBe(true);
        expect(clarificationRequired).toBeUndefined();
    }, 60000);
});
