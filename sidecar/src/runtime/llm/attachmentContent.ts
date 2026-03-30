const IMAGE_TAG_PATTERN =
    /<image_base64 name="([^"]*)" type="([^"]*)">([\s\S]*?)<\/image_base64>/g;
const FILE_TAG_PATTERN =
    /<attached_file name="([^"]*)">\s*([\s\S]*?)\s*<\/attached_file>/g;
const INLINE_ATTACHMENT_PATTERN =
    /<image_base64 name="([^"]*)" type="([^"]*)">([\s\S]*?)<\/image_base64>|<attached_file name="([^"]*)">\s*([\s\S]*?)\s*<\/attached_file>/g;

type TextBlock = {
    type: 'text';
    text: string;
};

type ImageBlock = {
    type: 'image';
    source: {
        type: 'base64';
        mediaType: string;
        data: string;
    };
};

type ParsedAttachmentContent = {
    promptText: string;
    conversationContent: string | Array<TextBlock | ImageBlock>;
    imageCount: number;
    fileCount: number;
};

function normalizeTextChunk(text: string): string {
    return text.replace(/\n{3,}/g, '\n\n').trim();
}

function mergeAdjacentTextBlocks(
    blocks: Array<TextBlock | ImageBlock>
): Array<TextBlock | ImageBlock> {
    const merged: Array<TextBlock | ImageBlock> = [];

    for (const block of blocks) {
        if (block.type !== 'text') {
            merged.push(block);
            continue;
        }

        const text = normalizeTextChunk(block.text);
        if (!text) continue;

        const previous = merged[merged.length - 1];
        if (previous?.type === 'text') {
            previous.text = `${previous.text}\n\n${text}`;
            continue;
        }

        merged.push({ type: 'text', text });
    }

    return merged;
}

export function parseInlineAttachmentContent(rawContent: string): ParsedAttachmentContent {
    const blocks: Array<TextBlock | ImageBlock> = [];
    let imageCount = 0;
    let fileCount = 0;
    let lastIndex = 0;

    for (const match of rawContent.matchAll(INLINE_ATTACHMENT_PATTERN)) {
        const matchIndex = match.index ?? 0;
        const before = rawContent.slice(lastIndex, matchIndex);
        if (before.trim()) {
            blocks.push({ type: 'text', text: before });
        }

        const imageName = match[1];
        const imageMimeType = match[2];
        const imageData = match[3];
        const fileName = match[4];
        const fileContent = match[5];

        if (imageMimeType && imageData) {
            imageCount += 1;
            blocks.push({
                type: 'image',
                source: {
                    type: 'base64',
                    mediaType: imageMimeType,
                    data: imageData.trim(),
                },
            });
        } else if (fileName && fileContent) {
            fileCount += 1;
            blocks.push({
                type: 'text',
                text: fileContent,
            });
        }

        lastIndex = matchIndex + match[0].length;
    }

    const after = rawContent.slice(lastIndex);
    if (after.trim()) {
        blocks.push({ type: 'text', text: after });
    }

    if (imageCount === 0 && fileCount === 0) {
        return {
            promptText: rawContent,
            conversationContent: rawContent,
            imageCount,
            fileCount,
        };
    }

    const conversationBlocks = mergeAdjacentTextBlocks(blocks);
    const promptText = normalizeTextChunk(
        conversationBlocks
            .filter((block): block is TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('\n\n')
    );

    return {
        promptText,
        conversationContent: conversationBlocks,
        imageCount,
        fileCount,
    };
}

export function summarizeInlineAttachmentContent(rawContent: string): {
    imageCount: number;
    fileCount: number;
    textLength: number;
} {
    const imageCount = [...rawContent.matchAll(IMAGE_TAG_PATTERN)].length;
    const fileCount = [...rawContent.matchAll(FILE_TAG_PATTERN)].length;
    const textLength = rawContent.length;
    return {
        imageCount,
        fileCount,
        textLength,
    };
}
