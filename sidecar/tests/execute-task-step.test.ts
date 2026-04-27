import { describe, expect, test } from 'bun:test';
import type { Agent } from '@mastra/core/agent';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { executeFrozenTask } from '../src/mastra/workflows/steps/execute-task';

describe('execute-task workflow step', () => {
    test('uses task-scoped resource id instead of shared org resource', async () => {
        const calls: Array<{
            thread: string;
            resource: string;
            requireToolApproval?: boolean;
            autoResumeSuspendedTools?: boolean;
        }> = [];
        const coworker = {
            generate: async (
                _query: string,
                options: {
                    memory?: { thread?: string; resource?: string };
                    requireToolApproval?: boolean;
                    autoResumeSuspendedTools?: boolean;
                },
            ) => {
                calls.push({
                    thread: options.memory?.thread ?? '',
                    resource: options.memory?.resource ?? '',
                    requireToolApproval: options.requireToolApproval,
                    autoResumeSuspendedTools: options.autoResumeSuspendedTools,
                });
                return {
                    text: 'ok',
                    finishReason: 'stop',
                };
            },
        } as unknown as Agent;

        await executeFrozenTask({
            coworker,
            task: {
                frozen: { id: 'frozen-task-a' } as any,
                executionPlan: { steps: [] } as any,
                executionQuery: 'first',
            },
            workspacePath: '/tmp/ws',
        });

        await executeFrozenTask({
            coworker,
            task: {
                frozen: { id: 'frozen-task-b' } as any,
                executionPlan: { steps: [] } as any,
                executionQuery: 'second',
            },
            workspacePath: '/tmp/ws',
        });

        expect(calls).toHaveLength(2);
        expect(calls[0]?.resource).toBe('employee-frozen-task-a');
        expect(calls[1]?.resource).toBe('employee-frozen-task-b');
        expect(calls[0]?.resource).not.toBe(calls[1]?.resource);
        expect(calls[0]?.thread).toBe('control-plane-frozen-task-a');
        expect(calls[1]?.thread).toBe('control-plane-frozen-task-b');
        expect(calls[0]?.requireToolApproval).toBe(true);
        expect(calls[0]?.autoResumeSuspendedTools).toBe(false);
        expect(calls[1]?.requireToolApproval).toBe(true);
        expect(calls[1]?.autoResumeSuspendedTools).toBe(false);
    });

    test('injects hard command-execution contract when capability requires command evidence', async () => {
        const prompts: string[] = [];
        const coworker = {
            generate: async (
                query: string,
            ) => {
                prompts.push(query);
                return {
                    text: 'command executed',
                    finishReason: 'stop',
                    toolCalls: [{ toolName: 'mastra_workspace_execute_command' }],
                };
            },
        } as unknown as Agent;

        const output = await executeFrozenTask({
            coworker,
            task: {
                frozen: { id: 'frozen-task-command-contract' } as any,
                executionPlan: { steps: [] } as any,
                executionQuery: '把附件图片合并为一个视频，每张图片播放 5s',
                requiredCapabilities: ['command_execution'],
            },
            workspacePath: '/tmp/ws',
        });

        expect(output.completed).toBe(true);
        expect(output.toolEvidence.commandToolCallCount).toBeGreaterThan(0);
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain('Execution contract (hard requirement):');
        expect(prompts[0]).toContain('MUST call a command-execution tool');
    });

    test('rejects unrelated tool calls when web research evidence is required', async () => {
        const coworker = {
            generate: async () => ({
                text: 'I ran a command but did not search the web.',
                finishReason: 'stop',
                toolCalls: [{ toolName: 'mastra_workspace_execute_command' }],
            }),
        } as unknown as Agent;

        const previousRetryCount = process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT;
        process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = '0';
        try {
            await expect(executeFrozenTask({
                coworker,
                task: {
                    frozen: { id: 'frozen-task-web-evidence-missing' } as any,
                    executionPlan: { steps: [] } as any,
                    executionQuery: '查询今天的市场新闻',
                    requiredCapabilities: ['web_research'],
                },
                workspacePath: '/tmp/ws',
            })).rejects.toThrow('workflow_missing_required_tool_evidence:web_research');
        } finally {
            if (typeof previousRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = previousRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT;
            }
        }
    });

    test('accepts completion only when every required capability has matching tool evidence', async () => {
        const coworker = {
            generate: async () => ({
                text: 'I searched and wrote the report.',
                finishReason: 'stop',
                toolCalls: [
                    { toolName: 'search_web' },
                    { toolName: 'write_to_file' },
                ],
            }),
        } as unknown as Agent;

        const output = await executeFrozenTask({
            coworker,
            task: {
                frozen: { id: 'frozen-task-multi-evidence' } as any,
                executionPlan: { steps: [] } as any,
                executionQuery: '查询市场新闻并保存到报告文件',
                requiredCapabilities: ['web_research', 'artifact_write'],
            },
            workspacePath: '/tmp/ws',
        });

        expect(output.completed).toBe(true);
        expect(output.toolEvidence.satisfiedCapabilities).toContain('web_research');
        expect(output.toolEvidence.satisfiedCapabilities).toContain('artifact_write');
        expect(output.toolEvidence.missingCapabilities).toEqual([]);
    });

    test('deterministic fallback generates attachment video when model never emits command tool evidence', async () => {
        const ffmpegProbe = Bun.spawnSync({
            cmd: ['ffmpeg', '-version'],
            stdout: 'ignore',
            stderr: 'ignore',
        });
        if (!ffmpegProbe.success) {
            return;
        }

        const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'coworkany-step-fallback-'));
        const pngFixture = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
            0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
            0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
            0x42, 0x60, 0x82,
        ]);
        const attachmentA = path.join(workspacePath, '截图 A.png');
        const attachmentB = path.join(workspacePath, '截图 B.png');
        await fs.writeFile(attachmentA, pngFixture);
        await fs.writeFile(attachmentB, pngFixture);

        const coworker = {
            generate: async () => ({
                text: '只给解释，不执行命令。',
                finishReason: 'stop',
            }),
        } as unknown as Agent;

        const previousRetryCount = process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT;
        process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = '0';
        try {
            const output = await executeFrozenTask({
                coworker,
                task: {
                    frozen: { id: 'frozen-task-command-fallback' } as any,
                    executionPlan: { steps: [] } as any,
                    executionQuery: [
                        '[Resolved attachments]',
                        `- ${attachmentA}`,
                        `- ${attachmentB}`,
                        '',
                        '把附件图片合并为一个视频，每张图片播放 5s',
                    ].join('\n'),
                    requiredCapabilities: ['command_execution'],
                },
                workspacePath,
            });

            expect(output.completed).toBe(true);
            expect(output.toolEvidence.commandToolCallCount).toBeGreaterThan(0);
            const outputDir = path.join(workspacePath, 'output');
            const files = await fs.readdir(outputDir);
            const videos = files.filter((name) => name.toLowerCase().endsWith('.mp4'));
            expect(videos.length).toBeGreaterThan(0);
            const firstVideo = videos[0];
            const stats = await fs.stat(path.join(outputDir, firstVideo));
            expect(stats.size).toBeGreaterThan(0);
        } finally {
            if (typeof previousRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = previousRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT;
            }
        }
    });

    test('deterministic fallback resolves staged alias attachments to non-placeholder siblings', async () => {
        const ffmpegProbe = Bun.spawnSync({
            cmd: ['ffmpeg', '-version'],
            stdout: 'ignore',
            stderr: 'ignore',
        });
        if (!ffmpegProbe.success) {
            return;
        }

        const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'coworkany-step-alias-'));
        const stagedDir = path.join(workspacePath, '.coworkany', 'attachments', 'staged');
        await fs.mkdir(stagedDir, { recursive: true });

        const pngFixture = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
            0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
            0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
            0x42, 0x60, 0x82,
        ]);
        const aliasA = path.join(stagedDir, '-截图A.png');
        const aliasB = path.join(stagedDir, '-截图B.png');
        await fs.writeFile(aliasA, pngFixture);
        await fs.writeFile(aliasB, pngFixture);

        const realA = path.join(stagedDir, '11111111-1111-1111-1111-111111111111-截图A.png');
        const realB = path.join(stagedDir, '22222222-2222-2222-2222-222222222222-截图B.png');
        const realAImage = Bun.spawnSync({
            cmd: ['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360', '-frames:v', '1', realA],
            stdout: 'ignore',
            stderr: 'ignore',
        });
        const realBImage = Bun.spawnSync({
            cmd: ['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360', '-frames:v', '1', realB],
            stdout: 'ignore',
            stderr: 'ignore',
        });
        expect(realAImage.success).toBe(true);
        expect(realBImage.success).toBe(true);

        const coworker = {
            generate: async () => ({
                text: '只给解释，不执行命令。',
                finishReason: 'stop',
            }),
        } as unknown as Agent;

        const previousRetryCount = process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT;
        process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = '0';
        try {
            const output = await executeFrozenTask({
                coworker,
                task: {
                    frozen: { id: 'frozen-task-command-alias-fallback' } as any,
                    executionPlan: { steps: [] } as any,
                    executionQuery: [
                        '[Resolved attachments]',
                        `- ${aliasA}`,
                        `- ${aliasB}`,
                        '',
                        '把附件图片合并为一个视频，每张图片播放 5s',
                    ].join('\n'),
                    requiredCapabilities: ['command_execution'],
                },
                workspacePath,
            });

            expect(output.completed).toBe(true);
            expect(output.toolEvidence.commandToolCallCount).toBeGreaterThan(0);

            const tempDir = path.join(workspacePath, '.coworkany', 'tmp');
            const tempFiles = await fs.readdir(tempDir);
            const listFiles = tempFiles.filter((name) => name.startsWith('attachment-video-merge-') && name.endsWith('.txt'));
            expect(listFiles.length).toBeGreaterThan(0);
            const latestListFile = listFiles.sort().reverse()[0]!;
            const listContent = await fs.readFile(path.join(tempDir, latestListFile), 'utf8');
            expect(listContent).toContain(realA);
            expect(listContent).toContain(realB);
            expect(listContent).not.toContain(aliasA);
            expect(listContent).not.toContain(aliasB);
        } finally {
            if (typeof previousRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT = previousRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT;
            }
        }
    });
});
