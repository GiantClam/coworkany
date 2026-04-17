import path from 'node:path';

type FencedBlock = {
    language: string;
    content: string;
};

const FENCED_BLOCK_PATTERN = /```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```/g;

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
        return `${trimmed}\n`;
    }

    if (extension === '.json') {
        const direct = tryParseJson(trimmed);
        if (direct !== null) {
            return `${JSON.stringify(direct, null, 2)}\n`;
        }
        for (const block of blocks) {
            const parsed = tryParseJson(block.content);
            if (parsed !== null) {
                return `${JSON.stringify(parsed, null, 2)}\n`;
            }
        }
        return null;
    }

    if (extension === '.txt') {
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
        || extension === '.csv'
        || extension === '.xml'
        || extension === '.html'
    ) {
        const codeBlockText = pickCodeBlockByExtension(extension, blocks);
        if (!codeBlockText) {
            return null;
        }
        return `${codeBlockText.trimEnd()}\n`;
    }

    return null;
}
