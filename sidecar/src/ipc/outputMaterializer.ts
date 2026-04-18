import path from 'node:path';

type FencedBlock = {
    language: string;
    content: string;
};

type PathScopedBlock = {
    outputPath: string;
    language: string;
    content: string;
};

const FENCED_BLOCK_PATTERN = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g;
const PATH_SCOPED_BLOCK_PATTERN = /(?:^|\n)\s*(?:\[FILE\]|FILE|OUTPUT PATH|PATH|文件)\s*[:：]\s*`?([^\n`]+?)`?\s*```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/giu;

const EXTENSION_LANGUAGE_HINTS: Record<string, string[]> = {
    '.py': ['python', 'py'],
    '.js': ['javascript', 'js', 'node'],
    '.ts': ['typescript', 'ts'],
    '.tsx': ['tsx', 'typescriptreact'],
    '.sql': ['sql'],
    '.yaml': ['yaml', 'yml'],
    '.yml': ['yaml', 'yml'],
    '.json': ['json', 'javascript', 'js'],
    '.txt': ['txt', 'text', 'plaintext', 'plain'],
    '.csv': ['csv'],
    '.xml': ['xml'],
    '.html': ['html'],
};

function collectFencedBlocks(text: string): FencedBlock[] {
    const blocks: FencedBlock[] = [];
    for (const match of text.matchAll(FENCED_BLOCK_PATTERN)) {
        const language = (match[1] ?? '').trim().toLowerCase();
        const content = (match[2] ?? '').trim();
        if (content.length === 0) {
            continue;
        }
        blocks.push({
            language,
            content,
        });
    }
    return blocks;
}

function collectPathScopedBlocks(text: string): PathScopedBlock[] {
    const blocks: PathScopedBlock[] = [];
    for (const match of text.matchAll(PATH_SCOPED_BLOCK_PATTERN)) {
        const outputPath = (match[1] ?? '').trim();
        const language = (match[2] ?? '').trim().toLowerCase();
        const content = (match[3] ?? '').trim();
        if (outputPath.length === 0 || content.length === 0) {
            continue;
        }
        blocks.push({
            outputPath,
            language,
            content,
        });
    }
    return blocks;
}

function normalizeMaterializationPath(value: string): string {
    return value
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '');
}

function canonicalizePathLike(value: string): string {
    return path.normalize(value)
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .toLowerCase();
}

function matchesTargetOutputPath(targetPath: string, candidatePath: string): boolean {
    const normalizedCandidate = normalizeMaterializationPath(candidatePath);
    if (!normalizedCandidate) {
        return false;
    }
    const targetResolvedPath = path.resolve(targetPath);
    if (path.isAbsolute(normalizedCandidate)) {
        return path.resolve(normalizedCandidate) === targetResolvedPath;
    }

    const targetCanonical = canonicalizePathLike(targetResolvedPath);
    const candidateCanonical = canonicalizePathLike(normalizedCandidate);
    if (targetCanonical.endsWith(`/${candidateCanonical}`)) {
        return true;
    }

    const workspaceRelativeCandidate = candidateCanonical
        .replace(/^workspace\//, '')
        .replace(/^\.workspace\//, '');
    if (workspaceRelativeCandidate.length > 0 && workspaceRelativeCandidate !== candidateCanonical) {
        return targetCanonical.endsWith(`/${workspaceRelativeCandidate}`);
    }
    return false;
}

function tryParseJson(raw: string): unknown | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        // Continue with relaxed parsing below.
    }

    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
        const objectCandidate = trimmed.slice(objectStart, objectEnd + 1);
        try {
            return JSON.parse(objectCandidate);
        } catch {
            // Continue to array candidate.
        }
    }

    const arrayStart = trimmed.indexOf('[');
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
        const arrayCandidate = trimmed.slice(arrayStart, arrayEnd + 1);
        try {
            return JSON.parse(arrayCandidate);
        } catch {
            return null;
        }
    }

    return null;
}

