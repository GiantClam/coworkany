export type ConversationMessage = {
    role: 'user' | 'assistant';
    content: string | Array<Record<string, unknown>>;
};

export function flattenAssistantContent(
    content: ConversationMessage['content'],
): string {
    if (typeof content === 'string') {
        return content.trim();
    }

    if (!Array.isArray(content)) {
        return '';
    }

    return content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => String(block.text).trim())
        .filter((part) => part.length > 0)
        .join('\n\n')
        .trim();
}

export function extractLatestAssistantText(
    messages: ConversationMessage[],
): string | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== 'assistant') {
            continue;
        }

        const text = flattenAssistantContent(message.content);
        if (text.length > 0) {
            return text;
        }
    }

    return undefined;
}

export function buildTaskCompletionSummary(
    messages: ConversationMessage[],
    fallback: string,
    maxLength = 1600,
): string {
    const latestAssistant = extractLatestAssistantText(messages);
    if (!latestAssistant) {
        return fallback;
    }

    return latestAssistant.length <= maxLength
        ? latestAssistant
        : `${latestAssistant.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
