import { describe, expect, test } from 'bun:test';

import { buildAnthropicSystemBlocks, flattenStructuredSystemPrompt } from '../src/llm/systemPrompt';

describe('system prompt serialization', () => {
    test('anthropic blocks keep stable skills cached and dynamic instructions separate', () => {
        const blocks = buildAnthropicSystemBlocks(
            {
                skills: '## Stable\nSkill catalog and stable instructions',
                dynamic: '## Dynamic\nOnly route weather-helper for this turn',
            },
            [
                {
                    name: 'search_web',
                    description: 'Search the public web',
                    effects: ['network:outbound'],
                },
            ]
        );

        expect(blocks).toHaveLength(3);
        expect(blocks[0]).toEqual({
            type: 'text',
            text: '## Stable\nSkill catalog and stable instructions',
            cache_control: { type: 'ephemeral' },
        });
        expect(blocks[1]).toEqual({
            type: 'text',
            text: '## Dynamic\nOnly route weather-helper for this turn',
        });
        expect(blocks[2]?.text).toContain('Tool: search_web');
        expect(blocks[2]?.cache_control).toEqual({ type: 'ephemeral' });
    });

    test('anthropic string prompts remain a single uncached text block', () => {
        const blocks = buildAnthropicSystemBlocks('Use the legacy prompt format.');

        expect(blocks).toEqual([
            {
                type: 'text',
                text: 'Use the legacy prompt format.',
            },
        ]);
    });

    test('flattened prompt joins stable and dynamic sections for plain-text providers', () => {
        const flattened = flattenStructuredSystemPrompt({
            skills: 'Stable section',
            dynamic: 'Dynamic section',
        });

        expect(flattened).toBe('Stable section\n\nDynamic section');
    });

    test('flattened prompt omits empty dynamic section', () => {
        const flattened = flattenStructuredSystemPrompt({
            skills: 'Stable section only',
        });

        expect(flattened).toBe('Stable section only');
    });
});