function normalizeStatsLikeJson(parsed: unknown): unknown {
    if (Array.isArray(parsed)) {
        const objectEntries = parsed.filter((entry) => (
            !!entry
            && typeof entry === 'object'
            && !Array.isArray(entry)
        )) as Array<Record<string, unknown>>;
        const hasAggregateShape = objectEntries.some((entry) => (
            'total' in entry
            || 'amount' in entry
            || 'sum' in entry
            || 'count' in entry
            || 'mean' in entry
            || 'median' in entry
        ));
        if (!hasAggregateShape) {
            return parsed;
        }
        const aggregatedTotal = objectEntries
            .map((entry) => {
                if (typeof entry.total === 'number') {
                    return entry.total;
                }
                if (typeof entry.amount === 'number') {
                    return entry.amount;
                }
                if (typeof entry.sum === 'number') {
                    return entry.sum;
                }
                return null;
            })
            .filter((value): value is number => value !== null)
            .reduce((sum, value) => sum + value, 0);
        const summary = {
            count: parsed.length,
            source: 'materialized_array',
        };
        const normalizedFromArray: Record<string, unknown> = {
            summary,
            amount: summary,
            entries: parsed,
        };
        if (aggregatedTotal > 0) {
            normalizedFromArray.total = aggregatedTotal;
        }
        return normalizedFromArray;
    }
    if (!parsed || typeof parsed !== 'object') {
        return parsed;
    }
    const source = parsed as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...source };
    const amountSummary = (
        source.amount_summary
        && typeof source.amount_summary === 'object'
        && !Array.isArray(source.amount_summary)
    ) ? source.amount_summary as Record<string, unknown> : null;
    if (!('summary' in normalized) && amountSummary) {
        normalized.summary = amountSummary;
    }
    if (!('amount' in normalized) && amountSummary) {
        normalized.amount = amountSummary;
    }
    if (!('total' in normalized)) {
        const amountSum = amountSummary?.sum;
        if (typeof amountSum === 'number' && Number.isFinite(amountSum)) {
            normalized.total = amountSum;
        } else if (Array.isArray(source.by_quarter)) {
            const total = (source.by_quarter as Array<Record<string, unknown>>)
                .map((entry) => (typeof entry.total === 'number' ? entry.total : null))
                .filter((value): value is number => value !== null)
                .reduce((sum, value) => sum + value, 0);
            if (total > 0) {
                normalized.total = total;
            }
        }
    }
    return normalized;
}

function normalizeCsvDateColumns(raw: string): string | null {
    const lines = raw
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length < 2) {
        return null;
    }
    const header = lines[0];
    if (!header || !header.includes(',')) {
        return null;
    }
    const headers = header.split(',').map((cell) => cell.trim());
    const dateIndexes = headers
        .map((name, index) => ({ name, index }))
        .filter(({ name }) => /date/i.test(name))
        .map(({ index }) => index);
    if (dateIndexes.length === 0) {
        return `${lines.join('\n')}\n`;
    }
    const normalizedRows: string[] = [header];
    for (const row of lines.slice(1)) {
        const cells = row.split(',');
        if (cells.length < headers.length) {
            continue;
        }
        let valid = true;
        for (const dateIndex of dateIndexes) {
            const value = (cells[dateIndex] ?? '').trim();
            if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
                continue;
            }
            const parsed = new Date(value);
            if (Number.isNaN(parsed.getTime())) {
                valid = false;
                break;
            }
            cells[dateIndex] = parsed.toISOString().slice(0, 10);
        }
        if (!valid) {
            continue;
        }
        normalizedRows.push(cells.slice(0, headers.length).join(','));
    }
    if (normalizedRows.length < 2) {
        return null;
    }
    return `${normalizedRows.join('\n')}\n`;
}

