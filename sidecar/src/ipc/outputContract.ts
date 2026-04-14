const OUTPUT_CUE_PATTERN = /\b(write|save|output|persist|store|create|generate)\b|保存|输出|写入|创建|生成/iu;
const CUE_WITH_PATH_PATTERN = /(?:\b(?:write|save|output|persist|store)\b|保存|输出|写入)[\s\S]{0,80}?(?:(?:to|as|到|为)\s*)?([`"'([{\uFF08\u3010]?[^\s`"'(){}\uFF08\uFF09\u3010\u3011]+[`"')\]}\uFF09\u3011]?)/giu;
const CREATE_WITH_PATH_PATTERN = /(?:\b(?:create|generate)\b|创建|生成)\s+([`"'([{\uFF08\u3010]?[^\s`"'(){}\uFF08\uFF09\u3010\u3011]+[`"')\]}\uFF09\u3011]?)/giu;
const BACKTICK_SEGMENT_PATTERN = /`([^`\n]+)`/g;

function sanitizePathToken(token: string): string {
    return token
        .trim()
        .replace(/^[`"'([{\uFF08\u3010]+/, '')
        .replace(/[`"')\]}\uFF09\u3011]+$/, '')
        .replace(/[.,;:!?，。；：！？]+$/u, '');
}

function trimPathClauseTail(candidate: string): string {
    // Truncate natural-language tails like "/tmp/a.py，然后运行它".
    return candidate.replace(/[，。；！？,;!?].*$/u, '');
}

function looksLikeOutputPath(candidate: string): boolean {
    if (!candidate || candidate.length < 3 || candidate.length > 320) {
        return false;
    }
    if (/^https?:\/\//iu.test(candidate)) {
        return false;
    }
    if (/[<>]/u.test(candidate)) {
        return false;
    }
    const hasPathSeparator = /[\\/]/u.test(candidate);
    const hasFileExtension = /\.[A-Za-z0-9]{1,10}$/u.test(candidate);
    return hasPathSeparator || hasFileExtension;
}

function collectMatchesFromPattern(message: string, pattern: RegExp): string[] {
    const results: string[] = [];
    for (const match of message.matchAll(pattern)) {
        const raw = match[1];
        if (typeof raw !== 'string') {
            continue;
        }
        const candidate = sanitizePathToken(trimPathClauseTail(sanitizePathToken(raw)));
        if (looksLikeOutputPath(candidate)) {
            results.push(candidate);
        }
    }
    return results;
}

function collectBacktickOutputPaths(message: string): string[] {
    const results: string[] = [];
    for (const match of message.matchAll(BACKTICK_SEGMENT_PATTERN)) {
        const raw = match[1];
        if (typeof raw !== 'string') {
            continue;
        }
        const index = typeof match.index === 'number' ? match.index : -1;
        const contextStart = Math.max(0, index - 64);
        const context = message.slice(contextStart, Math.max(0, index));
        if (!OUTPUT_CUE_PATTERN.test(context)) {
            continue;
        }
        const candidate = sanitizePathToken(trimPathClauseTail(sanitizePathToken(raw)));
        if (looksLikeOutputPath(candidate)) {
            results.push(candidate);
        }
    }
    return results;
}

export function extractExplicitOutputPaths(message: string): string[] {
    if (typeof message !== 'string' || message.trim().length === 0) {
        return [];
    }
    const candidates = [
        ...collectMatchesFromPattern(message, CUE_WITH_PATH_PATTERN),
        ...collectMatchesFromPattern(message, CREATE_WITH_PATH_PATTERN),
        ...collectBacktickOutputPaths(message),
    ];
    const deduped = new Set<string>();
    for (const candidate of candidates) {
        if (!deduped.has(candidate)) {
            deduped.add(candidate);
        }
    }
    return [...deduped];
}

function buildOutputContract(paths: string[]): string {
    const lines = [
        '[Output File Contract]',
        'Use the exact file path(s) below for outputs. Do not rename or substitute filenames.',
        ...paths.map((path) => `- ${path}`),
        'Before completion, verify each required output path exists and is non-empty.',
    ];
    return lines.join('\n');
}

export function injectOutputPathContract(message: string): string {
    if (typeof message !== 'string' || message.trim().length === 0) {
        return message;
    }
    if (message.includes('[Output File Contract]')) {
        return message;
    }
    const paths = extractExplicitOutputPaths(message);
    if (paths.length === 0) {
        return message;
    }
    return `${buildOutputContract(paths)}\n\n${message}`;
}
