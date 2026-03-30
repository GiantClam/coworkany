import type { DeliverableContract, FrozenWorkRequest, TaskDefinition, WorkMode } from '../../orchestration/workRequestSchema';

export type FrozenWorkRequestSnapshot = {
    mode: WorkMode;
    sourceText: string;
    primaryObjective?: string;
    preferredWorkflows: string[];
    resolvedTargets: string[];
    deliverables: Array<{
        type: DeliverableContract['type'];
        path?: string;
        format?: string;
    }>;
};

export type SupersededContractTombstone = {
    supersededAt: string;
    reason: 'contract_refreeze';
    snapshot: FrozenWorkRequestSnapshot;
};

function sortStrings(values: Array<string | undefined>): string[] {
    return values
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort();
}

function snapshotTaskResolvedTargets(tasks: TaskDefinition[] | undefined): string[] {
    return sortStrings(
        (tasks ?? []).flatMap((task) => [
            ...(task.resolvedTargets ?? []).map((target) => target.resolvedPath),
            ...(task.sourceUrls ?? []),
        ])
    );
}

function snapshotTaskPreferredWorkflows(tasks: TaskDefinition[] | undefined): string[] {
    return sortStrings((tasks ?? []).map((task) => task.preferredWorkflow));
}

export function snapshotFrozenWorkRequest(
    request: Pick<FrozenWorkRequest, 'mode' | 'sourceText' | 'tasks' | 'deliverables'>
): FrozenWorkRequestSnapshot {
    return {
        mode: request.mode,
        sourceText: request.sourceText,
        primaryObjective: request.tasks?.[0]?.objective,
        preferredWorkflows: snapshotTaskPreferredWorkflows(request.tasks),
        resolvedTargets: snapshotTaskResolvedTargets(request.tasks),
        deliverables: (request.deliverables ?? [])
            .map((deliverable) => ({
                type: deliverable.type,
                path: deliverable.path,
                format: deliverable.format,
            }))
            .sort((left, right) => {
                const leftKey = `${left.type}:${left.path ?? ''}:${left.format ?? ''}`;
                const rightKey = `${right.type}:${right.path ?? ''}:${right.format ?? ''}`;
                return leftKey.localeCompare(rightKey);
            }),
    };
}
