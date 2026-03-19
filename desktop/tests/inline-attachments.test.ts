import { describe, expect, test } from 'bun:test';
import { parseInlineAttachments } from '../src/lib/text/inlineAttachments';

describe('parseInlineAttachments', () => {
    test('extracts inline images and removes base64 tags from visible text', () => {
        const raw = [
            '[Attached image: cat.png (image/png)]',
            '',
            '<image_base64 name="cat.png" type="image/png">ZmFrZQ==</image_base64>',
            '',
            '请分析这张图',
        ].join('\n');

        const parsed = parseInlineAttachments(raw);

        expect(parsed.text).toContain('[Attached image: cat.png (image/png)]');
        expect(parsed.text).toContain('请分析这张图');
        expect(parsed.text).not.toContain('ZmFrZQ==');
        expect(parsed.images).toEqual([
            {
                name: 'cat.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,ZmFrZQ==',
            },
        ]);
    });

    test('drops attached file wrappers from visible text', () => {
        const raw = [
            '[Attached file: notes.md]',
            '',
            '<attached_file name="notes.md">',
            '# hidden in bubble',
            '</attached_file>',
        ].join('\n');

        const parsed = parseInlineAttachments(raw);

        expect(parsed.text).toBe('[Attached file: notes.md]');
        expect(parsed.images).toEqual([]);
    });
});
