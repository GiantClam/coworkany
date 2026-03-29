import { describe, expect, test } from 'bun:test';
import { createLineInputProcessor } from '../src/ipc/lineInputProcessor';

function createDeferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe('IPC line input processor', () => {
    test('processes queued lines sequentially', async () => {
        const order: string[] = [];
        const processor = createLineInputProcessor({
            processLine: async (line) => {
                order.push(`start:${line}`);
                await new Promise((resolve) => setTimeout(resolve, 1));
                order.push(`end:${line}`);
            },
        });

        processor.enqueueLine('line-a');
        processor.enqueueLine('line-b');
        await processor.awaitIdle();

        expect(order).toEqual([
            'start:line-a',
            'end:line-a',
            'start:line-b',
            'end:line-b',
        ]);
    });

    test('response lines bypass queued wait and are processed immediately', async () => {
        const deferred = createDeferred();
        const order: string[] = [];
        const processor = createLineInputProcessor({
            processLine: async (line) => {
                if (line === 'slow') {
                    order.push('slow-start');
                    await deferred.promise;
                    order.push('slow-end');
                    return;
                }
                order.push('priority');
            },
        });

        processor.enqueueLine('slow');
        processor.enqueueLine(JSON.stringify({ type: 'request_effect_response' }));

        let idleDone = false;
        const idlePromise = processor.awaitIdle().then(() => {
            idleDone = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(order).toContain('priority');
        expect(idleDone).toBe(false);
        expect(order).not.toContain('slow-end');

        deferred.resolve();
        await idlePromise;
        expect(order).toContain('slow-end');
    });

    test('pushChunk and flushTrailingLine process complete + trailing lines', async () => {
        const seen: string[] = [];
        const processor = createLineInputProcessor({
            processLine: async (line) => {
                seen.push(line);
            },
        });

        processor.pushChunk('line-1\nline-2');
        await processor.awaitIdle();
        expect(seen).toEqual(['line-1']);

        const hadTrailing = processor.flushTrailingLine();
        expect(hadTrailing).toBe(true);
        await processor.awaitIdle();
        expect(seen).toEqual(['line-1', 'line-2']);
    });
});
