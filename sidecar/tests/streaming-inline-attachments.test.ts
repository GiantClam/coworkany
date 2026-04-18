import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chatResponder } from '../src/mastra/agents/chatResponder';
import { handleUserMessage } from '../src/ipc/streaming';

describe('streaming attachment paths', () => {
    test('passes resolved attachment paths into prompt without inline payload tags', async () => {
        const originalStream = chatResponder.stream.bind(chatResponder);
        const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
        const previousModel = process.env.COWORKANY_MODEL;
        const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-inline-attachment-'));
        const attachmentPath = path.join(tempWorkspace, 'screenshot.png');
        const prompts: string[] = [];

        try {
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            fs.writeFileSync(attachmentPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = (async (prompt: string) => {
                prompts.push(prompt);
                return {
                    runId: 'run-inline-attachment-path',
                    fullStream: (async function* stream() {
                        yield {
                            type: 'text-delta',
                            payload: { text: '附件已处理。' },
                        };
                        yield {
                            type: 'finish',
                            payload: { finishReason: 'stop' },
                        };
                    })(),
                } as Awaited<ReturnType<typeof chatResponder.stream>>;
            }) as typeof chatResponder.stream;

            const message = [
                '[Resolved attachments]',
                `- ${attachmentPath}`,
                '将附件图片转成 png',
            ].join('\n');

            await handleUserMessage(
                message,
                'thread-inline-attachment-path',
                'resource-inline-attachment-path',
                () => {},
                {
                    forcedRouteMode: 'chat',
                    useDirectChatResponder: true,
                    forcePostAssistantCompletion: true,
                    taskId: 'task-inline-attachment-path-chat',
                    workspacePath: tempWorkspace,
                },
            );

            expect(prompts.length).toBeGreaterThan(0);
            const finalPrompt = prompts[prompts.length - 1] ?? '';
            expect(finalPrompt).toContain('[Resolved attachments]');
            expect(finalPrompt).toContain(attachmentPath);
            expect(finalPrompt).not.toContain('<image_base64');
        } finally {
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = originalStream as typeof chatResponder.stream;
            if (typeof previousAnthropicKey === 'string') {
                process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
            } else {
                delete process.env.ANTHROPIC_API_KEY;
            }
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            fs.rmSync(tempWorkspace, { recursive: true, force: true });
        }
    });

    test('suppresses internal completion-check deltas from assistant output', async () => {
        const originalStream = chatResponder.stream.bind(chatResponder);
        const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
        const previousModel = process.env.COWORKANY_MODEL;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';

            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = (async () => ({
                runId: 'run-inline-attachment-filter',
                fullStream: (async function* stream() {
                    yield {
                        type: 'text-delta',
                        payload: {
                            text: '#### Completion Check Results\n\n**coworkany-loop-has-answer**\nScore: 0',
                        },
                    };
                    yield {
                        type: 'text-delta',
                        payload: {
                            text: '已完成转换：输出文件在当前目录。',
                        },
                    };
                    yield {
                        type: 'finish',
                        payload: { finishReason: 'stop' },
                    };
                })(),
            })) as typeof chatResponder.stream;

            await handleUserMessage(
                '将附件图片转成 png',
                'thread-inline-attachment-filter',
                'resource-inline-attachment-filter',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcedRouteMode: 'chat',
                    useDirectChatResponder: true,
                    forcePostAssistantCompletion: true,
                    taskId: 'task-inline-attachment-filter-chat',
                },
            );

            const assistantText = events
                .filter((event) => event.type === 'text_delta' && event.role === 'assistant')
                .map((event) => String(event.content ?? ''))
                .join('\n');
            expect(assistantText).toContain('已完成转换');
            expect(assistantText).not.toContain('Completion Check Results');
            expect(assistantText).not.toContain('coworkany-loop-has-answer');
        } finally {
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = originalStream as typeof chatResponder.stream;
            if (typeof previousAnthropicKey === 'string') {
                process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
            } else {
                delete process.env.ANTHROPIC_API_KEY;
            }
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
        }
    });
});
