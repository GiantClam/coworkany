const OUTPUT_CUE_PATTERN = /\b(write|save|output|persist|store|create|generate)\b|保存|输出|写入|创建|生成/iu;
const OUTPUT_CUE_GLOBAL_PATTERN = /\b(write|save|output|persist|store|create|generate)\b|保存|输出|写入|创建|生成/giu;
const CUE_WITH_PATH_PATTERN = /(?:\b(?:write|save|output|persist|store)\b|保存|输出|写入)[\s\S]{0,80}?(?:(?:to|as|到|为)\s*)?([`"'([{\uFF08\u3010]?[^\s`"'(){}\uFF08\uFF09\u3010\u3011]+[`"')\]}\uFF09\u3011]?)/giu;
const CREATE_WITH_PATH_PATTERN = /(?:\b(?:create|generate)\b|创建|生成)\s+([`"'([{\uFF08\u3010]?[^\s`"'(){}\uFF08\uFF09\u3010\u3011]+[`"')\]}\uFF09\u3011]?)/giu;
const BACKTICK_SEGMENT_PATTERN = /`([^`\n]+)`/g;
const PATH_TOKEN_PATTERN = /(?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:\\|[A-Za-z0-9._-]+[\\/])[^\s`"'<>|]+/gu;
const URL_SEGMENT_PATTERN = /https?:\/\/[^\s`"'<>|]+/giu;
const TEMPLATE_PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_-]+)\}/gu;
const TEMPLATE_PLACEHOLDER_TEST_PATTERN = /\{[A-Za-z0-9_-]+\}/u;
const DIRECTORY_REQUIREMENT_HEADER_PATTERN = /\b(?:must\s+be\s+in|in|under)\s+`?([^`\s]+\/)`?\s+and\s+include\b/iu;
const BULLET_LINE_PATTERN = /^\s*[-*]\s+/u;
const RETRY_EXECUTION_CONTRACT_MARKER = '[CoworkAny Retry Execution Contract]';
const OUTPUT_CUE_LOOKAHEAD_WINDOW_CHARS = 1200;
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

function hasTemplatePlaceholders(candidate: string): boolean {
    return TEMPLATE_PLACEHOLDER_TEST_PATTERN.test(candidate);
}

function isSupportedTemplatePath(candidate: string): boolean {
    if (!candidate.includes('{') || !candidate.includes('}')) {
        return false;
    }
    if (!/[\\/]/u.test(candidate)) {
        return false;
    }
    if (!/\.[A-Za-z0-9]{1,10}$/u.test(candidate)) {
        const basename = candidate
            .split(/[\\/]/u)
            .filter((value) => value.length > 0)
            .pop()
            ?.toLowerCase() ?? '';
        if (!EXTENSIONLESS_FILE_BASENAMES.has(basename)) {
            return false;
        }
    }
    const placeholders = [...candidate.matchAll(TEMPLATE_PLACEHOLDER_PATTERN)];
    if (placeholders.length === 0) {
        return false;
    }
    return placeholders.every((match) => {
        const token = (match[1] ?? '').trim().toLowerCase();
        return token.length > 0 && /^[a-z0-9_-]+$/u.test(token);
    });
}

function looksLikeOutputPath(candidate: string, options?: { allowTemplate?: boolean }): boolean {
    if (!candidate || candidate.length < 3 || candidate.length > 320) {
        return false;
    }
    if (/^https?:\/\//iu.test(candidate)) {
        return false;
    }
    if (/[<>]/u.test(candidate)) {
        return false;
    }
    if (/[{}]/u.test(candidate)) {
        if (options?.allowTemplate !== true || !isSupportedTemplatePath(candidate)) {
            return false;
        }
    }
    if (/[[\]*?]/u.test(candidate)) {
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
        if (looksLikeOutputPath(candidate, { allowTemplate: true })) {
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
        if (looksLikeOutputPath(candidate, { allowTemplate: true })) {
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
        const window = message.slice(cueIndex, Math.min(message.length, cueIndex + OUTPUT_CUE_LOOKAHEAD_WINDOW_CHARS));
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
            if (tokenStart >= 0) {
                const lineStart = window.lastIndexOf('\n', tokenStart) + 1;
                const nextBreak = window.indexOf('\n', tokenStart);
                const lineEnd = nextBreak >= 0 ? nextBreak : window.length;
                const line = window.slice(lineStart, lineEnd);
                const lineHasInputCue = /\binput\b|输入/iu.test(line);
                const lineHasOutputCue = /\b(output|write|save|create|generate)\b|输出|写入|保存|创建|生成/iu.test(line);
                if (lineHasInputCue && !lineHasOutputCue) {
                    continue;
                }
            }
            const candidate = sanitizePathToken(trimPathClauseTail(sanitizePathToken(raw)));
            if (looksLikeOutputPath(candidate, { allowTemplate: true })) {
                results.push(candidate);
            }
        }
    }
    return results;
}

function normalizeAgentRoleToken(raw: string): string | null {
    const token = raw
        .trim()
        .toLowerCase()
        .replace(/[\u2013\u2014]/gu, ' ')
        .replace(/[^a-z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '');
    if (token.length === 0) {
        return null;
    }
    if (token === 'agent' || token === 'sub_agent' || token === 'subagent') {
        return null;
    }
    return token;
}

function extractAgentRoleTokens(message: string): string[] {
    const roles = new Set<string>();
    const lines = message.split(/\r?\n/u);
    for (const line of lines) {
        const boldMatch = line.match(/\*\*([^*\n]{1,80})\*\*/u);
        const boldText = (boldMatch?.[1] ?? '').trim();
        if (/\bagent\b/iu.test(boldText)) {
            const prefix = boldText.replace(/\bagent\b/iu, '').trim();
            const normalized = normalizeAgentRoleToken(prefix);
            if (normalized) {
                roles.add(normalized);
            }
            continue;
        }
        const numberedMatch = line.match(/^\s*(?:[-*]|\d+\.)\s*([A-Za-z][^:\n]{0,80}?)\s+Agent\b/iu);
        const candidate = (numberedMatch?.[1] ?? '').trim();
        const normalized = normalizeAgentRoleToken(candidate);
        if (normalized) {
            roles.add(normalized);
        }
    }
    return [...roles];
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function expandTemplatedOutputPath(templatePath: string, message: string): string[] {
    if (!hasTemplatePlaceholders(templatePath)) {
        return [templatePath];
    }
    const placeholders = [...templatePath.matchAll(TEMPLATE_PLACEHOLDER_PATTERN)]
        .map((match) => (match[1] ?? '').trim().toLowerCase())
        .filter((value) => value.length > 0);
    if (placeholders.length === 0) {
        return [];
    }
    const roleTokens = extractAgentRoleTokens(message);
    let expandedPaths = [templatePath];
    for (const placeholder of placeholders) {
        if (!/(?:role|agent|agent_role|owner|worker|persona|name)/iu.test(placeholder)) {
            return [];
        }
        if (roleTokens.length === 0) {
            return [];
        }
        const placeholderRegex = new RegExp(`\\{${escapeRegex(placeholder)}\\}`, 'giu');
        expandedPaths = expandedPaths.flatMap((candidate) => roleTokens
            .map((token) => candidate.replace(placeholderRegex, token)));
    }
    return expandedPaths
        .map((value) => sanitizePathToken(value))
        .filter((value) => looksLikeOutputPath(value));
}

function inferPrimaryCodeLanguage(message: string): 'python' | 'typescript' | 'javascript' | 'unknown' {
    const normalized = message.toLowerCase();
    if (/\bpython|pytest|python3|\.py\b/u.test(normalized)) {
        return 'python';
    }
    if (/\btypescript|ts-node|\.ts\b/u.test(normalized)) {
        return 'typescript';
    }
    if (/\bjavascript|node\.js|nodejs|\.js\b/u.test(normalized)) {
        return 'javascript';
    }
    return 'unknown';
}

function inferDirectoryContractFileName(input: {
    bullet: string;
    language: 'python' | 'typescript' | 'javascript' | 'unknown';
}): string | null {
    const normalized = input.bullet.toLowerCase();
    if (/\breadme\b/u.test(normalized)) {
        return 'readme.md';
    }
    if (/\btest(?:s| file| cases| suite)?\b/u.test(normalized)) {
        if (input.language === 'python' || input.language === 'unknown') {
            return 'test_main.py';
        }
        if (input.language === 'typescript') {
            return 'main.test.ts';
        }
        return 'main.test.js';
    }
    if (/\bsource code\b|\bapplication logic\b|\bimplementation\b|\bcli tool\b|\bscript\b/u.test(normalized)) {
        if (input.language === 'python' || input.language === 'unknown') {
            return 'main.py';
        }
        if (input.language === 'typescript') {
            return 'main.ts';
        }
        return 'main.js';
    }
    return null;
}

function collectDirectoryContractOutputPaths(message: string): string[] {
    const lines = message.split(/\r?\n/u);
    const language = inferPrimaryCodeLanguage(message);
    const results = new Set<string>();
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const directoryMatch = line.match(DIRECTORY_REQUIREMENT_HEADER_PATTERN);
        if (!directoryMatch) {
            continue;
        }
        const rawDirectory = sanitizePathToken(directoryMatch[1] ?? '');
        if (!rawDirectory) {
            continue;
        }
        const normalizedDirectory = rawDirectory.replace(/\\/gu, '/').replace(/\/+$/u, '');
        const collectedBullets: string[] = [];
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
            const nextLine = lines[cursor] ?? '';
            if (nextLine.trim().length === 0 && collectedBullets.length > 0) {
                break;
            }
            if (/^\s*#{1,6}\s+/u.test(nextLine) || /^\s*\d+\.\s+/u.test(nextLine)) {
                break;
            }
            if (!BULLET_LINE_PATTERN.test(nextLine)) {
                if (collectedBullets.length > 0) {
                    break;
                }
                continue;
            }
            collectedBullets.push(nextLine.replace(BULLET_LINE_PATTERN, '').trim());
        }
        for (const bullet of collectedBullets) {
            const explicitFiles = [...bullet.matchAll(/\b([A-Za-z0-9._-]+\.[A-Za-z0-9]{1,10})\b/gu)]
                .map((match) => (match[1] ?? '').trim())
                .filter((candidate) => candidate.length > 0);
            if (explicitFiles.length > 0) {
                let addedExplicitOutput = false;
                for (const explicitFile of explicitFiles) {
                    const normalizedBullet = bullet.toLowerCase();
                    const normalizedExplicitFile = explicitFile.toLowerCase();
                    const likelyInputReference = (
                        /\b(described|defined|specified)\s+in\b/u.test(normalizedBullet)
                        || /\b(from|according to|based on|refer to|see)\b/u.test(normalizedBullet)
                    )
                        && !/^readme\.md$/u.test(normalizedExplicitFile);
                    if (likelyInputReference) {
                        continue;
                    }
                    const pathCandidate = explicitFile.includes('/')
                        ? explicitFile
                        : `${normalizedDirectory}/${explicitFile}`;
                    if (looksLikeOutputPath(pathCandidate)) {
                        results.add(pathCandidate);
                        addedExplicitOutput = true;
                    }
                    if (/^readme\.md$/iu.test(explicitFile)) {
                        results.add(`${normalizedDirectory}/readme.md`);
                        addedExplicitOutput = true;
                    }
                }
                if (addedExplicitOutput) {
                    continue;
                }
            }
            const inferredFileName = inferDirectoryContractFileName({
                bullet,
                language,
            });
            if (!inferredFileName) {
                continue;
            }
            const candidatePath = `${normalizedDirectory}/${inferredFileName}`;
            if (looksLikeOutputPath(candidatePath)) {
                results.add(candidatePath);
            }
        }
    }
    return [...results];
}

function looksLikeTruncatedExtensionVariant(candidate: string, other: string): boolean {
    const candidateExtension = candidate.match(/\.([A-Za-z0-9]{1,2})$/u);
    if (!candidateExtension) {
        return false;
    }
    if (other.length <= candidate.length) {
        return false;
    }
    if (!other.toLowerCase().startsWith(candidate.toLowerCase())) {
        return false;
    }
    const suffix = other.slice(candidate.length);
    return /^[A-Za-z0-9]{1,3}$/u.test(suffix);
}

function dropLikelyTruncatedOutputPaths(paths: string[]): string[] {
    if (paths.length <= 1) {
        return paths;
    }
    return paths.filter((candidate, index) => {
        for (let i = 0; i < paths.length; i += 1) {
            if (i === index) {
                continue;
            }
            const other = paths[i] as string;
            if (looksLikeTruncatedExtensionVariant(candidate, other)) {
                return false;
            }
        }
        return true;
    });
}

export function extractExplicitOutputPaths(message: string): string[] {
    if (typeof message !== 'string' || message.trim().length === 0) {
        return [];
    }
    const sanitizedMessage = stripRetryExecutionContractBlock(message);
    const templatedCandidates = [
        ...collectMatchesFromPattern(sanitizedMessage, CUE_WITH_PATH_PATTERN),
        ...collectMatchesFromPattern(sanitizedMessage, CREATE_WITH_PATH_PATTERN),
        ...collectBacktickOutputPaths(sanitizedMessage),
        ...collectCueWindowOutputPaths(sanitizedMessage),
    ];
    const candidates: string[] = [];
    for (const candidate of templatedCandidates) {
        if (hasTemplatePlaceholders(candidate)) {
            candidates.push(...expandTemplatedOutputPath(candidate, sanitizedMessage));
            continue;
        }
        candidates.push(candidate);
    }
    candidates.push(...collectDirectoryContractOutputPaths(sanitizedMessage));
    const filtered = candidates.filter((candidate) => looksLikeOutputPath(candidate));
    const deduped = new Set<string>();
    for (const candidate of filtered) {
        if (!deduped.has(candidate)) {
            deduped.add(candidate);
        }
    }
    return dropLikelyTruncatedOutputPaths([...deduped]);
}

function buildOutputContract(paths: string[]): string {
    const lines = [
        '[Output File Contract]',
        'Use the exact file path(s) below for outputs. Do not rename or substitute filenames.',
        ...paths.map((path) => `- ${path}`),
        'If tools are unavailable, provide each file inline using:',
        'FILE: <exact path>',
        '```<language>',
        '<content>',
        '```',
        'The runtime will materialize these inline file blocks to disk.',
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
