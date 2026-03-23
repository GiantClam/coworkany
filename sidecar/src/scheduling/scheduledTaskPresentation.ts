const DROPPED_RESULT_BLOCK_PATTERNS = [
    /(?:你这个需求很有价值|我先帮你把目标整理成|看起来还没说完|避免我做偏)/u,
    /^(?:我理解你的需求是|为了立刻开始|在我正式整理前|如果你愿意|你只要回一句)/u,
    /(?:时间范围|结果形式|偏好（可选）|按默认开始|你说的“.*”是想)/u,
    /(?:补充信息|补充几个关键项|确认\s*\d+\s*个偏好|可选)/u,
    /^(?:如果你要|如果需要|要的话|我现在也可以|我也可以)\b/u,
    /^checkpoint before final delivery$/iu,
];

const TRAILING_FOLLOWUP_PATTERNS = [
    /\n{2,}(?:如果你要|如果需要|要的话|我现在也可以|我也可以)[\s\S]*$/u,
    /\n{2,}(?:If you want|If needed|I can also)[\s\S]*$/iu,
    /\n{2,}你回复一句[：:，,\s"'“”]*继续[\s\S]*$/u,
    /\n{2,}继续，按checkpoint格式给我[\s\S]*$/iu,
];

function stripMarkdownSyntax(text: string): string {
    return text
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '- ')
        .replace(/```(\w+)?\s*[\s\S]*?```/g, ' ') // 过滤代码块，包括语言标识符
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

function stripTrailingFollowup(text: string): string {
    let trimmed = text.trim();
    for (const pattern of TRAILING_FOLLOWUP_PATTERNS) {
        trimmed = trimmed.replace(pattern, '').trim();
    }
    return trimmed;
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

    const cleaned = stripTrailingFollowup(uniqueBlocks.join('\n\n').trim());
    if (cleaned) {
        return cleaned;
    }

    return stripTrailingFollowup(stripped)
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeScheduledTaskResultText(text: string): string {
    const cleaned = cleanScheduledTaskResultText(text);
    return cleaned
        .replace(/```\w*\s*[\s\S]*?```/g, ' ') // 过滤代码块（包含语言标识符）- 先处理
        .replace(/`([^`]+)`/g, '$1') // 过滤行内代码，保留内容
        .replace(/[-*#>`]/g, ' ')
        .replace(/^\s*\d+\.\s+/gm, '') // 过滤有序列表 (1. 2. 等)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 过滤控制字符
        .replace(/\s+/g, ' ')
        .trim();
}

export function buildScheduledTaskCompletionMessage(_title: string, resultText: string): string {
    return cleanScheduledTaskResultText(resultText) || '定时任务已完成。';
}

export function buildScheduledTaskStartedMessage(title: string): string {
    return `定时任务“${title}”已开始执行。`;
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
    return normalized || '定时任务已完成。';
}
