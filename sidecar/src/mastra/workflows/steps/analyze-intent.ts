import { analyzeWorkRequest as analyzeLegacyWorkRequest } from '../../../orchestration/workRequestAnalyzer';
import type {
    NormalizedWorkRequest,
    RequiredCapability,
    TaskHardness,
    WorkMode,
    WorkRequestFollowUpContext,
} from '../../../orchestration/workRequestSchema';

export interface AnalyzeIntentInput {
    userInput: string;
    workspacePath: string;
    followUpContext?: unknown;
}

export interface AnalyzeIntentResult {
    normalized: NormalizedWorkRequest;
    mode: WorkMode;
    hardness: TaskHardness;
    requiredCapabilities: RequiredCapability[];
}

export function analyzeWorkRequest(input: AnalyzeIntentInput): AnalyzeIntentResult {
    const followUpContext = isFollowUpContext(input.followUpContext)
        ? input.followUpContext
        : undefined;

    const normalized = analyzeLegacyWorkRequest({
        sourceText: input.userInput,
        workspacePath: input.workspacePath,
        followUpContext,
    });

    return {
        normalized,
        mode: normalized.mode,
        hardness: normalized.executionProfile?.primaryHardness ?? 'trivial',
        requiredCapabilities: normalized.executionProfile?.requiredCapabilities ?? [],
    };
}

function isFollowUpContext(value: unknown): value is WorkRequestFollowUpContext {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<WorkRequestFollowUpContext>;
    return (
        candidate.baseObjective === undefined || typeof candidate.baseObjective === 'string'
    );
}
