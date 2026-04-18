import { describe, expect, test } from 'bun:test';
import { parseInlineAttachments } from '../src/lib/text/inlineAttachments';

describe('parseInlineAttachments', () => {
    test('keeps message text untouched and does not parse legacy inline tags', () => {
        const raw = [
            '[Attached image: cat.png (image/png)]',
            '',
            '<image_base64 name="cat.png" type="image/png">ZmFrZQ==</image_base64>',
            '',
            '请分析这张图',
        ].join('\n');

        const parsed = parseInlineAttachments(raw);

        expect(parsed.text).toBe(raw.trim());
        expect(parsed.images).toEqual([]);
        expect(parsed.files).toEqual([]);
    });

    test('returns plain text for attached file wrappers', () => {
        const raw = [
            '[Attached file: notes.md]',
            '',
            '<attached_file name="notes.md">',
            '# hidden in bubble',
            '</attached_file>',
        ].join('\n');

        const parsed = parseInlineAttachments(raw);

        expect(parsed.text).toBe(raw.trim());
        expect(parsed.images).toEqual([]);
        expect(parsed.files).toEqual([]);
    });
});
