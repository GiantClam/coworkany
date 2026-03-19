export type ConversationMessage = {
    role: 'user' | 'assistant';
    content: string | Array<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isToolUseBlock(block: unknown): boolean {
    return isRecord(block) && block.type === 'tool_use' && typeof block.id === 'string';
}

function isToolResultBlock(block: unknown): boolean {
    return isRecord(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string';
}

function getToolUseIds(message: ConversationMessage | undefined): Set<string> {
    if (!message || !Array.isArray(message.content)) return new Set();

    return new Set(
        message.content
            .filter(isToolUseBlock)
            .map((block) => block.id as string)
    );
}

function getToolResultIds(message: ConversationMessage | undefined): Set<string> {
    if (!message || !Array.isArray(message.content)) return new Set();

    return new Set(
        message.content
            .filter(isToolResultBlock)
            .map((block) => block.tool_use_id as string)
    );
}

function intersects(left: Set<string>, right: Set<string>): boolean {
    for (const value of left) {
        if (right.has(value)) return true;
    }
    return false;
}

export function adjustCompactionRemoveCount(
    conversation: ConversationMessage[],
    requestedRemoveCount: number
): number {
    if (requestedRemoveCount <= 0 || requestedRemoveCount >= conversation.length) {
        return requestedRemoveCount;
    }

    let removeCount = requestedRemoveCount;

    while (removeCount > 0 && removeCount < conversation.length) {
        const lastRemoved = conversation[removeCount - 1];
        const firstKept = conversation[removeCount];

        const removedToolUses = getToolUseIds(lastRemoved);
        const keptToolResults = getToolResultIds(firstKept);

        if (!intersects(removedToolUses, keptToolResults)) {
            break;
        }

        removeCount -= 1;
    }

    return removeCount;
}
