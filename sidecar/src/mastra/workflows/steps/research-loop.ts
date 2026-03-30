import { runPreFreezeResearchLoop } from '../../../orchestration/researchLoop';
import type { NormalizedWorkRequest, ResearchEvidence } from '../../../orchestration/workRequestSchema';
export interface ResearchLoopInput {
    normalized: NormalizedWorkRequest;
}
export interface ResearchLoopOutput {
    researchComplete: boolean;
    evidence: ResearchEvidence[];
    normalized: NormalizedWorkRequest;
    userResponses?: Record<string, string>;
}
export async function runResearchLoop(
    input: ResearchLoopInput,
    resumeData?: { answers?: Record<string, string> },
): Promise<ResearchLoopOutput> {
    const normalized = await runPreFreezeResearchLoop({
        request: input.normalized,
    });
    return {
        researchComplete: true,
        evidence: normalized.researchEvidence ?? [],
        normalized,
        userResponses: resumeData?.answers,
    };
}
