export const TASK_DRAFT_CONFIRM_TOKEN = '__task_draft_confirm__';
export const TASK_DRAFT_CHAT_TOKEN = '__task_draft_chat__';
export const TASK_DRAFT_EDIT_CREATE_PREFIX = '__task_draft_edit_create__:';

export function encodeTaskCollaborationMessage(input: {
    actionId?: string;
    value: string;
}): string {
    const rawMessage = input.value.trim();
    if (!rawMessage) {
        return '';
    }

    if (input.actionId !== 'task_draft_confirm') {
        return rawMessage;
    }

    if (rawMessage === TASK_DRAFT_CONFIRM_TOKEN || rawMessage === TASK_DRAFT_CHAT_TOKEN) {
        return rawMessage;
    }

    return `${TASK_DRAFT_EDIT_CREATE_PREFIX}${rawMessage}`;
}
