import path from 'path';
import { runPreFreezeResearchLoop } from '../../../orchestration/researchLoop';
import type { NormalizedWorkRequest, ResearchEvidence } from '../../../orchestration/workRequestSchema';
import { WorkRequestStore } from '../../../orchestration/workRequestStore';

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
    const workRequestStore = new WorkRequestStore(
        path.resolve(process.cwd(), '.coworkany', 'work-requests.json'),
    );

    const normalized = await runPreFreezeResearchLoop({
        request: input.normalized,
        workRequestStore,
    });

    return {
        researchComplete: true,
        evidence: normalized.researchEvidence ?? [],
        normalized,
        userResponses: resumeData?.answers,
    };
}
