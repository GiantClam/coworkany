import { describe, expect, test } from 'bun:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TaskCardMessage } from '../src/components/Chat/Timeline/components/TaskCardMessage';
import { encodeTaskCollaborationMessage } from '../src/components/Chat/collaborationMessage';
import type { TaskCardItem } from '../src/types';

function makeTaskCard(overrides: Partial<TaskCardItem> = {}): TaskCardItem {
    return {
        id: overrides.id ?? 'card-1',
        taskId: overrides.taskId ?? 'task-1',
        type: 'task_card',
        timestamp: overrides.timestamp ?? '2026-03-24T10:00:00.000Z',
        title: overrides.title ?? 'Task center',
        sections: overrides.sections ?? [],
        collaboration: overrides.collaboration,
        subtitle: overrides.subtitle,
        workflow: overrides.workflow,
        tasks: overrides.tasks,
        result: overrides.result,
        status: overrides.status,
    };
}

function getButtonByText(renderer: ReactTestRenderer, label: string) {
    return renderer.root.findAllByType('button').find((button) => {
        const children = button.props.children;
        if (typeof children === 'string') {
            return children === label;
        }
        if (Array.isArray(children)) {
            return children.join('') === label;
        }
        return false;
    });
}

describe('TaskCardMessage interactions', () => {
    test('submits input-only draft confirmation text without rendering choice buttons', async () => {
        const submitCalls: Array<{
            taskId?: string;
            cardId: string;
            actionId?: string;
            value: string;
        }> = [];
        const item = makeTaskCard({
            id: 'card-draft-choice',
            taskId: 'task-draft-choice',
            collaboration: {
                actionId: 'task_draft_confirm',
                title: '任务草稿确认',
                description: '请选择处理方式',
                blocking: true,
                questions: [],
                instructions: [],
                choices: [
                    { label: '确认创建', value: '__task_draft_confirm__' },
                    { label: '改成普通回答', value: '__task_draft_chat__' },
                ],
            },
        });

        const renderer = create(
            <TaskCardMessage
                item={item}
                onTaskCollaborationSubmit={(input) => submitCalls.push(input)}
            />
        );
        await act(async () => {});

        expect(getButtonByText(renderer, '确认创建')).toBeUndefined();
        expect(getButtonByText(renderer, '改成普通回答')).toBeUndefined();

        const input = renderer.root.findByType('input');
        const submitButton = getButtonByText(renderer, '发送');
        expect(submitButton).toBeDefined();

        await act(async () => {
            input.props.onChange({
                target: { value: '确认创建' },
                currentTarget: { value: '确认创建' },
            });
        });
        await act(async () => {
            submitButton?.props.onClick();
        });

        expect(submitCalls).toEqual([
            {
                taskId: 'task-draft-choice',
                cardId: 'card-draft-choice',
                actionId: 'task_draft_confirm',
                value: '确认创建',
            },
        ]);
        expect(encodeTaskCollaborationMessage({
            actionId: submitCalls[0]?.actionId,
            value: submitCalls[0]?.value ?? '',
        })).toBe('__task_draft_confirm__');
    });

    test('submits edited draft input and can be encoded into edit-create token', async () => {
        const submitCalls: Array<{
            taskId?: string;
            cardId: string;
            actionId?: string;
            value: string;
        }> = [];

        const item = makeTaskCard({
            id: 'card-draft-edit',
            taskId: 'task-draft-edit',
            collaboration: {
                actionId: 'task_draft_confirm',
                title: '任务草稿确认',
                description: '你也可以编辑后创建',
                blocking: true,
                questions: [],
                instructions: [],
                input: {
                    placeholder: '输入修改后的任务说明（可选）',
                    submitLabel: '编辑后创建',
                },
            },
        });

        const renderer = create(
            <TaskCardMessage
                item={item}
                onTaskCollaborationSubmit={(input) => submitCalls.push(input)}
            />
        );
        await act(async () => {});

        const input = renderer.root.findByType('input');
        expect(getButtonByText(renderer, '编辑后创建')).toBeDefined();

        await act(async () => {
            input.props.onChange({
                target: { value: '  改为生成双语周报并保存到 reports/weekly-bilingual.md  ' },
                currentTarget: { value: '  改为生成双语周报并保存到 reports/weekly-bilingual.md  ' },
            });
        });
        expect(renderer.root.findByType('input').props.value).toBe('  改为生成双语周报并保存到 reports/weekly-bilingual.md  ');
        const submitButton = getButtonByText(renderer, '编辑后创建');
        expect(submitButton).toBeDefined();
        await act(async () => {
            submitButton?.props.onClick();
        });

        expect(submitCalls).toEqual([
            {
                taskId: 'task-draft-edit',
                cardId: 'card-draft-edit',
                actionId: 'task_draft_confirm',
                value: '改为生成双语周报并保存到 reports/weekly-bilingual.md',
            },
        ]);

        const encoded = encodeTaskCollaborationMessage({
            actionId: submitCalls[0]?.actionId,
            value: submitCalls[0]?.value ?? '',
        });
        expect(encoded).toBe('__task_draft_edit_create__:改为生成双语周报并保存到 reports/weekly-bilingual.md');
    });
});