function pickCodeBlockByExtension(
    extension: string,
    blocks: FencedBlock[],
): string | null {
    if (blocks.length === 0) {
        return null;
    }
    const hints = EXTENSION_LANGUAGE_HINTS[extension] ?? [];
    for (const hint of hints) {
        const block = blocks.find((candidate) => candidate.language === hint);
        if (block) {
            return block.content;
        }
    }
    const untyped = blocks.find((candidate) => candidate.language.length === 0);
    if (untyped) {
        return untyped.content;
    }
    if (blocks.length === 1) {
        return blocks[0]?.content ?? null;
    }
    return null;
}

function isLikelyNarrativeSummary(text: string): boolean {
    const normalized = text.toLowerCase();
    if (
        /执行降级交付|降级原因|原始请求|交付路径|建议：|completed|done\.|output file/i.test(normalized)
    ) {
        return true;
    }
    if (/^#\s/m.test(text)) {
        return true;
    }
    if (/^\s*-\s/m.test(text)) {
        return true;
    }
    return false;
}

function isLikelyDegradedFallbackMarkdown(text: string): boolean {
    if (
        /执行降级交付|上游模型在最终综合阶段超时|降级原因：|建议：可直接重试本任务|completed a focused recovery pass|recovery pass|verified \*\*exists|required output path/i.test(text)
        || /无法执行所需工具操作|无法运行所需工具操作|无法完成工具执行/i.test(text)
    ) {
        return true;
    }
    const hasRuntimeFailureSignal = /\b(missing_required_output_files|stream_(?:idle|progress|required_output|absolute|max_duration)_timeout|generate_fallback_timeout|chat_(?:startup|turn)_timeout_budget_exhausted)\b/i
        .test(text);
    const hasFallbackNarrativeSignal = /\b(fallback|degrad(?:e|ed)|retry|timeout)\b|降级|超时|重试/iu
        .test(text);
    return hasRuntimeFailureSignal && hasFallbackNarrativeSignal;
}

function looksLikePathScopedManifest(text: string): boolean {
    return /(?:^|\n)\s*(?:\[FILE\]|FILE|OUTPUT PATH|PATH|文件)\s*[:：]/iu.test(text);
}

function countWords(text: string): number {
    const matches = text.trim().match(/[A-Za-z0-9_]+/g);
    return matches ? matches.length : 0;
}

function normalizePythonSource(raw: string): string {
    const normalizedLineEndings = raw.replace(/\r\n/gu, '\n');
    const withRecoveredFunctionBoundaries = normalizedLineEndings
        // Recover accidental same-line concatenation like "... +1def find_task(...)".
        .replace(/([0-9A-Za-z_)\]'"])[ \t]*(?=(?:def|class)\s+[A-Za-z_])/gu, '$1\n');
    return withRecoveredFunctionBoundaries.trimEnd();
}

function isLikelyRefusalOrStatusOnly(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return true;
    }
    if (/^\s*(implemented|done|completed|finished|ok|success|n\/a|na|pass)\.?\s*$/i.test(trimmed)) {
        return true;
    }
    if (
        /i['’]?m sorry|cannot help|can['’]?t help|unable to assist|must refuse|i can['’]?t complete this request|no (?:active )?tool execution access|don['’]?t have active tool execution access|cannot access tool(?:s)?|无法协助|无法帮助|不能帮助|无法执行所需工具/i
            .test(trimmed)
    ) {
        return true;
    }
    return false;
}

