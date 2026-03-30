import { describe, expect, test } from 'bun:test';
import { parseInlineAttachmentContent } from '../src/runtime/llm/attachmentContent';
import { toOpenAIUserContent } from '../src/llm/openaiMessageContent';

describe('parseInlineAttachmentContent', () => {
    test('converts inline image tags into multimodal content blocks', () => {
        const raw = [
            '[Attached image: cat.png (image/png)]',
            '',
            '<image_base64 name="cat.png" type="image/png">ZmFrZS1pbWFnZS1ieXRlcw==</image_base64>',
            '',
            '请描述这张图',
        ].join('\n');

        const parsed = parseInlineAttachmentContent(raw);

        expect(parsed.promptText).toContain('[Attached image: cat.png (image/png)]');
        expect(parsed.promptText).toContain('请描述这张图');
        expect(parsed.promptText).not.toContain('ZmFrZS1pbWFnZS1ieXRlcw==');
        expect(parsed.imageCount).toBe(1);
        expect(Array.isArray(parsed.conversationContent)).toBe(true);
        expect(parsed.conversationContent).toEqual([
            { type: 'text', text: '[Attached image: cat.png (image/png)]' },
            {
                type: 'image',
                source: {
                    type: 'base64',
                    mediaType: 'image/png',
                    data: 'ZmFrZS1pbWFnZS1ieXRlcw==',
                },
            },
            { type: 'text', text: '请描述这张图' },
        ]);
    });

    test('keeps attached file contents in the prompt text while removing XML wrappers', () => {
        const raw = [
            '[Attached file: notes.md]',
            '',
            '<attached_file name="notes.md">',
            '# Title',
            'detail line',
            '</attached_file>',
            '',
            '继续处理',
        ].join('\n');

        const parsed = parseInlineAttachmentContent(raw);

        expect(parsed.fileCount).toBe(1);
        expect(parsed.promptText).toContain('[Attached file: notes.md]');
        expect(parsed.promptText).toContain('# Title');
        expect(parsed.promptText).toContain('detail line');
        expect(parsed.promptText).toContain('继续处理');
        expect(parsed.promptText).not.toContain('<attached_file');
    });
});

describe('toOpenAIUserContent', () => {
    test('maps image blocks to OpenAI image_url content', () => {
        const result = toOpenAIUserContent([
            { type: 'text', text: '看下这张图' },
            {
                type: 'image',
                source: {
                    type: 'base64',
                    mediaType: 'image/jpeg',
                    data: 'abc123',
                },
            },
        ]);

        expect(result).toEqual([
            { type: 'text', text: '看下这张图' },
            {
                type: 'image_url',
                image_url: {
                    url: 'data:image/jpeg;base64,abc123',
                },
            },
        ]);
    });
});
