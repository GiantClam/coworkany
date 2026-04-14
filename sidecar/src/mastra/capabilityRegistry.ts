import { createHash } from 'crypto';
import { analyzeWorkRequest } from '../orchestration/workRequestAnalyzer';
import type { TaskTurnContract, TaskTurnContractDomain, TaskTurnContractMode } from './taskRuntimeState';
import {
    GENERIC_WEB_LOOKUP_PATTERN,
    MARKET_QUERY_PATTERN,
    NEWS_QUERY_PATTERN,
    VOICE_OUTPUT_REQUEST_PATTERN,
    WEATHER_QUERY_PATTERN,
} from './intentPatterns';

export type TaskCapabilityRequirement = 'web_research' | 'browser_automation' | 'voice_output' | 'command_execution';

const BROWSER_TASK_HINT_PATTERN = /浏览器|网页|页面|网站|网址|截图|截屏|screenshot|playwright|browser|click|navigate|open\s+(?:https?:\/\/|www\.|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\b)|打开(?:\s*\S+)?\s*(?:网站|网页|网址|https?:\/\/)/iu;
const CODE_OR_WORKSPACE_TASK_PATTERN = /\b(code|coding|bug|fix|refactor|function|class|workspace|repository|repo|terminal|shell|bash|zsh|command|test|build)\b|代码|修复|重构|函数|类|仓库|工作区|终端|命令|测试|构建/iu;
const LOCAL_WORKSPACE_TASK_PATTERN = /\b(ls|dir|pwd|cat|head|tail|grep|rg|find|tree|read_file|view_file|list_dir|file|files|folder|folders|directory|directories|path|local|workspace|repo|repository)\b|文件|目录|文件夹|路径|本地|工作区|仓库|列出|读取|查看(?:文件|目录)|当前目录/iu;
const PATH_LIKE_TOKEN_PATTERN = /(?:^|[\s"'`])(?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:\\)[^\s"'`]+/u;
const WEB_RESEARCH_REQUIRED_TOOL_PATTERN = /\b(search_web|crawl_url|get_news|check_weather|finance|quote|ticker|stock|market|weather|forecast)\b/iu;
const BROWSER_REQUIRED_TOOL_PATTERN = /\b(browser_[a-z_]+|playwright|browser|navigate|screenshot|click|fill)\b/iu;
const VOICE_OUTPUT_REQUIRED_TOOL_PATTERN = /\b(voice_speak|tts|text[-\s]?to[-\s]?speech|read\s+aloud|speak)\b|语音|朗读|播报/iu;
const COMMAND_EXECUTION_REQUIRED_TOOL_PATTERN = /\b(run_command|mastra_workspace_execute_command|bash|bash_approval|shell(?:[_\s-]?command)?|terminal(?:[_\s-]?command)?)\b/iu;
const COMMAND_EXECUTION_INTENT_PATTERN = /\b(run(?:ning)?\s+(?:command|commands|script)?|execute|terminal|shell|bash|zsh|powershell|cmd|npm\s+run|pnpm\s+run|yarn\s+run|bun\s+run|node\s+\S+|python(?:3)?\s+\S+|script|cli|command\s*line|dedupe|delete\s+duplicates?|duplicate\s+(?:files?|images?)|batch\s+(?:process|cleanup)|bulk\s+(?:process|cleanup))\b|运行(?:命令|脚本)|执行(?:命令|脚本)|终端|命令行|去重|相似(?:文件|图片)|重复(?:文件|图片)|批量(?:处理|清理)/iu;

function isLikelyLocalWorkspaceTask(message: string): boolean {
    return CODE_OR_WORKSPACE_TASK_PATTERN.test(message)
        || LOCAL_WORKSPACE_TASK_PATTERN.test(message)
        || PATH_LIKE_TOKEN_PATTERN.test(message);
}

export function normalizeTaskMessageFingerprint(message: string): string {
    const collapsed = message.trim().replace(/\s+/g, ' ');
    return collapsed.length > 0 ? collapsed : message;
}

export function detectTaskIntentDomain(message: string): TaskTurnContractDomain {
    const normalized = message.trim();
    if (!normalized) {
        return 'general';
    }
    if (MARKET_QUERY_PATTERN.test(normalized)) {
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
    const hasGenericExternalLookupSignal = GENERIC_WEB_LOOKUP_PATTERN.test(input.message);
    const likelyLocalWorkspaceTask = isLikelyLocalWorkspaceTask(input.message);
    const normalized = analyzeWorkRequest({
        sourceText: input.message,
        workspacePath: input.workspacePath,
    });
    const hasCommandIntentSignal = COMMAND_EXECUTION_INTENT_PATTERN.test(input.message);
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
    if (preferredTools.some((tool) => VOICE_OUTPUT_REQUIRED_TOOL_PATTERN.test(tool))) {
        requirements.add('voice_output');
    }
    if (
        hasCommandIntentSignal
        && preferredTools.some((tool) => COMMAND_EXECUTION_REQUIRED_TOOL_PATTERN.test(tool))
    ) {
        requirements.add('command_execution');
    }
    if (
        hasGenericExternalLookupSignal
        && !likelyLocalWorkspaceTask
    ) {
        requirements.add('web_research');
    }
    const domain = detectTaskIntentDomain(input.message);
    if (
        (domain === 'market' || domain === 'weather' || domain === 'news')
        && (!likelyLocalWorkspaceTask || hasGenericExternalLookupSignal)
    ) {
        requirements.add('web_research');
    }
    if (domain === 'browser') {
        requirements.add('browser_automation');
    }
    if (VOICE_OUTPUT_REQUEST_PATTERN.test(input.message)) {
        requirements.add('voice_output');
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
    if (requirement === 'voice_output') {
        return 'voice_output';
    }
    if (requirement === 'command_execution') {
        return 'command_execution';
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
