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

function shouldUseInputFirst(collaboration: TaskCardItem['collaboration'] | undefined): boolean {
    if (!collaboration) {
        return false;
    }

    if (collaboration.input) {
        return true;
    }

    if (collaboration.actionId === 'intent_route' || collaboration.actionId === 'task_draft_confirm') {
        return true;
    }

    const hasChoices = (collaboration.choices?.length ?? 0) > 0;
    const hasAction = Boolean(collaboration.action?.label);
    if (hasChoices || hasAction) {
        return false;
    }

    return true;
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

function hardnessLabel(value: TaskCardItem['activeHardness'] | TaskCardItem['primaryHardness']): string {
    switch (value) {
        case 'trivial':
            return 'Quick task';
        case 'bounded':
            return 'Bounded task';
        case 'multi_step':
            return 'Multi-step task';
        case 'externally_blocked':
            return 'Externally blocked';
        case 'high_risk':
            return 'High-risk task';
        default:
            return 'Task';
    }
}

function capabilityLabel(value: NonNullable<TaskCardItem['executionProfile']>['requiredCapabilities'][number]): string {
    switch (value) {
        case 'browser_interaction':
            return 'Browser interaction';
        case 'external_auth':
            return 'Login/account state';
        case 'workspace_write':
            return 'Workspace write';
        case 'host_access':
            return 'Host access';
        case 'human_review':
            return 'Human review';
        default:
            return sanitizeDisplayText(value);
    }
}

function blockingRiskLabel(value: NonNullable<TaskCardItem['executionProfile']>['blockingRisk']): string | undefined {
    switch (value) {
        case 'missing_info':
            return 'Missing information';
        case 'auth':
            return 'Authentication blocker';
        case 'permission':
            return 'Permission blocker';
        case 'manual_step':
            return 'Manual step blocker';
        case 'policy_review':
            return 'Review blocker';
        default:
            return undefined;
    }
}

function capabilityPlanLabel(value: NonNullable<TaskCardItem['capabilityPlan']>['missingCapability']): string | undefined {
    switch (value) {
        case 'existing_skill_gap':
            return 'Missing reusable skill';
        case 'existing_tool_gap':
            return 'Missing reusable tool';
        case 'new_runtime_tool_needed':
            return 'Missing runtime capability';
        case 'workflow_gap':
            return 'Missing workflow capability';
        case 'external_blocker':
            return 'External blocker';
        default:
            return undefined;
    }
}

function resumeReasonLabel(value: TaskCardItem['lastResumeReason']): string | undefined {
    switch (value) {
        case 'capability_review_approved':
            return 'Generated capability approved';
        default:
            return undefined;
    }
}

function resumeReasonSubtitle(value: TaskCardItem['lastResumeReason']): string | undefined {
    switch (value) {
        case 'capability_review_approved':
            return 'Approved the generated capability and resumed the original task.';
        default:
            return undefined;
    }
}

function capabilityReviewLabel(value: TaskCardItem['capabilityReview']): string | undefined {
    switch (value?.status) {
        case 'pending':
            return 'Review state: Generated capability pending review';
        case 'approved':
            return 'Review state: Generated capability approved';
        default:
            return undefined;
    }
}

export function buildTaskCardViewModel(
    item: TaskCardItem,
    options?: {
        layout?: 'timeline' | 'board';
        hiddenSectionLabels?: string[];
        hideResultSection?: boolean;
    },
): TaskCardViewModel {
    const layout = options?.layout ?? 'timeline';
    const hiddenSectionLabels = new Set((options?.hiddenSectionLabels ?? []).map((label) => sanitizeDisplayText(label)));
    const hideResultSection = options?.hideResultSection === true;
    const isSimplifiedTaskCenterCard = layout === 'timeline' && item.id.startsWith('task-center-');
    const executionProfile = item.executionProfile;
    const capabilityPlan = item.capabilityPlan;
    const capabilityReview = item.capabilityReview;
    const primaryHardness = item.primaryHardness ?? executionProfile?.primaryHardness;
    const activeHardness = item.activeHardness ?? primaryHardness;
    const blockingReason = sanitizeDisplayText(item.blockingReason || '');
    const lastResumeReason = item.lastResumeReason;
    const authChoice = item.collaboration?.choices?.find((choice) => choice.value.startsWith('__auth_open_page__:'));
    const authUrl = authChoice?.value.replace('__auth_open_page__:', '').trim() || undefined;
    const sectionViews = item.sections
        .map((section) => ({
            label: sanitizeDisplayText(section.label),
            lines: section.lines
                .map((line) => sanitizeDisplayText(line))
                .filter((line) => line.length > 0),
        }))
        .filter((section) => section.lines.length > 0 && !hiddenSectionLabels.has(section.label));

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

    const executionProfileLines = executionProfile
        ? [
            primaryHardness ? `Primary hardness: ${hardnessLabel(primaryHardness)}` : '',
            activeHardness && activeHardness !== primaryHardness
                ? `Current state: ${hardnessLabel(activeHardness)}`
                : '',
            activeHardness && activeHardness !== primaryHardness && blockingReason
                ? `Current reason: ${blockingReason}`
                : '',
            !blockingReason && resumeReasonLabel(lastResumeReason)
                ? `Resume state: ${resumeReasonLabel(lastResumeReason)}`
                : '',
            executionProfile.requiredCapabilities.length > 0
                ? `Capabilities: ${executionProfile.requiredCapabilities.map(capabilityLabel).join(', ')}`
                : '',
            blockingRiskLabel(executionProfile.blockingRisk),
        ].filter((line): line is string => typeof line === 'string' && line.length > 0)
        : [];
    const capabilityPlanLines = capabilityPlan
        ? [
            capabilityPlanLabel(capabilityPlan.missingCapability),
            capabilityPlan.learningRequired ? 'Capability acquisition required before execution can continue.' : '',
            capabilityPlan.learningRequired ? `Learning scope: ${sanitizeDisplayText(capabilityPlan.learningScope)}` : '',
            capabilityPlan.learningRequired
                ? `Learning budget: ${capabilityPlan.boundedLearningBudget.complexityTier} (${capabilityPlan.boundedLearningBudget.maxRounds} rounds max)`
                : '',
            capabilityReviewLabel(capabilityReview),
            capabilityReview ? sanitizeDisplayText(capabilityReview.summary) : '',
            ...(capabilityPlan.reasons.length > 0 ? [sanitizeDisplayText(capabilityPlan.reasons[0])] : []),
        ].filter((line): line is string => typeof line === 'string' && line.length > 0)
        : [
            capabilityReviewLabel(capabilityReview),
            capabilityReview ? sanitizeDisplayText(capabilityReview.summary) : '',
        ].filter((line): line is string => typeof line === 'string' && line.length > 0);

    const hasAuthOpenChoice = Boolean(
        item.collaboration?.choices?.some((choice) => choice.value.startsWith('__auth_open_page__:'))
    );
    const useInputFirst = shouldUseInputFirst(item.collaboration);

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
                : useInputFirst
                    ? {
                    placeholder: collaborationPlaceholder({
                        actionId: item.collaboration.actionId,
                        question: item.collaboration.questions[0],
                        authUrl,
                    }),
                    submitLabel: '发送',
                }
                    : undefined,
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

    const profileSection = executionProfileLines.length > 0
        ? {
            label: 'Execution profile',
            lines: executionProfileLines,
        }
        : undefined;
    const capabilitySection = capabilityPlanLines.length > 0
        ? {
            label: 'Capability plan',
            lines: capabilityPlanLines,
        }
        : undefined;
    const trimmedSections = presentation === 'card'
        ? ([profileSection, capabilitySection, ...sectionViews].filter(Boolean) as TaskCardSectionViewModel[])
        : [];
    const trimmedTaskSection = presentation === 'card' && taskItems.length > 0
        ? {
            label: 'Tasks',
            items: taskItems,
            hiddenCount: hiddenTaskCount,
        }
        : undefined;
    const trimmedResultSection = presentation === 'card' && !hideResultSection ? resultSection : undefined;
    const hasGenericTitle = sanitizeDisplayText(item.title) === 'Task center';
    const summaryTitle = activeHardness && hasGenericTitle
        ? hardnessLabel(activeHardness)
        : sanitizeDisplayText(item.title);
    const summarySubtitle = executionProfile
        ? (capabilityReview?.status === 'pending' ? sanitizeDisplayText(capabilityReview.summary) : '')
            || sanitizeDisplayText(item.subtitle || '')
            || (capabilityPlan?.learningRequired && blockingReason ? blockingReason : '')
            || (activeHardness && activeHardness !== primaryHardness ? blockingReason : '')
            || (!blockingReason ? resumeReasonSubtitle(lastResumeReason) : '')
            || blockingRiskLabel(executionProfile.blockingRisk)
            || (executionProfile.reasons.length > 0 ? sanitizeDisplayText(executionProfile.reasons[0]) : '')
        : sanitizeDisplayText(item.subtitle || '');

    return {
        id: item.id,
        taskId: item.taskId,
        presentation,
        summary: {
            kind: 'task',
            kicker: activeHardness ? `Hardness: ${hardnessLabel(activeHardness)}` : 'Task center',
            title: summaryTitle,
            subtitle: summarySubtitle || undefined,
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
