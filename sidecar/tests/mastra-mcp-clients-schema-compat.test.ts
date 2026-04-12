import { describe, expect, test } from 'bun:test';
import { toStandardSchema } from '@mastra/core/schema';
import { __mcpSchemaCompatForTests } from '../src/mastra/mcp/clients';

function createFakeToolWithInputSchema(inputSchemaFactory: () => unknown) {
    const schema = toStandardSchema(inputSchemaFactory());
    return {
        id: 'fake-tool',
        description: 'fake tool',
        inputSchema: schema,
        execute: async () => ({}),
    } as unknown as Parameters<typeof __mcpSchemaCompatForTests.patchMcpToolForSchemaCompatibility>[1];
}

describe('mastra mcp clients schema compatibility patch', () => {
    test('patches draft-2020-12 MCP tool schemas in-place so validation no longer fails at runtime', () => {
        const tool = createFakeToolWithInputSchema(() => ({
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'Target URL',
                },
                timeout: {
                    type: 'number',
                },
            },
            required: ['url'],
            additionalProperties: false,
            $schema: 'https://json-schema.org/draft/2020-12/schema',
        }));

        const beforeValidation = (
            tool as {
                inputSchema?: {
                    ['~standard']?: {
                        validate?: (value: unknown) => { issues?: Array<{ message?: string }> } | { value?: unknown };
                    };
                };
            }
        ).inputSchema?.['~standard']?.validate?.({ url: 'https://example.com' });
        expect(Array.isArray((beforeValidation as { issues?: unknown[] } | undefined)?.issues)).toBe(true);

        const patched = __mcpSchemaCompatForTests.patchMcpToolForSchemaCompatibility('browser_navigate', tool);
        expect(patched).toBe(tool);

        const afterValidation = (
            patched as {
                inputSchema?: {
                    ['~standard']?: {
                        validate?: (value: unknown) => { issues?: Array<{ message?: string }> } | { value?: unknown };
                    };
                };
            }
        ).inputSchema?.['~standard']?.validate?.({ url: 'https://example.com' });

        const hasIssuesAfterPatch = Array.isArray((afterValidation as { issues?: unknown[] } | undefined)?.issues);
        expect(hasIssuesAfterPatch).toBe(false);
    });

    test('does not patch non-draft-2020-12 schemas', () => {
        const tool = createFakeToolWithInputSchema(() => ({
            type: 'object',
            properties: {
                url: { type: 'string' },
            },
            required: ['url'],
            $schema: 'http://json-schema.org/draft-07/schema#',
        }));

        const patched = __mcpSchemaCompatForTests.patchMcpToolForSchemaCompatibility('browser_navigate', tool);
        expect(patched).toBe(tool);
    });
});
