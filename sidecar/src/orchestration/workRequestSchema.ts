import type { LocalTaskPlanHint } from './localTaskIntent';
import type { ResolvedFolderReference } from '../system/wellKnownFolders';

export type WorkMode =
    | 'chat'
    | 'immediate_task'
    | 'scheduled_task'
    | 'scheduled_multi_task';

export type PresentationContract = {
    uiFormat: 'chat_message' | 'table' | 'report' | 'artifact';
    ttsEnabled: boolean;
    ttsMode: 'summary' | 'full';
    ttsMaxChars: number;
    language: string;
};

export type TaskDefinition = {
    id: string;
    title: string;
    objective: string;
    constraints: string[];
    acceptanceCriteria: string[];
    dependencies: string[];
    preferredSkills: string[];
    preferredTools: string[];
    preferredWorkflow?: string;
    resolvedTargets?: ResolvedFolderReference[];
    localPlanHint?: LocalTaskPlanHint;
};

export type ClarificationDecision = {
    required: boolean;
    reason?: string;
    questions: string[];
    missingFields: string[];
    canDefault: boolean;
    assumptions: string[];
};

export type NormalizedWorkRequest = {
    schemaVersion: 1;
    mode: WorkMode;
    sourceText: string;
    workspacePath: string;
    schedule?: {
        executeAt?: string;
        timezone: string;
        recurrence?: null | { kind: 'rrule'; value: string };
    };
    tasks: TaskDefinition[];
    clarification: ClarificationDecision;
    presentation: PresentationContract;
    createdAt: string;
};

export type FrozenWorkRequest = NormalizedWorkRequest & {
    id: string;
    frozenAt: string;
};

export type ExecutionPlan = {
    workRequestId: string;
    runMode: 'single' | 'dag';
    steps: Array<{
        stepId: string;
        taskId?: string;
        kind: 'analysis' | 'clarification' | 'execution' | 'reduction' | 'presentation';
        title: string;
        description: string;
        status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
        dependencies: string[];
    }>;
};

export type PresentationPayload = {
    canonicalResult: string;
    uiSummary: string;
    ttsSummary: string;
    artifacts: string[];
};
