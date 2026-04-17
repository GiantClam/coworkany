import { describe, expect, test } from 'bun:test';
import { deriveFallbackOutputContent } from '../src/ipc/outputMaterializer';

describe('outputMaterializer', () => {
    test('materializes valid JSON from fenced code blocks', () => {
        const assistantText = [
            'Done. Output below:',
            '```json',
            '{"selected_items":["water"],"total_value":6}',
            '```',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/solution.json', assistantText);
        expect(content).toBe('{\n  "selected_items": [\n    "water"\n  ],\n  "total_value": 6\n}\n');
    });

    test('refuses narrative fallback for JSON outputs', () => {
        const assistantText = [
            '# 执行降级交付（超时保护）',
            '已按任务要求准备交付文件。',
            '降级原因：Error: stream_idle_timeout:10000',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/task_plan.json', assistantText);
        expect(content).toBeNull();
    });

    test('extracts fenced python source for code outputs', () => {
        const assistantText = [
            'Implemented CLI:',
            '```python',
            'def main():',
            "    print('ok')",
            '```',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/tasknote.py', assistantText);
        expect(content).toBe("def main():\n    print('ok')\n");
    });

    test('avoids writing narrative summaries into txt outputs', () => {
        const assistantText = [
            'Completed.',
            '- Output file created',
            '- absolute path: /tmp/workspace/result.txt',
        ].join('\n');
        const content = deriveFallbackOutputContent('/tmp/workspace/result.txt', assistantText);
        expect(content).toBeNull();
    });

    test('allows plain non-narrative text for txt outputs', () => {
        const assistantText = '2025-01-15\nContact: support@newdomain.com\n[ ] TODO converted';
        const content = deriveFallbackOutputContent('/tmp/workspace/result.txt', assistantText);
        expect(content).toBe(`${assistantText}\n`);
    });
});
