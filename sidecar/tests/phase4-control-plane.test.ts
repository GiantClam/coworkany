import { afterAll, describe, expect, test } from 'bun:test';
import { Mastra } from '@mastra/core';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { existsSync, rmSync } from 'fs';
import { z } from 'zod';
import { controlPlaneWorkflow } from '../src/mastra/workflows/control-plane';
import { analyzeWorkRequest } from '../src/mastra/workflows/steps/analyze-intent';
import { buildExecutionProfile } from '../src/mastra/workflows/steps/assess-risk';
import { freezeContract } from '../src/mastra/workflows/steps/freeze-contract';

function cleanupDbArtifacts(prefix: string): void {
    for (const suffix of ['', '-wal', '-shm']) {
        const file = `${prefix}${suffix}`;
        if (existsSync(file)) {
            rmSync(file, { force: true });
        }
    }
}

afterAll(() => {
    cleanupDbArtifacts('.test-phase4.db');
    cleanupDbArtifacts('.test-phase4-suspend.db');
});

describe('Phase 4: Control Plane Workflow', () => {
    test('can create and register a workflow in Mastra', () => {
        const echoStep = createStep({
            id: 'echo-step',
            inputSchema: z.object({ msg: z.string() }),
            outputSchema: z.object({ msg: z.string() }),
            execute: async ({ inputData }) => inputData,
        });

        const wf = createWorkflow({
            id: 'phase4-echo',
            inputSchema: z.object({ msg: z.string() }),
            outputSchema: z.object({ msg: z.string() }),
        }).then(echoStep).commit();

        const mastra = new Mastra({
            storage: new LibSQLStore({ id: 'phase4-store', url: 'file:.test-phase4.db' }),
            workflows: { phase4Echo: wf },
        });

        expect(mastra.getWorkflow('phase4Echo')).toBeDefined();
    });

    test('supports suspend/resume in steps', async () => {
        const suspendStep = createStep({
            id: 'suspend-step',
            inputSchema: z.object({ value: z.number() }),
            suspendSchema: z.object({ reason: z.string() }),
            resumeSchema: z.object({ approved: z.boolean() }),
            outputSchema: z.object({ result: z.string() }),
            execute: async ({ inputData, resumeData, suspend }) => {
                if (!resumeData?.approved) {
                    return await suspend({ reason: 'Need approval' });
                }
                return { result: `ok-${inputData.value}` };
            },
        });

        const wf = createWorkflow({
            id: 'phase4-suspend',
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.object({ result: z.string() }),
        }).then(suspendStep).commit();

        const mastra = new Mastra({
            storage: new LibSQLStore({ id: 'phase4-suspend-store', url: 'file:.test-phase4-suspend.db' }),
            workflows: { phase4Suspend: wf },
        });

        const run = await mastra.getWorkflow('phase4Suspend').createRun();
        const first = await run.start({ inputData: { value: 42 } });
        expect(first.status).toBe('suspended');

        const resumed = await run.resume({ step: 'suspend-step', resumeData: { approved: true } });
        expect(resumed.status).toBe('success');
    });

    test('analyze intent wrapper detects work mode', () => {
        const chat = analyzeWorkRequest({
            userInput: '谢谢',
            workspacePath: '/tmp',
        });

        const task = analyzeWorkRequest({
            userInput: '帮我修复 src/main.ts 的报错并运行测试',
            workspacePath: '/tmp',
        });

        expect(chat.mode).toBe('chat');
        expect(task.mode).toBe('immediate_task');
    });

    test('risk wrapper returns execution policy', () => {
        const analyzed = analyzeWorkRequest({
            userInput: '帮我删除 /tmp 下所有日志文件',
            workspacePath: '/tmp',
        });

        const risk = buildExecutionProfile(analyzed.normalized);
        expect(['auto', 'review_required', 'hard_block']).toContain(risk.executionPolicy);
    });

    test('freeze contract wrapper generates frozen request', () => {
        const analyzed = analyzeWorkRequest({
            userInput: '创建一个 README 并写入项目说明',
            workspacePath: '/tmp',
        });

        const frozen = freezeContract({ normalized: analyzed.normalized });
        expect(frozen.frozen.id.length).toBeGreaterThan(0);
        expect(frozen.executionPlan.steps.length).toBeGreaterThan(0);
        expect(frozen.executionQuery.length).toBeGreaterThan(0);
    });

    test('control plane workflow object exists', () => {
        expect(controlPlaneWorkflow).toBeDefined();
        expect(controlPlaneWorkflow.id).toBe('control-plane');
    });
});
