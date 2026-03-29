export type LineInputProcessorDeps = {
    processLine: (line: string) => Promise<void>;
    onPriorityLineError?: (error: unknown) => void;
    onQueuedLineError?: (error: unknown) => void;
};

export type LineInputProcessor = {
    enqueueLine: (line: string) => void;
    pushChunk: (chunk: string | Buffer) => void;
    flushTrailingLine: () => boolean;
    awaitIdle: () => Promise<void>;
};

export function createLineInputProcessor(deps: LineInputProcessorDeps): LineInputProcessor {
    let buffer = '';
    let lineProcessing = Promise.resolve();

    function enqueueLine(line: string): void {
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }

        // High-priority IPC responses (e.g. request_effect_response) must be handled
        // immediately; otherwise long-running commands can block the queue and cause
        // false timeouts while the response is already sitting in stdin.
        try {
            const raw = JSON.parse(trimmed) as { type?: unknown };
            if (typeof raw.type === 'string' && raw.type.endsWith('_response')) {
                void deps.processLine(line).catch((error) => {
                    deps.onPriorityLineError?.(error);
                });
                return;
            }
        } catch {
            // Keep malformed lines on the regular queue so processLine logs parse errors.
        }

        lineProcessing = lineProcessing
            .then(() => deps.processLine(line))
            .catch((error) => {
                deps.onQueuedLineError?.(error);
            });
    }

    function pushChunk(chunk: string | Buffer): void {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            enqueueLine(line);
        }
    }

    function flushTrailingLine(): boolean {
        const remaining = buffer.trim();
        buffer = '';
        if (!remaining) {
            return false;
        }
        enqueueLine(remaining);
        return true;
    }

    return {
        enqueueLine,
        pushChunk,
        flushTrailingLine,
        awaitIdle: () => lineProcessing,
    };
}
