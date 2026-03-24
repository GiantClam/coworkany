import { describe, expect, test } from 'bun:test';
import {
    encodeTaskCollaborationMessage,
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
            actionId: 'intent_route',
            value: ' __route_chat__ ',
        })).toBe('__route_chat__');
    });
});
