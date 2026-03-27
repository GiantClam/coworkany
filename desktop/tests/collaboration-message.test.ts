import { describe, expect, test } from 'bun:test';
import {
    encodeTaskCollaborationMessage,
    ROUTE_CHAT_TOKEN,
    ROUTE_TASK_TOKEN,
    TASK_DRAFT_CHAT_TOKEN,
    TASK_DRAFT_CONFIRM_TOKEN,
    TASK_DRAFT_EDIT_CREATE_PREFIX,
} from '../src/components/Chat/collaborationMessage';

describe('encodeTaskCollaborationMessage', () => {
    test('keeps direct draft-choice tokens unchanged', () => {
        expect(encodeTaskCollaborationMessage({
            actionId: 'task_draft_confirm',
            value: TASK_DRAFT_CONFIRM_TOKEN,
        })).toBe(TASK_DRAFT_CONFIRM_TOKEN);
        expect(encodeTaskCollaborationMessage({
            actionId: 'task_draft_confirm',
            value: TASK_DRAFT_CHAT_TOKEN,
        })).toBe(TASK_DRAFT_CHAT_TOKEN);
    });

    test('prefixes custom edited objective for task draft confirmation submissions', () => {
        expect(encodeTaskCollaborationMessage({
            actionId: 'task_draft_confirm',
            value: '  生成并发布周报  ',
        })).toBe(`${TASK_DRAFT_EDIT_CREATE_PREFIX}生成并发布周报`);
    });

    test('returns trimmed raw input for non-draft collaboration actions', () => {
        expect(encodeTaskCollaborationMessage({
            actionId: 'clarification',
            value: '  补充一下需要双语输出  ',
        })).toBe('补充一下需要双语输出');
    });

    test('maps freeform route disambiguation input to canonical route tokens', () => {
        expect(encodeTaskCollaborationMessage({
            actionId: 'intent_route',
            value: '直接回答',
        })).toBe(ROUTE_CHAT_TOKEN);
        expect(encodeTaskCollaborationMessage({
            actionId: 'intent_route',
            value: '创建任务',
        })).toBe(ROUTE_TASK_TOKEN);
    });

    test('maps freeform task-draft confirmation input to canonical tokens', () => {
        expect(encodeTaskCollaborationMessage({
            actionId: 'task_draft_confirm',
            value: '改成普通回答',
        })).toBe(TASK_DRAFT_CHAT_TOKEN);
        expect(encodeTaskCollaborationMessage({
            actionId: 'task_draft_confirm',
            value: '确认创建',
        })).toBe(TASK_DRAFT_CONFIRM_TOKEN);
    });
});
