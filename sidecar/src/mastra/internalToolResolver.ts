import { globalToolRegistry } from '../tools/registry';
import { STANDARD_TOOLS } from '../tools/standard';

export type RuntimeResolvedTool = {
    name: string;
    description?: string;
    effects?: string[];
};

const DECLARED_INTERNAL_TOOL_FALLBACKS: Record<string, RuntimeResolvedTool> = {
    search_web: {
        name: 'search_web',
        description: 'Web search with configured providers.',
        effects: ['network:outbound'],
    },
    crawl_url: {
        name: 'crawl_url',
        description: 'Crawl a URL and return page content.',
        effects: ['network:outbound'],
    },
    extract_content: {
        name: 'extract_content',
        description: 'Extract readable content from web pages.',
        effects: ['network:outbound'],
    },
    search_docs: {
        name: 'search_docs',
        description: 'Search documentation index.',
        effects: ['network:outbound'],
    },
    get_doc_page: {
        name: 'get_doc_page',
        description: 'Fetch a documentation page by id or URL.',
        effects: ['network:outbound'],
    },
};

export function resolveRuntimeInternalTool(toolName: string): RuntimeResolvedTool | undefined {
    const normalizedToolName = toolName.trim();
    if (normalizedToolName.length === 0) {
        return undefined;
    }
    const registered = globalToolRegistry.getTool(normalizedToolName)
        ?? STANDARD_TOOLS.find((tool) => tool.name === normalizedToolName);
    if (registered) {
        return {
            name: registered.name,
            description: registered.description,
            effects: [...registered.effects],
        };
    }
    return DECLARED_INTERNAL_TOOL_FALLBACKS[normalizedToolName];
}
