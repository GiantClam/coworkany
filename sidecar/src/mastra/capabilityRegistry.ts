import { createHash } from 'crypto';
import { analyzeWorkRequest } from '../orchestration/workRequestAnalyzer';
import type { TaskTurnContract, TaskTurnContractDomain, TaskTurnContractMode } from './taskRuntimeState';
import {
    GENERIC_WEB_LOOKUP_PATTERN,
    isBusinessDecisionSupportQuery,
    isCurrentDateTimeQuery,
    isLocalHostOperationIntent,
    isPlatformTrendingLookupQuery,
    MARKET_QUERY_PATTERN,
    NEWS_QUERY_PATTERN,
    VOICE_OUTPUT_REQUEST_PATTERN,
    WEATHER_QUERY_PATTERN,
} from './intentPatterns';

export type TaskCapabilityRequirement = 'web_research' | 'browser_automation' | 'voice_output' | 'command_execution' | 'artifact_write' | 'filesystem_read';

const BROWSER_TASK_HINT_PATTERN = /浏览器|网页|页面|网站|网址|截图|截屏|screenshot|playwright|browser|click|navigate|open\s+(?:https?:\/\/|www\.|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\b)|打开(?:\s*\S+)?\s*(?:网站|网页|网址|https?:\/\/)/iu;
const CODE_OR_WORKSPACE_TASK_PATTERN = /\b(code|coding|bug|fix|refactor|function|class|workspace|repository|repo|terminal|shell|bash|zsh|command|test|build)\b|代码|修复|重构|函数|类|仓库|工作区|终端|命令|测试|构建/iu;
const LOCAL_WORKSPACE_TASK_PATTERN = /\b(ls|dir|pwd|cat|head|tail|grep|rg|find|tree|read_file|view_file|list_dir|file|files|folder|folders|directory|directories|path|local|workspace|repo|repository)\b|文件|目录|文件夹|路径|本地|工作区|仓库|列出|读取|查看(?:文件|目录)|当前目录/iu;
const PATH_LIKE_TOKEN_PATTERN = /(?:^|[\s"'`])(?:(?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:\\)[^\s"'`]+|(?:[A-Za-z0-9._-]+[\\/][^\s"'`]+))/u;
const WEB_RESEARCH_REQUIRED_TOOL_PATTERN = /\b(search_web|crawl_url|get_news|check_weather|finance|quote|ticker|stock|market|weather|forecast)\b/iu;
const BROWSER_REQUIRED_TOOL_PATTERN = /\b(browser_[a-z_]+|playwright|browser|navigate|screenshot|click|fill)\b/iu;
const VOICE_OUTPUT_REQUIRED_TOOL_PATTERN = /\b(voice_speak|tts|text[-\s]?to[-\s]?speech|read\s+aloud|speak)\b|语音|朗读|播报/iu;
const COMMAND_EXECUTION_REQUIRED_TOOL_PATTERN = /\b(run_command|mastra_workspace_execute_command|bash|bash_approval|shell(?:[_\s-]?command)?|terminal(?:[_\s-]?command)?)\b/iu;
const ARTIFACT_WRITE_REQUIRED_TOOL_PATTERN = /\b(write_to_file|replace_file_content|move_file|delete_path|mastra_workspace_write_file|mastra_workspace_replace_in_file|mastra_workspace_rename_file|mastra_workspace_delete_file)\b/iu;
const FILESYSTEM_READ_REQUIRED_TOOL_PATTERN = /\b(list_dir|view_file|read_file|mastra_workspace_list_files|mastra_workspace_read_file|mastra_workspace_file_stat)\b|列出(?:目录|文件)|查看(?:文件|目录)|读取(?:文件)?/iu;
const COMMAND_EXECUTION_INTENT_PATTERN = /\b(run(?:ning)?(?:[_\s-]+(?:command|commands|script))?|run[_\s-]?command(?:s)?|mastra[_\s-]?workspace[_\s-]?execute[_\s-]?command|execute|terminal|shell|bash|zsh|powershell|cmd|npm\s+run|pnpm\s+run|yarn\s+run|bun\s+run|node\s+\S+|python(?:3)?\s+\S+|script|cli|command\s*line|dedupe|delete\s+duplicates?|duplicate\s+(?:files?|images?)|batch\s+(?:process|cleanup)|bulk\s+(?:process|cleanup)|empty\s+(?:the\s+)?(?:trash|recycle\s+bin)|clear\s+(?:the\s+)?(?:trash|recycle\s+bin))\b|运行(?:它|代码|程序|结果|命令|脚本)?(?:并)?(?:验证|测试)?|执行(?:命令|脚本)|终端|命令行|去重|相似(?:文件|图片)|重复(?:文件|图片)|批量(?:处理|清理)|清空(?:回收站|垃圾桶)/iu;
const FILESYSTEM_MUTATION_INTENT_PATTERN = /(?:\b(?:move|rename|copy|delete|remove|relocate)\b[\s\S]{0,24}\b(?:file|files|folder|folders|directory|directories|path)\b)|(?:\b(?:file|files|folder|folders|directory|directories|path)\b[\s\S]{0,24}\b(?:move|rename|copy|delete|remove|relocate)\b)|(?:(?:移动|迁移|重命名|复制|拷贝|删除|移除|整理)[\s\S]{0,24}(?:文件|文件夹|目录|路径))|(?:(?:文件|文件夹|目录|路径)[\s\S]{0,24}(?:移动|迁移|重命名|复制|拷贝|删除|移除|整理))/iu;
const FILESYSTEM_MUTATION_VERB_PATTERN = /\b(move|rename|copy|delete|remove|relocate|mv|cp)\b|移动|迁移|重命名|复制|拷贝|删除|移除/u;
const FILESYSTEM_READ_INTENT_PATTERN = /(?:列出(?:当前)?目录|列出.*目录|列出.*文件|读取(?:文件)?|读一下|查看(?:文件|目录)|查看这个文件|read (?:the )?file|open (?:the )?file|list (?:the )?(?:current )?(?:directory|dir|files?)|view_file|list_dir)/iu;
const ARTIFACT_WRITE_INTENT_PATTERN = /\b(write|save|persist|create|generate|edit|modify|update|rewrite|replace)\b|保存|写入|创建|生成|编辑|修改|更新|重写|替换/iu;
const ARTIFACT_WRITE_NEGATION_PATTERN = /(不要|别|无需|不需要|不用|禁止|请勿).{0,10}(写入|保存|修改|替换|创建|生成)|\bdo\s+not\s+(write|save|modify|replace|create|generate)\b/iu;
const HOST_CONTROL_COMMAND_INTENT_PATTERN = /\b(shutdown|reboot|poweroff|halt|empty\s+(?:the\s+)?(?:trash|recycle\s+bin)|clear\s+(?:the\s+)?(?:trash|recycle\s+bin))\b|关机|重启|清空(?:回收站|垃圾桶)/iu;
const COMMAND_EXECUTION_NEGATION_PATTERN = /(不要|别|无需|不需要|不用|禁止|请勿).{0,10}(运行|执行).{0,10}(命令|脚本|工具)|\bdo\s+not\s+(run|execute)\s+(?:any\s+)?(?:commands?|scripts?|tools?)\b/iu;

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
    if (isCurrentDateTimeQuery(normalized) || isLocalHostOperationIntent(normalized)) {
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
    const hasFilesystemMutationSignal = FILESYSTEM_MUTATION_INTENT_PATTERN.test(input.message)
        || (FILESYSTEM_MUTATION_VERB_PATTERN.test(input.message) && PATH_LIKE_TOKEN_PATTERN.test(input.message));
    const hasFilesystemReadIntentSignal = FILESYSTEM_READ_INTENT_PATTERN.test(input.message);
    const hasGenericLocalHostOperationSignal = isLocalHostOperationIntent(input.message);
    const commandExecutionExplicitlyForbidden = COMMAND_EXECUTION_NEGATION_PATTERN.test(input.message);
    const hasCommandIntentSignal = (
        (
            COMMAND_EXECUTION_INTENT_PATTERN.test(input.message)
            || hasFilesystemMutationSignal
            || hasGenericLocalHostOperationSignal
        )
        && !commandExecutionExplicitlyForbidden
    );
    const hasArtifactWriteIntentSignal = (
        ARTIFACT_WRITE_INTENT_PATTERN.test(input.message)
        && !ARTIFACT_WRITE_NEGATION_PATTERN.test(input.message)
        && (
            hasFilesystemMutationSignal
            || PATH_LIKE_TOKEN_PATTERN.test(input.message)
            || /\b(file|files|path|workspace|repo|repository|code|script|program)\b|文件|路径|工作区|仓库|代码|脚本|程序/iu.test(input.message)
        )
    );
    const hasHostControlIntentSignal = HOST_CONTROL_COMMAND_INTENT_PATTERN.test(input.message);
    const hasBusinessDecisionSupportSignal = isBusinessDecisionSupportQuery(input.message);
    const hasCurrentDateTimeSignal = isCurrentDateTimeQuery(input.message);
    const hasPlatformTrendingLookupSignal = isPlatformTrendingLookupQuery(input.message);
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
    if (preferredTools.some((tool) => ARTIFACT_WRITE_REQUIRED_TOOL_PATTERN.test(tool))) {
        requirements.add('artifact_write');
    }
    if (
        preferredTools.some((tool) => FILESYSTEM_READ_REQUIRED_TOOL_PATTERN.test(tool))
        && hasFilesystemReadIntentSignal
        && !hasFilesystemMutationSignal
    ) {
        requirements.add('filesystem_read');
    }
    if (hasCommandIntentSignal) {
        requirements.add('command_execution');
    }
    // Read-only workspace inspection (e.g., list/view files) can be satisfied via
    // filesystem tools and should not force shell execution evidence.
    if (hasHostControlIntentSignal) {
        requirements.add('command_execution');
    }
    if (hasCurrentDateTimeSignal) {
        requirements.add('command_execution');
    }
    if (hasArtifactWriteIntentSignal) {
        requirements.add('artifact_write');
    }
    if (
        hasGenericExternalLookupSignal
        && !likelyLocalWorkspaceTask
    ) {
        requirements.add('web_research');
    }
    if (hasBusinessDecisionSupportSignal && !likelyLocalWorkspaceTask) {
        requirements.add('web_research');
    }
    if (hasPlatformTrendingLookupSignal && !likelyLocalWorkspaceTask) {
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
    if (requirement === 'artifact_write') {
        return 'artifact_write';
    }
    if (requirement === 'filesystem_read') {
        return 'filesystem_read';
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
