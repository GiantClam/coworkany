import { describe, expect, test } from 'bun:test';
import type { Agent } from '@mastra/core/agent';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { freezeContract } from '../src/mastra/workflows/steps/freeze-contract';
import { executeFrozenTask } from '../src/mastra/workflows/steps/execute-task';
import { analyzeWorkRequest } from '../src/orchestration/workRequestAnalyzer';
import type { TaskEvidenceCapability } from '../src/orchestration/workRequestSchema';

type RealSessionReplayCase = {
    kind?: 'tool_evidence' | 'routing';
    id: string;
    sourceThreadId: string;
    failureClass: string;
    userMessage: string;
    falseCompletionText: string;
    expectedRequiredCapabilities: TaskEvidenceCapability[];
    expectedMode?: ReturnType<typeof analyzeWorkRequest>['mode'];
    expectedTaskDraftRequired?: boolean;
    expectedUserActionKinds?: string[];
    wrongToolEvidence: string[];
    sufficientToolEvidence: string[];
};

type RealSessionReplayFixture = {
    source: string;
    capturedAt: string;
    cases: RealSessionReplayCase[];
};

function loadFixture(): RealSessionReplayFixture {
    const currentFilePath = fileURLToPath(import.meta.url);
    const fixturePath = path.join(path.dirname(currentFilePath), 'fixtures', 'real-session-replay-cases.json');
    return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as RealSessionReplayFixture;
}

function withNoExecuteRetries<T>(fn: () => Promise<T>): Promise<T> {
    const previousRetryCount = process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT;
    process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = '0';
    return fn().finally(() => {
        if (typeof previousRetryCount === 'string') {
            process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = previousRetryCount;
        } else {
            delete process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT;
        }
    });
}

function analyzeReplayCase(replayCase: RealSessionReplayCase): ReturnType<typeof analyzeWorkRequest> {
    const normalized = analyzeWorkRequest({
        sourceText: replayCase.userMessage,
        workspacePath: path.join(os.tmpdir(), 'coworkany-real-session-replay'),
    });
    expect(normalized.mode).toBe(replayCase.expectedMode ?? 'immediate_task');
    expect(normalized.taskDraftRequired).toBe(replayCase.expectedTaskDraftRequired ?? true);
    for (const kind of replayCase.expectedUserActionKinds ?? []) {
        expect((normalized.userActionsRequired ?? []).map((action) => action.kind)).toContain(kind);
    }
    return normalized;
}

describe('real session replay acceptance', () => {
    const fixture = loadFixture();

    test('fixture has DB-derived replay cases', () => {
        expect(fixture.source).toContain('.coworkany/data/coworkany.db');
        expect(fixture.cases.length).toBeGreaterThanOrEqual(7);
        expect(fixture.cases.map((entry) => entry.sourceThreadId)).toEqual(expect.arrayContaining([
            'thread-code-001',
            'thread-comm-004',
            'thread-doc-004',
            'thread-edu-001',
            'thread-eml-004',
            'thread-fin-008',
            'thread-web-004',
        ]));
    });

    for (const replayCase of fixture.cases) {
        test(`contract inference covers real failure: ${replayCase.id}`, () => {
            const normalized = analyzeReplayCase(replayCase);
            const requiredCapabilities = Array.from(new Set(normalized.tasks.flatMap((task) => (
                task.executionRequirements ?? []
            ).filter((requirement) => requirement.required).map((requirement) => requirement.capability))));
            for (const capability of replayCase.expectedRequiredCapabilities) {
                expect(requiredCapabilities).toContain(capability);
            }
            if ((replayCase.expectedRequiredCapabilities ?? []).length > 0) {
                const frozen = freezeContract({ normalized });
                expect(frozen.executionQuery).toContain('Required evidence:');
            }
        });

        test(`rejects false completion without matching tool evidence: ${replayCase.id}`, async () => {
            if ((replayCase.kind ?? 'tool_evidence') !== 'tool_evidence') {
                return;
            }
            const coworker = {
                generate: async () => ({
                    text: replayCase.falseCompletionText,
                    finishReason: 'stop',
                }),
            } as unknown as Agent;

            await withNoExecuteRetries(async () => {
                await expect(executeFrozenTask({
                    coworker,
                    task: {
                        frozen: { id: `frozen-${replayCase.id}-text-only` } as any,
                        executionPlan: { steps: [] } as any,
                        executionQuery: replayCase.userMessage,
                        requiredCapabilities: replayCase.expectedRequiredCapabilities,
                    },
                    workspacePath: path.join(os.tmpdir(), 'coworkany-real-session-replay'),
                })).rejects.toThrow(`workflow_missing_required_tool_evidence:${replayCase.expectedRequiredCapabilities.join(',')}`);
            });
        });

        test(`rejects wrong tool class evidence: ${replayCase.id}`, async () => {
            if ((replayCase.kind ?? 'tool_evidence') !== 'tool_evidence') {
                return;
            }
            const coworker = {
                generate: async () => ({
                    text: replayCase.falseCompletionText,
                    finishReason: 'stop',
                    toolCalls: replayCase.wrongToolEvidence.map((toolName) => ({ toolName })),
                }),
            } as unknown as Agent;

            await withNoExecuteRetries(async () => {
                await expect(executeFrozenTask({
                    coworker,
                    task: {
                        frozen: { id: `frozen-${replayCase.id}-wrong-tool` } as any,
                        executionPlan: { steps: [] } as any,
                        executionQuery: replayCase.userMessage,
                        requiredCapabilities: replayCase.expectedRequiredCapabilities,
                    },
                    workspacePath: path.join(os.tmpdir(), 'coworkany-real-session-replay'),
                })).rejects.toThrow('workflow_missing_required_tool_evidence:');
            });
        });

        test(`accepts matching tool evidence: ${replayCase.id}`, async () => {
            if ((replayCase.kind ?? 'tool_evidence') !== 'tool_evidence') {
                return;
            }
            const coworker = {
                generate: async () => ({
                    text: 'Completed with matching tool evidence.',
                    finishReason: 'stop',
                    toolCalls: replayCase.sufficientToolEvidence.map((toolName) => ({ toolName })),
                }),
            } as unknown as Agent;

            const output = await executeFrozenTask({
                coworker,
                task: {
                    frozen: { id: `frozen-${replayCase.id}-matching-tool` } as any,
                    executionPlan: { steps: [] } as any,
                    executionQuery: replayCase.userMessage,
                    requiredCapabilities: replayCase.expectedRequiredCapabilities,
                },
                workspacePath: path.join(os.tmpdir(), 'coworkany-real-session-replay'),
            });

            expect(output.completed).toBe(true);
            for (const capability of replayCase.expectedRequiredCapabilities) {
                expect(output.toolEvidence.satisfiedCapabilities).toContain(capability);
            }
            expect(output.toolEvidence.missingCapabilities).toEqual([]);
        });
    }
});
