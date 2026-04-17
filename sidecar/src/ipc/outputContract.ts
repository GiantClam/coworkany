const OUTPUT_CUE_PATTERN = /\b(write|save|output|persist|store|create|generate)\b|保存|输出|写入|创建|生成/iu;
const OUTPUT_CUE_GLOBAL_PATTERN = /\b(write|save|output|persist|store|create|generate)\b|保存|输出|写入|创建|生成/giu;
const CUE_WITH_PATH_PATTERN = /(?:\b(?:write|save|output|persist|store)\b|保存|输出|写入)[\s\S]{0,80}?(?:(?:to|as|到|为)\s*)?([`"'([{\uFF08\u3010]?[^\s`"'(){}\uFF08\uFF09\u3010\u3011]+[`"')\]}\uFF09\u3011]?)/giu;
const CREATE_WITH_PATH_PATTERN = /(?:\b(?:create|generate)\b|创建|生成)\s+([`"'([{\uFF08\u3010]?[^\s`"'(){}\uFF08\uFF09\u3010\u3011]+[`"')\]}\uFF09\u3011]?)/giu;
const BACKTICK_SEGMENT_PATTERN = /`([^`\n]+)`/g;
const PATH_TOKEN_PATTERN = /(?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:\\|[A-Za-z0-9._-]+[\\/])[^\s`"'<>|]+/gu;
const URL_SEGMENT_PATTERN = /https?:\/\/[^\s`"'<>|]+/giu;
const RETRY_EXECUTION_CONTRACT_MARKER = '[CoworkAny Retry Execution Contract]';
const EXTENSIONLESS_FILE_BASENAMES = new Set([
    'dockerfile',
    'makefile',
    'license',
    'readme',
]);

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
    if (/^\d{1,4}[\/-]\d{1,4}(?:[\/-]\d{1,4})?$/u.test(candidate)) {
        return false;
    }
    // Ignore URL path fragments like "/example.com" captured from "https://example.com".
    if (/^\/[^/]+\.[A-Za-z]{2,10}$/u.test(candidate)) {
        return false;
    }
    const hasPathSeparator = /[\\/]/u.test(candidate);
    const hasFileExtension = /\.[A-Za-z0-9]{1,10}$/u.test(candidate);
    const basename = candidate
        .split(/[\\/]/u)
        .filter((value) => value.length > 0)
        .pop()
        ?.toLowerCase() ?? '';
    const isKnownExtensionlessFile = EXTENSIONLESS_FILE_BASENAMES.has(basename);
    // Ignore directory-like tokens such as "workspace/orchestration" and
    // natural-language slash expressions such as "approved/rejected".
    if (!hasFileExtension && !isKnownExtensionlessFile) {
        return false;
    }
    return /[A-Za-z_\u4e00-\u9fff]/u.test(candidate) || hasPathSeparator;
}

function stripRetryExecutionContractBlock(message: string): string {
    const markerIndex = message.indexOf(RETRY_EXECUTION_CONTRACT_MARKER);
    if (markerIndex < 0) {
        return message;
    }
    const afterMarker = message.slice(markerIndex);
    const contractEndOffset = afterMarker.indexOf('\n\n');
    if (contractEndOffset < 0) {
        return message.slice(0, markerIndex);
    }
    return `${message.slice(0, markerIndex)}${afterMarker.slice(contractEndOffset + 2)}`;
}

function collectUrlRanges(message: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    for (const match of message.matchAll(URL_SEGMENT_PATTERN)) {
        if (typeof match.index !== 'number') {
            continue;
        }
        const raw = match[0];
        if (typeof raw !== 'string' || raw.length === 0) {
            continue;
        }
        ranges.push({
            start: match.index,
            end: match.index + raw.length,
        });
    }
    return ranges;
}

function intersectsAnyRange(start: number, end: number, ranges: Array<{ start: number; end: number }>): boolean {
    for (const range of ranges) {
        if (start < range.end && end > range.start) {
            return true;
        }
    }
    return false;
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

function collectCueWindowOutputPaths(message: string): string[] {
    const results: string[] = [];
    for (const cue of message.matchAll(OUTPUT_CUE_GLOBAL_PATTERN)) {
        const cueIndex = typeof cue.index === 'number' ? cue.index : -1;
        if (cueIndex < 0) {
            continue;
        }
        const window = message.slice(cueIndex, Math.min(message.length, cueIndex + 220));
        const urlRanges = collectUrlRanges(window);
        for (const match of window.matchAll(PATH_TOKEN_PATTERN)) {
            const raw = match[0];
            if (typeof raw !== 'string') {
                continue;
            }
            const tokenStart = typeof match.index === 'number' ? match.index : -1;
            const tokenEnd = tokenStart + raw.length;
            if (tokenStart >= 0 && intersectsAnyRange(tokenStart, tokenEnd, urlRanges)) {
                continue;
            }
            const candidate = sanitizePathToken(trimPathClauseTail(sanitizePathToken(raw)));
            if (looksLikeOutputPath(candidate)) {
                results.push(candidate);
            }
        }
    }
    return results;
}

export function extractExplicitOutputPaths(message: string): string[] {
    if (typeof message !== 'string' || message.trim().length === 0) {
        return [];
    }
    const sanitizedMessage = stripRetryExecutionContractBlock(message);
    const candidates = [
        ...collectMatchesFromPattern(sanitizedMessage, CUE_WITH_PATH_PATTERN),
        ...collectMatchesFromPattern(sanitizedMessage, CREATE_WITH_PATH_PATTERN),
        ...collectBacktickOutputPaths(sanitizedMessage),
        ...collectCueWindowOutputPaths(sanitizedMessage),
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
