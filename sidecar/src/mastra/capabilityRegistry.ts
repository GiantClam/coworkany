import { createHash } from 'crypto';
import { analyzeWorkRequest } from '../orchestration/workRequestAnalyzer';
import type { TaskTurnContract, TaskTurnContractDomain, TaskTurnContractMode } from './taskRuntimeState';

export type TaskCapabilityRequirement = 'web_research' | 'browser_automation';

const MARKET_DATA_QUERY_PATTERN = /\b(stock|stocks|share|shares|price|prices|quote|quotes|market|markets|equity|equities|finance|financial|ticker|tickers|hkex|nasdaq|nyse|a-share|a股|港股|美股|股价|行情|涨跌|走势|市值|成交量|成交额|开盘|收盘|最高|最低)\b|股|港股|美股|行情|股价|涨跌|走势|市值|成交量|成交额|开盘|收盘|最高|最低/iu;
const WEATHER_QUERY_PATTERN = /\b(weather|forecast|temperature|humidity|rain|snow|wind|uv|aqi|air quality|meteo)\b|天气|气温|温度|湿度|降雨|下雨|下雪|风力|空气质量|预报/iu;
const NEWS_QUERY_PATTERN = /\b(news|headlines?|breaking|latest|today(?:'s)?|trend(?:ing)?)\b|新闻|资讯|快讯|头条|最新|趋势/iu;
const BROWSER_TASK_HINT_PATTERN = /浏览器|网页|页面|截图|截屏|screenshot|playwright|browser|click|navigate|打开网站|open\s+https?:\/\/|打开\s*https?:\/\//iu;
const GENERIC_WEB_LOOKUP_PATTERN = /\b(latest|current|today|this week|real[-\s]?time|price|trend|market|weather|forecast|news|search|lookup|find)\b|今天|本周|这周|最新|当前|实时|价格|走势|趋势|新闻|资讯|天气|预报|汇率|票房|评分|数据|查询|检索/iu;
const CODE_OR_WORKSPACE_TASK_PATTERN = /\b(code|coding|bug|fix|refactor|function|class|workspace|repository|repo|terminal|shell|bash|zsh|command|test|build)\b|代码|修复|重构|函数|类|仓库|工作区|终端|命令|测试|构建/iu;
const WEB_RESEARCH_REQUIRED_TOOL_PATTERN = /\b(search_web|crawl_url|get_news|check_weather|finance|quote|ticker|stock|market|weather|forecast)\b/iu;
const BROWSER_REQUIRED_TOOL_PATTERN = /\b(browser_[a-z_]+|playwright|browser|navigate|screenshot|click|fill)\b/iu;

export function normalizeTaskMessageFingerprint(message: string): string {
    const collapsed = message.trim().replace(/\s+/g, ' ');
    return collapsed.length > 0 ? collapsed : message;
}

export function detectTaskIntentDomain(message: string): TaskTurnContractDomain {
    const normalized = message.trim();
    if (!normalized) {
        return 'general';
    }
    if (MARKET_DATA_QUERY_PATTERN.test(normalized)) {
        return 'market';
    }
    if (WEATHER_QUERY_PATTERN.test(normalized)) {
        return 'weather';
    }
    if (NEWS_QUERY_PATTERN.test(normalized)) {
        return 'news';
    }
    if (BROWSER_TASK_HINT_PATTERN.test(normalized)) {
        return 'browser';
    }
    return 'general';
}

function normalizeCapabilityValues(values: string[]): string[] {
    return Array.from(new Set(
        values
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
    ));
}

export function resolveTaskCapabilityRequirements(input: {
    message: string;
    workspacePath: string;
}): TaskCapabilityRequirement[] {
    const requirements = new Set<TaskCapabilityRequirement>();
    const normalized = analyzeWorkRequest({
        sourceText: input.message,
        workspacePath: input.workspacePath,
    });
    const preferredTools = normalizeCapabilityValues(
        normalized.tasks.flatMap((task) => task.preferredTools ?? []),
    );
    const researchQueries = Array.isArray(normalized.researchQueries)
        ? normalized.researchQueries
        : [];
    if (preferredTools.some((tool) => WEB_RESEARCH_REQUIRED_TOOL_PATTERN.test(tool))) {
        requirements.add('web_research');
    }
    if (researchQueries.some((query) => query.source === 'web')) {
        requirements.add('web_research');
    }
    if (preferredTools.some((tool) => BROWSER_REQUIRED_TOOL_PATTERN.test(tool))) {
        requirements.add('browser_automation');
    }
    if (
        GENERIC_WEB_LOOKUP_PATTERN.test(input.message)
        && !CODE_OR_WORKSPACE_TASK_PATTERN.test(input.message)
    ) {
        requirements.add('web_research');
    }
    const domain = detectTaskIntentDomain(input.message);
    if (domain === 'market' || domain === 'weather' || domain === 'news') {
        requirements.add('web_research');
    }
    if (domain === 'browser') {
        requirements.add('browser_automation');
    }
    return [...requirements.values()];
}

export function formatTaskCapabilityRequirement(requirement: TaskCapabilityRequirement): string {
    if (requirement === 'web_research') {
        return 'web_research';
    }
    if (requirement === 'browser_automation') {
        return 'browser_automation';
    }
    return requirement;
}

export function buildTaskTurnContract(input: {
    message: string;
    workspacePath: string;
    mode: TaskTurnContractMode;
    route: 'direct' | 'workflow';
    requiredCapabilities?: string[];
    createdAt: string;
}): TaskTurnContract {
    const messageFingerprint = normalizeTaskMessageFingerprint(input.message);
    const requiredCapabilities = normalizeCapabilityValues(
        input.requiredCapabilities ?? resolveTaskCapabilityRequirements({
            message: input.message,
            workspacePath: input.workspacePath,
        }).map(formatTaskCapabilityRequirement),
    );
    const domain = detectTaskIntentDomain(input.message);
    const hashPayload = JSON.stringify({
        mode: input.mode,
        domain,
        route: input.route,
        requiredCapabilities,
        messageFingerprint,
    });
    const hash = createHash('sha1').update(hashPayload).digest('hex');
    return {
        hash,
        mode: input.mode,
        domain,
        route: input.route,
        messageFingerprint,
        requiredCapabilities,
        createdAt: input.createdAt,
    };
}

export function buildTaskMessageDispatchKey(input: {
    message: string;
    route: 'direct' | 'workflow';
    mode: TaskTurnContractMode;
    contractHash?: string;
}): string {
    const messageFingerprint = normalizeTaskMessageFingerprint(input.message);
    const hash = typeof input.contractHash === 'string' && input.contractHash.trim().length > 0
        ? input.contractHash.trim()
        : 'no-contract';
    return `${input.mode}:${input.route}:${hash}:${messageFingerprint}`;
}
