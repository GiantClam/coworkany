import type { Tool } from '@mastra/core/tools';
import { areBuiltinToolpacksEnabled } from '../../config/runtimeProfile';
import { listMcpToolsetsSafe } from '../mcp/clients';
import { resolveCoworkAnyMastraTools } from '../tools/coworkanyToolRegistry';

const RESEARCH_TOOL_NAME_PATTERN = /\b(search_web|crawl_url|get_news|check_weather|finance|quote|ticker|stock|market|weather|forecast|websearch)\b/iu;
const MARKET_DATA_TOOL_NAME_PATTERN = /\b(finance|quote|ticker|stock|equity|market|price|ohlc|candlestick|kline|trade|trading|exchange|hkex|nasdaq|nyse)\b|股|港股|美股|行情|股价|涨跌|市值|成交量/iu;
const RESEARCH_TOOL_KEYWORDS = [
    'search',
    'search_web',
    'crawl',
    'crawl_url',
    'news',
    'get_news',
    'check_weather',
    'weather',
    'forecast',
    'finance',
    'quote',
    'ticker',
    'stock',
    'market',
    'websearch',
] as const;
const GENERIC_WEB_SEARCH_TOOL_KEYWORDS = [
    'search',
    'search_web',
    'websearch',
    'crawl',
    'crawl_url',
    'extract_content',
] as const;
const MARKET_DATA_TOOL_KEYWORDS = [
    'finance',
    'quote',
    'ticker',
    'stock',
    'equity',
    'market',
    'price',
    'ohlc',
    'candlestick',
    'kline',
    'trade',
    'trading',
    'exchange',
    'hkex',
    'nasdaq',
    'nyse',
    '股',
    '港股',
    '美股',
    '行情',
    '股价',
    '涨跌',
    '市值',
    '成交量',
] as const;

type AnyMastraTool = Tool<any, any, any, any>;
type ResearchToolsMap = Record<string, AnyMastraTool>;
type ResearchToolsetsMap = Record<string, ResearchToolsMap>;

export type ResolveResearchToolsDiagnostics = {
    totalTools: number;
    preferredResearchToolCount: number;
    preferredResearchTools: string[];
    includesCommandFallback: boolean;
    /** @deprecated command fallback is now exposed as run_command, not bash. */
    includesBashFallback: boolean;
    namespacedAliasCount: number;
};

type ResolveResearchToolsDependencies = {
    listMcpToolsetsFn?: () => Promise<ResearchToolsetsMap>;
    env?: NodeJS.ProcessEnv;
};

function sanitizeAliasSegment(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'unknown';
}

function tokenizeToolName(name: string): string[] {
    return name
        .trim()
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/u)
        .filter((token) => token.length > 0);
}

function hasKeywordToken(toolName: string, keywords: readonly string[]): boolean {
    if (toolName.trim().length === 0) {
        return false;
    }
    if (keywords === RESEARCH_TOOL_KEYWORDS && RESEARCH_TOOL_NAME_PATTERN.test(toolName)) {
        return true;
    }
    if (keywords === MARKET_DATA_TOOL_KEYWORDS && MARKET_DATA_TOOL_NAME_PATTERN.test(toolName)) {
        return true;
    }
    const tokenSet = new Set(tokenizeToolName(toolName));
    return keywords.some((keyword) => tokenSet.has(keyword.toLowerCase()));
}

function registerToolWithAliasFallback(input: {
    tools: ResearchToolsMap;
    preferredName: string;
    tool: AnyMastraTool;
    aliasHint?: string;
}): { actualName: string; usedAlias: boolean } {
    const preferredName = input.preferredName.trim();
    if (preferredName.length === 0) {
        return {
            actualName: '',
            usedAlias: false,
        };
    }
    const existing = input.tools[preferredName];
    if (!existing || existing === input.tool) {
        input.tools[preferredName] = input.tool;
        return {
            actualName: preferredName,
            usedAlias: false,
        };
    }
    const aliasBase = (
        typeof input.aliasHint === 'string'
            && input.aliasHint.trim().length > 0
            ? input.aliasHint.trim()
            : `mcp_${sanitizeAliasSegment(preferredName)}`
    );
    let aliasName = aliasBase;
    let suffix = 2;
    while (input.tools[aliasName] && input.tools[aliasName] !== input.tool) {
        aliasName = `${aliasBase}_${suffix}`;
        suffix += 1;
    }
    input.tools[aliasName] = input.tool;
    return {
        actualName: aliasName,
        usedAlias: true,
    };
}

