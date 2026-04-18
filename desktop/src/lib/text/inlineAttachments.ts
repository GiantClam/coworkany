export type InlineImageAttachment = {
    name: string;
    mimeType: string;
    dataUrl: string;
};

export type InlineFileAttachment = {
    name: string;
    content: string;
};

export function parseInlineAttachments(content: string): {
    text: string;
    images: InlineImageAttachment[];
    files: InlineFileAttachment[];
} {
    return {
        text: content.trim(),
        images: [],
        files: [],
    };
}
