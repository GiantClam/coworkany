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