export async function resolveResearchTools(
    deps?: ResolveResearchToolsDependencies,
): Promise<{
    tools: ResearchToolsMap;
    diagnostics: ResolveResearchToolsDiagnostics;
}> {
    const listMcpToolsetsFn = deps?.listMcpToolsetsFn ?? listMcpToolsetsSafe;
    const includeBuiltins = areBuiltinToolpacksEnabled(deps?.env ?? process.env);
    const mcpToolsets = includeBuiltins ? await listMcpToolsetsFn() : {};
    const builtInResearchTools: ResearchToolsMap = includeBuiltins
        ? resolveCoworkAnyMastraTools({
            env: deps?.env ?? process.env,
            include: ['search_web', 'crawl_url', 'extract_content'],
        }) as ResearchToolsMap
        : {};
    const commandFallbackTools: ResearchToolsMap = includeBuiltins
        ? resolveCoworkAnyMastraTools({
            env: deps?.env ?? process.env,
            include: ['run_command'],
        }) as ResearchToolsMap
        : {};
    const builtInToolNames = new Set([
        ...Object.keys(builtInResearchTools),
        ...Object.keys(commandFallbackTools),
    ]);
    const allTools: ResearchToolsMap = { ...builtInResearchTools };
    let namespacedAliasCount = 0;

    for (const [serverName, serverTools] of Object.entries(mcpToolsets)) {
        const normalizedServerName = sanitizeAliasSegment(serverName);
        for (const [toolName, tool] of Object.entries(serverTools)) {
            if (toolName === 'bash') {
                continue;
            }
            const safeToolName = toolName.trim();
            if (safeToolName.length === 0) {
                continue;
            }
            const preferAlias = builtInToolNames.has(safeToolName);
            const registered = registerToolWithAliasFallback({
                tools: allTools,
                preferredName: preferAlias
                    ? `mcp_${normalizedServerName}_${sanitizeAliasSegment(safeToolName)}`
                    : safeToolName,
                tool,
                aliasHint: `mcp_${normalizedServerName}_${sanitizeAliasSegment(safeToolName)}`,
            });
            if (registered.usedAlias) {
                namespacedAliasCount += 1;
            }
        }
    }

    const preferredResearchTools = Object.keys(allTools)
        .filter((toolName) => hasKeywordToken(toolName, RESEARCH_TOOL_KEYWORDS))
        .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));

    const prioritizeTool = (toolName: string): number => {
        if (toolName === 'bash' || toolName === 'run_command') {
            return -1_000;
        }
        let score = 0;
        const isBuiltIn = builtInToolNames.has(toolName);
        const isMarketSpecialized = hasKeywordToken(toolName, MARKET_DATA_TOOL_KEYWORDS);
        const isGenericWebSearch = hasKeywordToken(toolName, GENERIC_WEB_SEARCH_TOOL_KEYWORDS);
        if (!isBuiltIn && isMarketSpecialized) {
            score += isGenericWebSearch ? 1_700 : 2_600;
        } else if (toolName === 'search_web' && isBuiltIn) {
            score += 2_000;
        } else if (!isBuiltIn) {
            score += 450;
        } else if (isMarketSpecialized) {
            score += 300;
        }
        if (hasKeywordToken(toolName, RESEARCH_TOOL_KEYWORDS)) {
            score += 100;
        }
        if (toolName.startsWith('mcp_')) {
            score += 20;
        }
        return score;
    };

    const orderedEntries = Object.entries(allTools)
        .filter(([toolName]) => toolName !== 'bash' && toolName !== 'run_command')
        .sort((left, right) => {
            const scoreDelta = prioritizeTool(right[0]) - prioritizeTool(left[0]);
            if (scoreDelta !== 0) {
                return scoreDelta;
            }
            return left[0].localeCompare(right[0], 'en', { sensitivity: 'base' });
        });

    const tools: ResearchToolsMap = Object.fromEntries(orderedEntries);
    if (includeBuiltins && commandFallbackTools.run_command) {
        tools.run_command = commandFallbackTools.run_command;
    }

    const diagnostics: ResolveResearchToolsDiagnostics = {
        totalTools: Object.keys(tools).length,
        preferredResearchToolCount: preferredResearchTools.length,
        preferredResearchTools,
        includesCommandFallback: Boolean(tools.run_command),
        includesBashFallback: Boolean(tools.bash),
        namespacedAliasCount,
    };

    if (preferredResearchTools.length === 0) {
        console.warn('[coworkany-research-tools] preferred research tools are unavailable; using fallback set.', diagnostics);
    }

    return {
        tools,
        diagnostics,
    };
}