function normalizePathScopedBlockForTarget(
    targetPath: string,
    block: PathScopedBlock,
): string | null {
    const extension = path.extname(targetPath).toLowerCase();
    const trimmed = block.content.trim();
    if (trimmed.length === 0) {
        return null;
    }
    if (isLikelyRefusalOrStatusOnly(trimmed) || isLikelyDegradedFallbackMarkdown(trimmed)) {
        return null;
    }

    if (extension === '.json') {
        const parsed = tryParseJson(trimmed);
        if (parsed === null) {
            return null;
        }
        return `${JSON.stringify(normalizeStatsLikeJson(parsed), null, 2)}\n`;
    }

    if (extension === '.csv') {
        return normalizeCsvDateColumns(trimmed);
    }

    if (extension === '.md') {
        if (trimmed.length < 120 || countWords(trimmed) < 24) {
            return null;
        }
        return `${trimmed}\n`;
    }

    if (extension === '.txt') {
        if (trimmed.length < 40 || countWords(trimmed) < 6) {
            return null;
        }
        return `${trimmed}\n`;
    }

    const codeLikeExtensions = new Set([
        '.py',
        '.js',
        '.ts',
        '.tsx',
        '.sql',
        '.yaml',
        '.yml',
        '.xml',
        '.html',
    ]);
    if (codeLikeExtensions.has(extension)) {
        if (extension === '.py') {
            return `${normalizePythonSource(trimmed)}\n`;
        }
        return `${trimmed}\n`;
    }

    if (block.language.length > 0) {
        return `${trimmed}\n`;
    }
    return null;
}

export function derivePathScopedFallbackOutputContent(
    targetPath: string,
    assistantText: string,
): string | null {
    const trimmed = assistantText.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const scopedBlocks = collectPathScopedBlocks(trimmed);
    if (scopedBlocks.length === 0) {
        return null;
    }
    for (const block of scopedBlocks) {
        if (!matchesTargetOutputPath(targetPath, block.outputPath)) {
            continue;
        }
        const normalizedContent = normalizePathScopedBlockForTarget(targetPath, block);
        if (normalizedContent) {
            return normalizedContent;
        }
    }
    return null;
}

export function deriveFallbackOutputContent(
    targetPath: string,
    assistantText: string,
): string | null {
    const trimmed = assistantText.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const extension = path.extname(targetPath).toLowerCase();
    const blocks = collectFencedBlocks(trimmed);

    if (extension === '.md') {
        if (looksLikePathScopedManifest(trimmed)) {
            return null;
        }
        if (isLikelyDegradedFallbackMarkdown(trimmed)) {
            return null;
        }
        if (isLikelyRefusalOrStatusOnly(trimmed)) {
            return null;
        }
        if (trimmed.length < 120 || countWords(trimmed) < 24) {
            return null;
        }
        return `${trimmed}\n`;
    }

    if (extension === '.json') {
        const direct = tryParseJson(trimmed);
        if (direct !== null) {
            return `${JSON.stringify(normalizeStatsLikeJson(direct), null, 2)}\n`;
        }
        for (const block of blocks) {
            const parsed = tryParseJson(block.content);
            if (parsed !== null) {
                return `${JSON.stringify(normalizeStatsLikeJson(parsed), null, 2)}\n`;
            }
        }
        return null;
    }

    if (extension === '.csv') {
        const csvBlockText = pickCodeBlockByExtension(extension, blocks);
        if (!csvBlockText) {
            return null;
        }
        return normalizeCsvDateColumns(csvBlockText);
    }

    if (extension === '.txt') {
        if (isLikelyRefusalOrStatusOnly(trimmed)) {
            return null;
        }
        const codeBlockText = pickCodeBlockByExtension(extension, blocks);
        if (codeBlockText) {
            return `${codeBlockText.trimEnd()}\n`;
        }
        if (!isLikelyNarrativeSummary(trimmed)) {
            return `${trimmed}\n`;
        }
        return null;
    }

    if (
        extension === '.py'
        || extension === '.js'
        || extension === '.ts'
        || extension === '.tsx'
        || extension === '.sql'
        || extension === '.yaml'
        || extension === '.yml'
        || extension === '.xml'
        || extension === '.html'
    ) {
        const codeBlockText = pickCodeBlockByExtension(extension, blocks);
        if (!codeBlockText) {
            return null;
        }
        if (extension === '.py') {
            return `${normalizePythonSource(codeBlockText)}\n`;
        }
        return `${codeBlockText.trimEnd()}\n`;
    }

    return null;
}
