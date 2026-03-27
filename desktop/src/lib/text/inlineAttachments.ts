const IMAGE_TAG_PATTERN =
    /<image_base64 name="([^"]*)" type="([^"]*)">([\s\S]*?)<\/image_base64>/g;
const FILE_TAG_PATTERN =
    /<attached_file name="([^"]*)">\s*([\s\S]*?)\s*<\/attached_file>/g;
const ATTACHMENT_LABEL_PATTERN =
    /^\[Attached (?:image|file):[^\]]+\]\s*$/gim;

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
    const images = [...content.matchAll(IMAGE_TAG_PATTERN)].map((match) => ({
        name: match[1] || 'image',
        mimeType: match[2] || 'image/png',
        dataUrl: `data:${match[2] || 'image/png'};base64,${(match[3] || '').trim()}`,
    }));
    const files = [...content.matchAll(FILE_TAG_PATTERN)].map((match) => ({
        name: match[1] || 'file',
        content: (match[2] || '').trim(),
    }));

    const text = content
        .replace(IMAGE_TAG_PATTERN, '')
        .replace(FILE_TAG_PATTERN, '')
        .replace(ATTACHMENT_LABEL_PATTERN, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return {
        text,
        images,
        files,
    };
}
