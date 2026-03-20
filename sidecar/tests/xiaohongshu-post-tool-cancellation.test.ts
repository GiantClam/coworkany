import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { browserService } from '../src/services/browserService';
import { xiaohongshuPostTool } from '../src/tools/xiaohongshuPost';

const activeSpies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
    while (activeSpies.length > 0) {
        activeSpies.pop()?.mockRestore();
    }
});

describe('xiaohongshu_post cancellation', () => {
    test('stops during browser connection when task cancellation is requested', async () => {
        let cancellationHandler: ((reason: string) => void) | undefined;

        const getPageSpy = spyOn(browserService, 'getPage').mockImplementation(async () => {
            throw new Error('not connected');
        });
        activeSpies.push(getPageSpy as unknown as { mockRestore: () => void });

        const navigateSpy = spyOn(browserService, 'navigate').mockImplementation(async () => {
            throw new Error('navigate should not be reached after cancellation');
        });
        activeSpies.push(navigateSpy as unknown as { mockRestore: () => void });

        const connectSpy = spyOn(browserService, 'connect').mockImplementation(async (options: any = {}) => {
            const signal = options?.signal as AbortSignal | undefined;
            return await new Promise((_, reject) => {
                if (!signal) {
                    reject(new Error('missing cancellation signal'));
                    return;
                }

                const abort = () => {
                    signal.removeEventListener('abort', abort);
                    const reason = signal.reason;
                    reject(new Error(typeof reason === 'string' ? reason : 'Task cancelled by user'));
                };

                if (signal.aborted) {
                    abort();
                    return;
                }

                signal.addEventListener('abort', abort, { once: true });
            });
        });
        activeSpies.push(connectSpy as unknown as { mockRestore: () => void });

        const pending = xiaohongshuPostTool.handler(
            { title: 'Test title', content: 'Test content' },
            {
                workspacePath: process.cwd(),
                taskId: 'task-cancel-xiaohongshu-post',
                onCancel: (waiter) => {
                    cancellationHandler = waiter;
                    return () => {
                        if (cancellationHandler === waiter) {
                            cancellationHandler = undefined;
                        }
                    };
                },
            }
        );

        await new Promise((resolve) => setTimeout(resolve, 50));
        cancellationHandler?.('Task cancelled by user');

        const result = await pending as Record<string, unknown>;
        const connectOptions = connectSpy.mock.calls[0]?.[0] as { signal?: AbortSignal } | undefined;

        expect(connectSpy).toHaveBeenCalledTimes(1);
        expect(connectOptions?.signal).toBeDefined();
        expect(result.cancelled).toBe(true);
        expect(result.error_type).toBe('cancelled');
        expect(result.message).toBe('Task cancelled by user');
        expect(navigateSpy).not.toHaveBeenCalled();
    });
});
