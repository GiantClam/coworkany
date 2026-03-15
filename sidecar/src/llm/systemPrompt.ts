import type { ToolDefinition } from '../tools/standard';

export interface StructuredSystemPrompt {
    skills: string;
    dynamic?: string;
}

export type SystemPromptInput = string | StructuredSystemPrompt | undefined;

export interface AnthropicSystemBlock {
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
}

export function flattenStructuredSystemPrompt(systemPrompt: SystemPromptInput): string | undefined {
    if (!systemPrompt) {
        return undefined;
    }

    if (typeof systemPrompt === 'string') {
        return systemPrompt;
    }

    const combined = [systemPrompt.skills, systemPrompt.dynamic].filter(Boolean).join('\n\n');
    return combined || undefined;
}

export function buildAnthropicSystemBlocks(
    systemPrompt: SystemPromptInput,
    tools?: Array<Pick<ToolDefinition, 'name' | 'description' | 'effects'>>
): AnthropicSystemBlock[] {
    const blocks: AnthropicSystemBlock[] = [];

    if (systemPrompt) {
        if (typeof systemPrompt === 'string') {
            blocks.push({
                type: 'text',
                text: systemPrompt,
            });
        } else {
            if (systemPrompt.skills) {
                blocks.push({
                    type: 'text',
                    text: systemPrompt.skills,
                    cache_control: { type: 'ephemeral' },
                });
            }
            if (systemPrompt.dynamic) {
                blocks.push({
                    type: 'text',
                    text: systemPrompt.dynamic,
                });
            }
            if (tools && tools.length > 0) {
                blocks.push({
                    type: 'text',
                    text: buildToolDescriptions(tools),
                    cache_control: { type: 'ephemeral' },
                });
            }
            return blocks;
        }
    }

    if (tools && tools.length > 0) {
        blocks.push({
            type: 'text',
            text: buildToolDescriptions(tools),
            cache_control: { type: 'ephemeral' },
        });
    }

    return blocks;
}

function buildToolDescriptions(tools: Array<Pick<ToolDefinition, 'name' | 'description' | 'effects'>>): string {
    const toolDescriptions = tools
        .map((tool) => `Tool: ${tool.name}\nDescription: ${tool.description}\nEffects: ${tool.effects.join(', ')}`)
        .join('\n\n');

    return `Available tools:\n\n${toolDescriptions}`;
}
