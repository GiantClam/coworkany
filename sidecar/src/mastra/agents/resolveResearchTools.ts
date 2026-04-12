import type { Tool } from '@mastra/core/tools';
import { listMcpToolsSafe } from '../mcp/clients';
import { bashTool } from '../tools/bash';
import { searchWebTool } from '../tools/research';

const RESEARCH_TOOL_NAME_PATTERN = /\b(search_web|crawl_url|get_news|check_weather|finance|quote|ticker|stock|market|weather|forecast|websearch)\b/iu;
const MARKET_DATA_TOOL_NAME_PATTERN = /\b(finance|quote|ticker|stock|equity|market|price|ohlc|candlestick|kline|trade|trading|exchange|hkex|nasdaq|nyse)\b|股|港股|美股|行情|股价|涨跌|市值|成交量/iu;

type AnyMastraTool = Tool<any, any, any, any>;
type ResearchToolsMap = Record<string, AnyMastraTool>;

export type ResolveResearchToolsDiagnostics = {
    totalTools: number;
    preferredResearchToolCount: number;
    preferredResearchTools: string[];
    includesBashFallback: boolean;
};

type ResolveResearchToolsDependencies = {
    listMcpToolsFn?: () => Promise<ResearchToolsMap>;
};

export async function resolveResearchTools(
    deps?: ResolveResearchToolsDependencies,
): Promise<{
    tools: ResearchToolsMap;
    diagnostics: ResolveResearchToolsDiagnostics;
}> {
    const listMcpToolsFn = deps?.listMcpToolsFn ?? listMcpToolsSafe;
    const mcpTools = await listMcpToolsFn();
    const builtInResearchTools: ResearchToolsMap = {
        search_web: searchWebTool as AnyMastraTool,
    };
    const builtInToolNames = new Set(Object.keys(builtInResearchTools));
    const allTools: ResearchToolsMap = {
        ...builtInResearchTools,
        ...(mcpTools as ResearchToolsMap),
    };

    const preferredResearchTools = Object.keys(allTools)
        .filter((toolName) => RESEARCH_TOOL_NAME_PATTERN.test(toolName))
        .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));

    const prioritizeTool = (toolName: string): number => {
        if (toolName === 'bash') {
            return -1_000;
        }
        let score = 0;
        if (!builtInToolNames.has(toolName)) {
            score += 1_000;
        }
        if (MARKET_DATA_TOOL_NAME_PATTERN.test(toolName)) {
            score += 300;
        }
        if (RESEARCH_TOOL_NAME_PATTERN.test(toolName)) {
            score += 100;
        }
        if (toolName === 'search_web' && builtInToolNames.has(toolName)) {
            score -= 50;
        }
        return score;
    };

    const orderedEntries = Object.entries(allTools)
        .filter(([toolName]) => toolName !== 'bash')
        .sort((left, right) => {
            const scoreDelta = prioritizeTool(right[0]) - prioritizeTool(left[0]);
            if (scoreDelta !== 0) {
                return scoreDelta;
            }
            return left[0].localeCompare(right[0], 'en', { sensitivity: 'base' });
        });

    const tools: ResearchToolsMap = Object.fromEntries(orderedEntries);
    if (!Object.prototype.hasOwnProperty.call(tools, 'bash')) {
        tools.bash = bashTool as AnyMastraTool;
    }

    const diagnostics: ResolveResearchToolsDiagnostics = {
        totalTools: Object.keys(tools).length,
        preferredResearchToolCount: preferredResearchTools.length,
        preferredResearchTools,
        includesBashFallback: Boolean(tools.bash),
    };

    if (preferredResearchTools.length === 0) {
        console.warn('[coworkany-research-tools] preferred research tools are unavailable; using fallback set.', diagnostics);
    }

    return {
        tools,
        diagnostics,
    };
}
