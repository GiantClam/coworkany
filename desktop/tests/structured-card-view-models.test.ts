import { describe, expect, test } from 'bun:test';
import type { TaskCardItem, ToolCallItem } from '../src/types';
import { buildTaskCardViewModel } from '../src/components/Chat/Timeline/components/taskCardViewModel';
import { buildToolCardViewModel } from '../src/components/Chat/Timeline/components/toolCardViewModel';

function makeTaskCard(overrides: Partial<TaskCardItem> = {}): TaskCardItem {
    return {
        id: overrides.id ?? 'task-center-123',
        type: 'task_card',
        timestamp: overrides.timestamp ?? '2026-03-27T10:00:00.000Z',
        title: overrides.title ?? 'Task center',
        subtitle: overrides.subtitle,
        status: overrides.status,
        workflow: overrides.workflow,
        tasks: overrides.tasks,
        collaboration: overrides.collaboration,
        result: overrides.result,
        sections: overrides.sections ?? [],
        taskId: overrides.taskId,
    };
}

function makeToolCall(overrides: Partial<ToolCallItem> = {}): ToolCallItem {
    return {
        id: overrides.id ?? 'tool-1',
        type: 'tool_call',
        timestamp: overrides.timestamp ?? '2026-03-27T10:00:00.000Z',
        toolName: overrides.toolName ?? 'search',
        args: overrides.args ?? { q: 'latest' },
        status: overrides.status ?? 'success',
        result: overrides.result,
    };
}

describe('structured card view models', () => {
    test('buildTaskCardViewModel converts timeline task-center cards into input-first panels', () => {
        const viewModel = buildTaskCardViewModel(makeTaskCard({
            tasks: [
                { id: '1', title: 'A', status: 'pending', dependencies: [] },
                { id: '2', title: 'B', status: 'in_progress', dependencies: ['1'] },
                { id: '3', title: 'C', status: 'completed', dependencies: ['1'] },
                { id: '4', title: 'D', status: 'blocked', dependencies: ['2'] },
            ],
            sections: [
                { label: 'Plan', lines: ['step 1'] },
            ],
            result: {
                summary: 'done',
                files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
            },
            collaboration: {
                actionId: 'task_draft_confirm',
                title: '任务草稿确认',
                description: '请确认如何继续',
                blocking: true,
                questions: ['确认创建任务，或改成普通回答。'],
                instructions: [],
                choices: [
                    { label: '确认创建', value: '__task_draft_confirm__' },
                    { label: '改成普通回答', value: '__task_draft_chat__' },
                ],
            },
        }));

        expect(viewModel.presentation).toBe('input_panel');
        expect(viewModel.taskSection).toBeUndefined();
        expect(viewModel.sections).toEqual([]);
        expect(viewModel.resultSection).toBeUndefined();
        expect(viewModel.collaboration?.input?.placeholder).toContain('确认创建');
    });

    test('buildToolCardViewModel normalizes soft error results', () => {
        const viewModel = buildToolCardViewModel(makeToolCall({
            status: 'success',
            result: '## ❌ Search Failed\nSomething went wrong',
        }));

        expect(viewModel.summary.statusTone).toBe('failed');
        expect(viewModel.summary.statusLabel).toBe('Failed');
        expect(viewModel.summary.preview).toContain('Search Failed');
    });
});
