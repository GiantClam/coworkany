export type MultiAgentIntentSignal = {
    explicitKeyword: boolean;
    roleHintCount: number;
    stagedWorkflow: boolean;
    weightedScore: number;
    shouldUseMultiAgent: boolean;
};

export const MULTI_AGENT_EXECUTION_CONTRACT_MARKER = '[CoworkAny Multi-Agent Contract]';

const MULTI_AGENT_KEYWORD_PATTERN = /\b(multi[-\s]?agent|sub-?agent|subagent|delegate|delegation|orchestrate|orchestration|supervisor)\b|多智能体|多代理|子代理|委派|编排|协作|主管代理/iu;
const MULTI_AGENT_ROLE_HINT_PATTERN = /\b(developer|reviewer|planner|researcher|coder|backend|frontend|test(?:er)?|qa|docs?|synthesizer|pro|con|analyst)\b|开发|评审|规划|研究|后端|前端|测试|文档|综合|正方|反方|分析/giu;
const MULTI_STAGE_WORKFLOW_PATTERN = /\b(stage\s*\d+|round\s*\d+|phase\s*\d+|handoff|pipeline|debate)\b|第[一二三四五六七八九十\d]+轮|阶段|流水线|交接|辩论/iu;

function resolveBooleanEnv(
    env: Record<string, string | undefined>,
    name: string,
    fallback: boolean,
): boolean {
    const raw = env[name];
    if (!raw) {
        return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false;
    }
    return fallback;
}

export function detectMultiAgentIntent(message: string): MultiAgentIntentSignal {
    const normalized = typeof message === 'string' ? message.trim() : '';
    if (normalized.length === 0) {
        return {
            explicitKeyword: false,
            roleHintCount: 0,
            stagedWorkflow: false,
            weightedScore: 0,
            shouldUseMultiAgent: false,
        };
    }
    const explicitKeyword = MULTI_AGENT_KEYWORD_PATTERN.test(normalized);
    const roleHintCount = Array.from(normalized.matchAll(MULTI_AGENT_ROLE_HINT_PATTERN)).length;
    const stagedWorkflow = MULTI_STAGE_WORKFLOW_PATTERN.test(normalized);
    const weightedScore = (explicitKeyword ? 2 : 0) + Math.min(roleHintCount, 3) + (stagedWorkflow ? 1 : 0);
    // Avoid over-triggering on ordinary execution prompts that contain incidental role-like words
    // (e.g. "测试/analyst/review" in a single-agent instruction).
    const shouldUseMultiAgent = explicitKeyword || (roleHintCount >= 2 && stagedWorkflow);
    return {
        explicitKeyword,
        roleHintCount,
        stagedWorkflow,
        weightedScore,
        shouldUseMultiAgent,
    };
}

export function shouldEnableAgentNetworkExecution(input: {
    message: string;
    forcedRouteMode?: 'chat' | 'task';
    selectedAgent: 'chatResponder' | 'researcher' | 'supervisor';
    useDirectChatResponder: boolean;
    env?: Record<string, string | undefined>;
}): {
    enabled: boolean;
    signal: MultiAgentIntentSignal;
    reason:
        | 'disabled_by_env'
        | 'chat_route'
        | 'direct_chat_responder'
        | 'non_supervisor_route'
        | 'prefer_supervisor_stream'
        | 'multi_agent_signal'
        | 'no_multi_agent_signal';
} {
    const env = input.env ?? process.env;
    const globalEnabled = resolveBooleanEnv(env, 'COWORKANY_MASTRA_ENABLE_AGENT_NETWORK', true);
    const taskEnabled = resolveBooleanEnv(env, 'COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK', true);
    if (!globalEnabled || !taskEnabled) {
        return {
            enabled: false,
            signal: detectMultiAgentIntent(input.message),
            reason: 'disabled_by_env',
        };
    }
    if (input.forcedRouteMode !== 'task') {
        return {
            enabled: false,
            signal: detectMultiAgentIntent(input.message),
            reason: 'chat_route',
        };
    }
    if (input.useDirectChatResponder) {
        return {
            enabled: false,
            signal: detectMultiAgentIntent(input.message),
            reason: 'direct_chat_responder',
        };
    }
    if (input.selectedAgent !== 'supervisor') {
        return {
            enabled: false,
            signal: detectMultiAgentIntent(input.message),
            reason: 'non_supervisor_route',
        };
    }
    const preferAgentNetwork = resolveBooleanEnv(env, 'COWORKANY_MASTRA_PREFER_AGENT_NETWORK', false);
    const signal = detectMultiAgentIntent(input.message);
    if (!signal.shouldUseMultiAgent) {
        return {
            enabled: false,
            signal,
            reason: 'no_multi_agent_signal',
        };
    }
    if (!preferAgentNetwork) {
        return {
            enabled: false,
            signal,
            reason: 'prefer_supervisor_stream',
        };
    }
    return {
        enabled: true,
        signal,
        reason: 'multi_agent_signal',
    };
}

export function injectMultiAgentExecutionContract(input: {
    message: string;
    signal: MultiAgentIntentSignal;
}): string {
    const message = typeof input.message === 'string' ? input.message : '';
    if (message.includes(MULTI_AGENT_EXECUTION_CONTRACT_MARKER)) {
        return message;
    }
    if (!input.signal.shouldUseMultiAgent) {
        return message;
    }
    const contract = [
        MULTI_AGENT_EXECUTION_CONTRACT_MARKER,
        '- Decompose the task into explicit role-owned sub-tasks before execution.',
        '- Delegate role-owned work to at least two agent roles and keep role boundaries explicit.',
        '- Persist each role output as auditable artifacts/logs inside workspace when files are requested.',
        '- Integrate delegated outputs, verify consistency, and report integration evidence.',
        '- Never fabricate delegated outputs before they are produced.',
    ].join('\n');
    return `${contract}\n\n${message}`;
}
