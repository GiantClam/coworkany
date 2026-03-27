import type { TaskCardItem } from '../../../../types';
import { sanitizeDisplayText } from '../textSanitizer';

export interface TaskCardTaskViewModel {
    id: string;
    title: string;
    statusKey: NonNullable<TaskCardItem['tasks']>[number]['status'];
    statusLabel: string;
    dependenciesText?: string;
}

export interface TaskCardSectionViewModel {
    label: string;
    lines: string[];
}

export interface TaskCardCollaborationViewModel {
    actionId?: string;
    title: string;
    description?: string;
    questions: string[];
    instructions: string[];
    input?: {
        placeholder: string;
        submitLabel: string;
    };
    action?: {
        label: string;
    };
    choices?: Array<{
        label: string;
        value: string;
        tone: 'default' | 'primary' | 'secondary';
    }>;
    hasAuthOpenChoice: boolean;
}

export interface TaskCardViewModel {
    id: string;
    taskId?: string;
    presentation: 'card' | 'input_panel' | 'hidden';
    summary: {
        kind: 'task';
        kicker: string;
        title: string;
        subtitle?: string;
        statusLabel?: string;
        statusTone: 'neutral' | 'running' | 'success' | 'failed';
    };
    layout: 'timeline' | 'board';
    workflowLabel?: string;
    taskSection?: {
        label: string;
        items: TaskCardTaskViewModel[];
        hiddenCount: number;
    };
    sections: TaskCardSectionViewModel[];
    resultSection?: TaskCardSectionViewModel;
    collaboration?: TaskCardCollaborationViewModel;
}

function collaborationPlaceholder(input: {
    actionId?: string;
    question?: string;
    authUrl?: string;
}): string {
    if (input.actionId === 'intent_route') {
        return '输入“直接回答”或“创建任务”';
    }
    if (input.actionId === 'task_draft_confirm') {
        return '输入“确认创建”/“改成普通回答”，或直接输入修改后的任务说明';
    }
    if (input.actionId === 'external_auth') {
        return input.authUrl
            ? `完成登录后输入“已登录”，或直接输入说明。登录地址：${input.authUrl}`
            : '完成登录后输入“已登录”，或直接输入说明';
    }
    return input.question || '输入你的回复';
}

function taskStatusLabel(status: NonNullable<TaskCardItem['tasks']>[number]['status']): string {
    switch (status) {
        case 'in_progress':
            return 'In progress';
        case 'completed':
        case 'complete':
            return 'Completed';
        case 'failed':
            return 'Failed';
        case 'blocked':
            return 'Blocked';
        case 'skipped':
            return 'Skipped';
        default:
            return 'Pending';
    }
}

function cardStatusLabel(status: TaskCardItem['status']): string {
    if (status === 'running') return 'In progress';
    if (status === 'finished') return 'Completed';
    if (status === 'failed') return 'Failed';
    return 'Waiting';
}

