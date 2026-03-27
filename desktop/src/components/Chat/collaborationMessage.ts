export const TASK_DRAFT_CONFIRM_TOKEN = '__task_draft_confirm__';
export const TASK_DRAFT_CHAT_TOKEN = '__task_draft_chat__';
export const TASK_DRAFT_EDIT_CREATE_PREFIX = '__task_draft_edit_create__:';
export const AUTH_OPEN_PAGE_PREFIX = '__auth_open_page__:';
export const ROUTE_CHAT_TOKEN = '__route_chat__';
export const ROUTE_TASK_TOKEN = '__route_task__';

function normalizeChoiceText(value: string): string {
    return value.trim().toLowerCase();
}

function isDirectAnswerChoice(value: string): boolean {
    const normalized = normalizeChoiceText(value);
    return normalized.includes('直接回答')
        || normalized.includes('普通回答')
        || normalized.includes('回答')
        || normalized === 'chat'
        || normalized.includes('direct answer');
}

function isTaskChoice(value: string): boolean {
    const normalized = normalizeChoiceText(value);
    return normalized.includes('创建任务')
        || normalized.includes('确认创建')
        || normalized.includes('执行任务')
        || normalized === 'task'
        || normalized.includes('create task');
}

export function encodeTaskCollaborationMessage(input: {
    actionId?: string;
    value: string;
}): string {
    const rawMessage = input.value.trim();
    if (!rawMessage) {
        return '';
    }

    if (input.actionId === 'intent_route') {
        if (isDirectAnswerChoice(rawMessage)) {
            return ROUTE_CHAT_TOKEN;
        }
        if (isTaskChoice(rawMessage)) {
            return ROUTE_TASK_TOKEN;
        }
        return rawMessage;
    }

    if (input.actionId !== 'task_draft_confirm') {
        return rawMessage;
    }

    if (rawMessage === TASK_DRAFT_CONFIRM_TOKEN || rawMessage === TASK_DRAFT_CHAT_TOKEN) {
        return rawMessage;
    }

    if (isDirectAnswerChoice(rawMessage)) {
        return TASK_DRAFT_CHAT_TOKEN;
    }
    if (isTaskChoice(rawMessage)) {
        return TASK_DRAFT_CONFIRM_TOKEN;
    }

    return `${TASK_DRAFT_EDIT_CREATE_PREFIX}${rawMessage}`;
}
