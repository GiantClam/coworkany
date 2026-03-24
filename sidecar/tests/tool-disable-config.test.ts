import { describe, expect, test } from 'bun:test';
import { applyDisabledToolFilter } from '../src/tools/disableTools';
import { buildSendTaskMessageCommand, buildStartTaskCommand } from './helpers/sidecar-harness';

describe('applyDisabledToolFilter', () => {
    test('filters disabled tools by exact name', () => {
        const tools = [
            { name: 'browser_navigate' },
            { name: 'browser_ai_action' },
            { name: 'search_web' },
        ] as any;

        const filtered = applyDisabledToolFilter(tools, ['browser_ai_action']);
        expect(filtered.map((t: any) => t.name)).toEqual(['browser_navigate', 'search_web']);
    });

    test('keeps full list when disabledTools missing', () => {
        const tools = [{ name: 'a' }, { name: 'b' }] as any;
        expect(applyDisabledToolFilter(tools).length).toBe(2);
    });
});

describe('buildStartTaskCommand', () => {
    test('serializes disabledTools into start_task config', () => {
        const command = buildStartTaskCommand({
            taskId: '11111111-1111-4111-8111-111111111111',
            title: 'x-learning',
            userQuery: 'test',
            disabledTools: ['browser_ai_action'],
        } as any);

        const parsed = JSON.parse(command);
        expect(parsed.payload.config.disabledTools).toEqual(['browser_ai_action']);
    });

    test('serializes tool resolution policy into start_task config', () => {
        const command = buildStartTaskCommand({
            taskId: '11111111-1111-4111-8111-111111111111',
            title: 'x-learning',
            userQuery: 'test',
            duplicateResolution: 'prefer_opencli',
            overlapResolution: 'prefer_opencli',
        } as any);

        const parsed = JSON.parse(command);
        expect(parsed.payload.config.duplicateResolution).toBe('prefer_opencli');
        expect(parsed.payload.config.overlapResolution).toBe('prefer_opencli');
    });
});

describe('buildSendTaskMessageCommand', () => {
    test('serializes disabledTools into send_task_message config', () => {
        const command = buildSendTaskMessageCommand({
            taskId: '11111111-1111-4111-8111-111111111111',
            content: 'continue',
            disabledTools: ['browser_ai_action'],
        });

        const parsed = JSON.parse(command);
        expect(parsed.payload.config.disabledTools).toEqual(['browser_ai_action']);
    });

    test('serializes tool resolution policy into send_task_message config', () => {
        const command = buildSendTaskMessageCommand({
            taskId: '11111111-1111-4111-8111-111111111111',
            content: 'continue',
            duplicateResolution: 'prefer_opencli',
            overlapResolution: 'prefer_builtin',
        });

        const parsed = JSON.parse(command);
        expect(parsed.payload.config.duplicateResolution).toBe('prefer_opencli');
        expect(parsed.payload.config.overlapResolution).toBe('prefer_builtin');
    });
});
