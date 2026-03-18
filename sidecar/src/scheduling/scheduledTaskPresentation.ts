const DROPPED_RESULT_BLOCK_PATTERNS = [
    /(?:你这个需求很有价值|我先帮你把目标整理成|看起来还没说完|避免我做偏)/u,
    /^(?:我理解你的需求是|为了立刻开始|在我正式整理前|如果你愿意|你只要回一句)/u,
    /(?:时间范围|结果形式|偏好（可选）|按默认开始|你说的“.*”是想)/u,
    /(?:补充信息|补充几个关键项|确认\s*\d+\s*个偏好|可选)/u,
];

function stripMarkdownSyntax(text: string): string {
    return text
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '- ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
        .replace(/\r\n/g, '\n')
        .replace(/\n-{3,}\n/g, '\n\n')
        .trim();
}

function normalizeForDeduplication(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .replace(/[，。！？!?,.:：；;、“”"'`()\[\]{}]/g, '')
        .trim()
        .toLowerCase();
}

function shouldDropResultBlock(block: string): boolean {
    const normalized = block.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return true;
    }

    return DROPPED_RESULT_BLOCK_PATTERNS.some((pattern) => pattern.test(normalized));
}

function stripLeadingResultPreamble(block: string): string {
    return block
        .replace(/^(?:好的|当然|可以|没问题|收到|明白了)[，,！!。.\s]*/u, '')
        .replace(/^(?:按你的要求|已按要求)?整理了[^:：\n]{0,80}[:：]\s*/u, '')
        .replace(/^已为你整理并口播（[^）]+）[:：]\s*/u, '')
        .trim();
}

export function cleanScheduledTaskResultText(text: string): string {
    const stripped = stripMarkdownSyntax(text);
    if (!stripped) {
        return '';
    }

    const blocks = stripped
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);

    const uniqueBlocks: string[] = [];
    const seen = new Set<string>();
    for (const block of blocks) {
        const cleanedBlock = stripLeadingResultPreamble(block);
        if (shouldDropResultBlock(cleanedBlock)) {
            continue;
        }

        const dedupeKey = normalizeForDeduplication(cleanedBlock);
        if (!dedupeKey || seen.has(dedupeKey)) {
            continue;
        }

        seen.add(dedupeKey);
        uniqueBlocks.push(cleanedBlock);
    }

    const cleaned = uniqueBlocks.join('\n\n').trim();
    if (cleaned) {
        return cleaned;
    }

    return stripped
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeScheduledTaskResultText(text: string): string {
    return cleanScheduledTaskResultText(text)
        .replace(/[-*#>`]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function buildScheduledTaskCompletionMessage(title: string, resultText: string): string {
    const normalized = cleanScheduledTaskResultText(resultText) || '定时任务已完成。';
    return `定时任务“${title}”已完成：\n\n${normalized}`;
}

export function buildScheduledTaskFailureMessage(title: string, errorText: string): string {
    return `定时任务“${title}”执行失败：${errorText}`;
}

export function buildScheduledTaskSpokenText(args: {
    title: string;
    success: boolean;
    finalAssistantText: string;
    errorText?: string;
}): string {
    if (!args.success) {
        return `定时任务执行失败。${normalizeScheduledTaskResultText(args.errorText || '未知错误').slice(0, 300)}`;
    }

    const normalized = normalizeScheduledTaskResultText(args.finalAssistantText);
    return normalized
        ? `定时任务已完成。${args.title}。${normalized}`
        : `定时任务已完成。${args.title}。`;
}
