export type SendSubagentMessageRequest = {
    taskId: string;
    subagentTaskId: string;
    content: string;
};

export type SendSubagentMessageParseResult =
    | {
        ok: true;
        value: SendSubagentMessageRequest;
    }
    | {
        ok: false;
        error: 'invalid_payload';
        details: {
            taskId: string;
            subagentTaskId: string;
            contentLength: number;
        };
    };

function pickString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function parseSendSubagentMessagePayload(payload: Record<string, unknown>): SendSubagentMessageParseResult {
    const taskId = pickString(payload.taskId);
    const subagentTaskId = (
        pickString(payload.subagentTaskId)
        || pickString(payload.subtaskId)
        || pickString(payload.agentTaskId)
        || pickString(payload.subagentId)
        || pickString(payload.agentId)
    );
    const content = pickString(payload.content) || pickString(payload.message);
    if (!taskId || !subagentTaskId || !content) {
        return {
            ok: false,
            error: 'invalid_payload',
            details: {
                taskId,
                subagentTaskId,
                contentLength: content.length,
            },
        };
    }
    return {
        ok: true,
        value: {
            taskId,
            subagentTaskId,
            content,
        },
    };
}