export function buildTaskCardViewModel(
    item: TaskCardItem,
    options?: {
        layout?: 'timeline' | 'board';
    },
): TaskCardViewModel {
    const layout = options?.layout ?? 'timeline';
    const isSimplifiedTaskCenterCard = layout === 'timeline' && item.id.startsWith('task-center-');
    const authChoice = item.collaboration?.choices?.find((choice) => choice.value.startsWith('__auth_open_page__:'));
    const authUrl = authChoice?.value.replace('__auth_open_page__:', '').trim() || undefined;
    const sectionViews = item.sections
        .map((section) => ({
            label: sanitizeDisplayText(section.label),
            lines: section.lines
                .map((line) => sanitizeDisplayText(line))
                .filter((line) => line.length > 0),
        }))
        .filter((section) => section.lines.length > 0);

    const displayedTasks = isSimplifiedTaskCenterCard ? (item.tasks ?? []).slice(0, 3) : (item.tasks ?? []);
    const hiddenTaskCount = Math.max((item.tasks?.length ?? 0) - displayedTasks.length, 0);
    const taskItems = displayedTasks.map((task) => ({
        id: task.id,
        title: sanitizeDisplayText(task.title),
        statusKey: task.status,
        statusLabel: taskStatusLabel(task.status),
        dependenciesText: !isSimplifiedTaskCenterCard && task.dependencies.length > 0
            ? `Depends on: ${task.dependencies.join(', ')}`
            : undefined,
    }));

    const resultLines = [
        item.result?.summary || '',
        ...(item.result?.artifacts ?? []).map((artifact) => `Artifact: ${artifact}`),
        ...(item.result?.files ?? []).map((file) => `File changed: ${file}`),
        item.result?.error || '',
        item.result?.suggestion || '',
    ]
        .map((line) => sanitizeDisplayText(line))
        .filter((line) => line.length > 0);

    const resultSection = resultLines.length > 0
        ? {
            label: 'Result',
            lines: isSimplifiedTaskCenterCard ? resultLines.slice(0, 3) : resultLines,
        }
        : undefined;

    const hasAuthOpenChoice = Boolean(
        item.collaboration?.choices?.some((choice) => choice.value.startsWith('__auth_open_page__:'))
    );

    const collaboration = item.collaboration
        ? {
            actionId: item.collaboration.actionId,
            title: sanitizeDisplayText(item.collaboration.title),
            description: sanitizeDisplayText(item.collaboration.description || '') || undefined,
            questions: item.collaboration.questions
                .map((question) => sanitizeDisplayText(question))
                .filter((question) => question.length > 0),
            instructions: item.collaboration.instructions
                .map((instruction) => sanitizeDisplayText(instruction))
                .filter((instruction) => instruction.length > 0),
            input: item.collaboration.input
                ? {
                    placeholder: sanitizeDisplayText(item.collaboration.input.placeholder || 'Type your response'),
                    submitLabel: sanitizeDisplayText(item.collaboration.input.submitLabel || 'Submit'),
                }
                : {
                    placeholder: collaborationPlaceholder({
                        actionId: item.collaboration.actionId,
                        question: item.collaboration.questions[0],
                        authUrl,
                    }),
                    submitLabel: '发送',
                }
                ,
            action: item.collaboration.action
                ? {
                    label: sanitizeDisplayText(item.collaboration.action.label),
                }
                : undefined,
            choices: item.collaboration.choices?.map((choice) => ({
                label: sanitizeDisplayText(choice.label),
                value: choice.value,
                tone: hasAuthOpenChoice
                    ? (choice.value.startsWith('__auth_open_page__:') ? 'secondary' : 'primary')
                    : 'default',
            })) as TaskCardCollaborationViewModel['choices'],
            hasAuthOpenChoice,
        }
        : undefined;

    const presentation: TaskCardViewModel['presentation'] = isSimplifiedTaskCenterCard
        ? (collaboration ? 'input_panel' : 'hidden')
        : 'card';

    const trimmedSections = presentation === 'card' ? sectionViews : [];
    const trimmedTaskSection = presentation === 'card' && taskItems.length > 0
        ? {
            label: 'Tasks',
            items: taskItems,
            hiddenCount: hiddenTaskCount,
        }
        : undefined;
    const trimmedResultSection = presentation === 'card' ? resultSection : undefined;

    return {
        id: item.id,
        taskId: item.taskId,
        presentation,
        summary: {
            kind: 'task',
            kicker: 'Task center',
            title: sanitizeDisplayText(item.title),
            subtitle: sanitizeDisplayText(item.subtitle || '') || undefined,
            statusLabel: item.status ? cardStatusLabel(item.status) : undefined,
            statusTone: item.status === 'running'
                ? 'running'
                : item.status === 'finished'
                    ? 'success'
                    : item.status === 'failed'
                        ? 'failed'
                        : 'neutral',
        },
        layout,
        workflowLabel: item.workflow && !isSimplifiedTaskCenterCard ? `Workflow: ${item.workflow}` : undefined,
        taskSection: trimmedTaskSection,
        sections: trimmedSections,
        resultSection: trimmedResultSection,
        collaboration,
    };
}
