import { describe, expect, test } from 'bun:test';
import { cleanNewlines } from '../../src/lib/text/messageProcessor';

describe('cleanNewlines', () => {
    test('collapses obvious extra blank lines', () => {
        const input = '第一段\n\n\n\n第二段\n\n\n第三段';
        expect(cleanNewlines(input)).toBe('第一段\n第二段\n第三段');
    });

    test('preserves fenced code block blank lines', () => {
        const input = [
            '说明',
            '',
            '```ts',
            'const a = 1;',
            '',
            '',
            'const b = 2;',
            '```',
            '',
            '',
            '结束',
        ].join('\n');

        const expected = [
            '说明',
            '```ts',
            'const a = 1;',
            '',
            '',
            'const b = 2;',
            '```',
            '结束',
        ].join('\n');

        expect(cleanNewlines(input)).toBe(expected);
    });

    test('trims trailing spaces on normal text lines', () => {
        const input = 'hello   \n\n\nworld\t\t';
        expect(cleanNewlines(input)).toBe('hello\nworld');
    });

    test('removes extra blank lines around markdown headings', () => {
        const input = [
            '说明',
            '',
            '## 今日日报（4月6日）',
            '',
            '正文',
        ].join('\n');

        expect(cleanNewlines(input)).toBe([
            '说明',
            '## 今日日报（4月6日）',
            '正文',
        ].join('\n'));
    });

    test('removes blank separators between adjacent list items', () => {
        const input = [
            '1. 第一项',
            '',
            '2. 第二项',
            '',
            '3. 第三项',
        ].join('\n');

        expect(cleanNewlines(input)).toBe([
            '1. 第一项',
            '2. 第二项',
            '3. 第三项',
        ].join('\n'));
    });

    test('removes extra blank lines around strong heading-like lines', () => {
        const input = [
            '引言',
            '',
            '**今日完成**',
            '',
            '处理了风险项',
        ].join('\n');

        expect(cleanNewlines(input)).toBe([
            '引言',
            '**今日完成**',
            '处理了风险项',
        ].join('\n'));
    });

    test('normalizes loose markdown list markers for ordered and unordered lines', () => {
        const input = [
            '1.第一项',
            '2）第二项',
            '3、第三项',
            '-第四项',
            '*第五项',
        ].join('\n');

        expect(cleanNewlines(input)).toBe([
            '1. 第一项',
            '2. 第二项',
            '3. 第三项',
            '- 第四项',
            '* 第五项',
        ].join('\n'));
    });
});
