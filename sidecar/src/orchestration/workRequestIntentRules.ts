import type { IntentRouting } from './workRequestSchema';

export type ForcedRouteCommand = {
    pattern: RegExp;
    intent: IntentRouting['intent'];
};

export const USER_ROUTE_INTENT_MAP: Readonly<Record<string, IntentRouting['intent']>> = {
    chat: 'chat',
    task: 'immediate_task',
    immediate_task: 'immediate_task',
    schedule: 'scheduled_task',
    scheduled_task: 'scheduled_task',
};

export const EXPLICIT_INTENT_COMMANDS: ReadonlyArray<ForcedRouteCommand> = [
    { pattern: /^\/ask\b/i, intent: 'chat' },
    { pattern: /^\/task\b/i, intent: 'immediate_task' },
    { pattern: /^\/schedule\b/i, intent: 'scheduled_task' },
];

export const ROUTED_FOLLOW_UP_PATTERN =
    /^(?:原始任务|Original task)\s*[:：][\s\S]+?\n(?:用户路由|User route)\s*[:：]\s*([a-z_]+)\s*$/i;

export const ROUTE_TOKEN_PATTERN = /^__route_([a-z_]+)__$/i;

export const CHAT_ACK_PATTERN =
    /^(hi|hello|hey|你好|您好|在吗|thanks|thank you|谢谢|收到|ok|好的)[.!?？。!]*$/i;

export const STRUCTURED_CORRECTION_PATTERN =
    /^(?:原始任务|Original task)\s*[:：]\s*([\s\S]+?)\n(?:用户更正|User correction)\s*[:：]\s*([\s\S]*)$/i;

export const STRUCTURED_APPROVAL_PATTERN =
    /^(?:原始任务|Original task)\s*[:：]\s*([\s\S]+?)\n(?:用户确认|User approval)\s*[:：][\s\S]*$/i;

export const STRUCTURED_ROUTE_PATTERN =
    /^(?:原始任务|Original task)\s*[:：]\s*([\s\S]+?)\n(?:用户路由|User route)\s*[:：]\s*([a-z_]+)\s*$/i;

export const STRUCTURED_BASE_ONLY_PATTERN =
    /^(?:原始任务|Original task)\s*[:：]\s*([\s\S]+)$/i;

export function resolveUserRouteIntent(routeRaw: string | undefined): IntentRouting['intent'] | null {
    if (!routeRaw) {
        return null;
    }
    return USER_ROUTE_INTENT_MAP[routeRaw.toLowerCase()] ?? null;
}
