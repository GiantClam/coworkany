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
        executionProfile: overrides.executionProfile,
        primaryHardness: overrides.primaryHardness,
        activeHardness: overrides.activeHardness,
        blockingReason: overrides.blockingReason,
        lastResumeReason: overrides.lastResumeReason,
        capabilityPlan: overrides.capabilityPlan,
        capabilityReview: overrides.capabilityReview,
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

    test('buildTaskCardViewModel keeps external auth collaboration as explicit actions instead of freeform input', () => {
        const viewModel = buildTaskCardViewModel(makeTaskCard({
            executionProfile: {
                primaryHardness: 'high_risk',
                requiredCapabilities: ['browser_interaction', 'external_auth'],
                blockingRisk: 'auth',
                interactionMode: 'action_first',
                executionShape: 'staged',
                reasons: ['Execution may require a real account/login state.'],
            },
            primaryHardness: 'high_risk',
            activeHardness: 'externally_blocked',
            collaboration: {
                actionId: 'auth-login',
                title: 'Login required',
                description: 'Please login to continue publishing.',
                blocking: true,
                questions: [],
                instructions: ['Complete login in browser.'],
                choices: [
                    { label: '打开登录页面', value: '__auth_open_page__:https://x.com/i/flow/login' },
                    { label: '我已登录，继续执行', value: '继续执行' },
                ],
            },
        }));

        expect(viewModel.presentation).toBe('input_panel');
        expect(viewModel.summary.kicker).toBe('Hardness: Externally blocked');
        expect(viewModel.summary.title).toBe('Externally blocked');
        expect(viewModel.summary.subtitle).toContain('Authentication blocker');
        expect(viewModel.collaboration?.input).toBeUndefined();
        expect(viewModel.collaboration?.choices).toEqual([
            expect.objectContaining({ label: '打开登录页面', value: '__auth_open_page__:https://x.com/i/flow/login' }),
            expect.objectContaining({ label: '我已登录，继续执行', value: '继续执行' }),
        ]);
    });

    test('buildTaskCardViewModel prefers explicit blocking reason for shifted runtime hardness', () => {
        const viewModel = buildTaskCardViewModel(makeTaskCard({
            executionProfile: {
                primaryHardness: 'multi_step',
                requiredCapabilities: ['workspace_write'],
                blockingRisk: 'manual_step',
                interactionMode: 'action_first',
                executionShape: 'staged',
                reasons: ['Execution is expected to write files or mutate workspace state.'],
            },
            primaryHardness: 'multi_step',
            activeHardness: 'externally_blocked',
            blockingReason: 'Please log in to continue publishing.',
            sections: [{ label: 'Plan', lines: ['step 1'] }],
        }), { layout: 'board' });

        expect(viewModel.summary.subtitle).toBe('Please log in to continue publishing.');
        expect(viewModel.sections[0]).toEqual({
            label: 'Execution profile',
            lines: [
                'Primary hardness: Multi-step task',
                'Current state: Externally blocked',
                'Current reason: Please log in to continue publishing.',
                'Capabilities: Workspace write',
                'Manual step blocker',
            ],
        });
    });

    test('buildTaskCardViewModel adds execution profile details for card presentation', () => {
        const viewModel = buildTaskCardViewModel(makeTaskCard({
            id: 'task-card-456',
            executionProfile: {
                primaryHardness: 'multi_step',
                requiredCapabilities: ['workspace_write', 'human_review'],
                blockingRisk: 'policy_review',
                interactionMode: 'review_first',
                executionShape: 'staged',
                reasons: ['Execution may require explicit human review or confirmation.'],
            },
            primaryHardness: 'multi_step',
            activeHardness: 'high_risk',
            sections: [{ label: 'Plan', lines: ['step 1'] }],
        }), { layout: 'board' });

        expect(viewModel.summary.kicker).toBe('Hardness: High-risk task');
        expect(viewModel.summary.title).toBe('High-risk task');
        expect(viewModel.sections[0]).toEqual({
            label: 'Execution profile',
            lines: [
                'Primary hardness: Multi-step task',
                'Current state: High-risk task',
                'Capabilities: Workspace write, Human review',
                'Review blocker',
            ],
        });
    });

    test('buildTaskCardViewModel surfaces capability-review resume state on running cards', () => {
        const viewModel = buildTaskCardViewModel(makeTaskCard({
            id: 'task-card-cap-review',
            status: 'running',
            executionProfile: {
                primaryHardness: 'high_risk',
                requiredCapabilities: ['workspace_write', 'human_review'],
                blockingRisk: 'policy_review',
                interactionMode: 'passive_status',
                executionShape: 'staged',
                reasons: ['Generated capability must be reviewed before use.'],
            },
            primaryHardness: 'high_risk',
            activeHardness: 'high_risk',
            lastResumeReason: 'capability_review_approved',
            sections: [{ label: 'Plan', lines: ['resume execution'] }],
        }), { layout: 'board' });

        expect(viewModel.summary.subtitle).toBe('Approved the generated capability and resumed the original task.');
        expect(viewModel.sections[0]).toEqual({
            label: 'Execution profile',
            lines: [
                'Primary hardness: High-risk task',
                'Resume state: Generated capability approved',
                'Capabilities: Workspace write, Human review',
                'Review blocker',
            ],
        });
    });

    test('buildTaskCardViewModel surfaces pending capability review from protocol-backed plan data', () => {
        const viewModel = buildTaskCardViewModel(makeTaskCard({
            id: 'task-card-cap-review-pending',
            status: 'idle',
            executionProfile: {
                primaryHardness: 'high_risk',
                requiredCapabilities: ['workspace_write', 'human_review'],
                blockingRisk: 'policy_review',
                interactionMode: 'review_first',
                executionShape: 'staged',
                reasons: ['Generated capability must be reviewed before use.'],
            },
            capabilityPlan: {
                missingCapability: 'new_runtime_tool_needed',
                learningRequired: true,
                canProceedWithoutLearning: false,
                learningScope: 'runtime_tool',
                replayStrategy: 'resume_from_checkpoint',
                sideEffectRisk: 'write_external',
                userAssistRequired: false,
                userAssistReason: 'none',
                boundedLearningBudget: {
                    complexityTier: 'complex',
                    maxRounds: 4,
                    maxResearchTimeMs: 180000,
                    maxValidationAttempts: 3,
                },
                reasons: ['Coworkany does not have a dedicated validated publish capability for the target platform.'],
            },
            capabilityReview: {
                status: 'pending',
                summary: 'Generated capability requires review before execution can resume.',
                learnedEntityId: 'skill-wechat-official-post',
            },
            sections: [{ label: 'Plan', lines: ['review generated capability'] }],
        }), { layout: 'board' });

        expect(viewModel.summary.subtitle).toBe('Generated capability requires review before execution can resume.');
        expect(viewModel.sections[1]).toEqual({
            label: 'Capability plan',
            lines: [
                'Missing runtime capability',
                'Capability acquisition required before execution can continue.',
                'Learning scope: runtime_tool',
                'Learning budget: complex (4 rounds max)',
                'Review state: Generated capability pending review',
                'Generated capability requires review before execution can resume.',
                'Coworkany does not have a dedicated validated publish capability for the target platform.',
            ],
        });
    });

    test('buildTaskCardViewModel can hide duplicate summary content while preserving structured sections', () => {
        const viewModel = buildTaskCardViewModel(makeTaskCard({
            id: 'task-card-789',
            sections: [
                { label: 'Summary', lines: ['## Final Answer', '- item 1'] },
                { label: 'Plan', lines: ['step 1'] },
            ],
            result: {
                summary: '## Final Answer\n\n- item 1',
                files: ['reports/final.md'],
            },
        }), {
            layout: 'board',
            hiddenSectionLabels: ['Summary'],
            hideResultSection: true,
        });

        expect(viewModel.sections).toEqual([
            {
                label: 'Plan',
                lines: ['step 1'],
            },
        ]);
        expect(viewModel.resultSection).toBeUndefined();
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
