import * as fs from 'fs';
import * as path from 'path';
import type { TaskRuntimeState } from './taskRuntimeState';

const DEFAULT_LEGACY_RUNTIME_STATE_FILE = 'task-runtime.json';

const VALID_TASK_RUNTIME_STATUSES = new Set<TaskRuntimeState['status']>([
    'running',
    'retrying',
    'idle',
    'finished',
    'failed',
    'interrupted',
    'suspended',
    'scheduled',
]);

type CreateLegacyRuntimeBootstrapHydratorInput = {
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => Record<string, unknown>;
    getNowIso: () => string;
    resolveTaskResourceId: (
        taskId: string,
        payload: Record<string, unknown>,
        existingResourceId?: string,
    ) => string;
    upsertTaskState: (taskId: string, patch: Partial<TaskRuntimeState>) => TaskRuntimeState;
    setLegacyDeliverables: (taskId: string, deliverables: string[]) => void;
    sanitizeLegacyPlannedOutputPath: (value: string) => string;
    buildLegacyPlannedArtifactContract: (sourceQuery: string, paths: string[]) => Record<string, unknown>;
    extractLegacyPathTargetsFromArtifactContract: (contract: Record<string, unknown>) => string[];
    buildTaskTurnContract: (input: {
        message: string;
        workspacePath: string;
        mode: 'task';
        route: 'direct';
        requiredCapabilities: string[];
        createdAt: string;
    }) => TaskRuntimeState['turnContract'];
    getDefaultWorkspacePath?: () => string;
    legacyRuntimeStateFile?: string;
    logger?: Pick<Console, 'warn'>;
};

export function createLegacyRuntimeBootstrapHydrator(
    input: CreateLegacyRuntimeBootstrapHydratorInput,
): (runtimeContext?: Record<string, unknown>) => void {
    const logger = input.logger ?? console;
    const getDefaultWorkspacePath = input.getDefaultWorkspacePath ?? (() => process.cwd());
    const legacyRuntimeStateFile = input.legacyRuntimeStateFile ?? DEFAULT_LEGACY_RUNTIME_STATE_FILE;

    return (runtimeContext?: Record<string, unknown>): void => {
        const appDataDir = input.getString(runtimeContext?.appDataDir);
        if (!appDataDir) {
            return;
        }
        const legacyRuntimePath = path.join(appDataDir, legacyRuntimeStateFile);
        if (!fs.existsSync(legacyRuntimePath)) {
            return;
        }
        let rawRecords: unknown;
        try {
            rawRecords = JSON.parse(fs.readFileSync(legacyRuntimePath, 'utf-8')) as unknown;
        } catch {
            return;
        }
        if (!Array.isArray(rawRecords)) {
            return;
        }

        let changed = false;
        const sanitizedRecords = rawRecords.map((record) => {
            const nextRecord = input.toRecord(record);
            const taskId = input.getString(nextRecord.taskId);
            const workspacePath = input.getString(nextRecord.workspacePath) ?? getDefaultWorkspacePath();
            const config = input.toRecord(nextRecord.config);
            const snapshot = input.toRecord(config.lastFrozenWorkRequestSnapshot);
            const deliverables = Array.isArray(snapshot.deliverables)
                ? snapshot.deliverables.map((item) => input.toRecord(item))
                : [];
            const plannedPaths: string[] = [];
            const sanitizedDeliverables = deliverables.map((deliverable) => {
                const originalPath = input.getString(deliverable.path);
                if (!originalPath) {
                    return deliverable;
                }
                const normalizedPath = input.sanitizeLegacyPlannedOutputPath(originalPath);
                plannedPaths.push(normalizedPath);
                if (normalizedPath !== originalPath) {
                    changed = true;
                    return {
                        ...deliverable,
                        path: normalizedPath,
                    };
                }
                return deliverable;
            });
            if (deliverables.length > 0) {
                nextRecord.config = {
                    ...config,
                    lastFrozenWorkRequestSnapshot: {
                        ...snapshot,
                        deliverables: sanitizedDeliverables,
                    },
                };
            }

            const sourceQuery = input.getString(snapshot.primaryObjective)
                ?? input.getString(snapshot.sourceText)
                ?? input.getString(input.toRecord(nextRecord.artifactContract).sourceQuery)
                ?? 'restored planned deliverables';
            if (plannedPaths.length > 0) {
                const normalizedArtifactContract = input.buildLegacyPlannedArtifactContract(sourceQuery, plannedPaths);
                const previousArtifactContract = input.toRecord(nextRecord.artifactContract);
                if (JSON.stringify(previousArtifactContract) !== JSON.stringify(normalizedArtifactContract)) {
                    changed = true;
                }
                nextRecord.artifactContract = normalizedArtifactContract;
            }

            if (taskId) {
                const artifactPaths = plannedPaths.length > 0
                    ? plannedPaths
                    : input.extractLegacyPathTargetsFromArtifactContract(input.toRecord(nextRecord.artifactContract));
                if (artifactPaths.length > 0) {
                    input.setLegacyDeliverables(taskId, artifactPaths);
                }
                const conversation = Array.isArray(nextRecord.conversation) ? nextRecord.conversation : [];
                const lastUserMessage = conversation
                    .map((item) => input.toRecord(item))
                    .reverse()
                    .find((item) => input.getString(item.role)?.toLowerCase() === 'user');
                const lastUserContent = input.getString(lastUserMessage?.content) ?? undefined;
                const rawStatus = input.getString(nextRecord.status);
                const status: TaskRuntimeState['status'] = (
                    rawStatus && VALID_TASK_RUNTIME_STATUSES.has(rawStatus as TaskRuntimeState['status'])
                )
                    ? rawStatus as TaskRuntimeState['status']
                    : 'idle';
                const statePatch: Partial<TaskRuntimeState> = {
                    title: input.getString(nextRecord.title) ?? 'Task',
                    workspacePath,
                    createdAt: input.getString(nextRecord.createdAt) ?? input.getNowIso(),
                    status,
                    lastUserMessage: lastUserContent,
                    resourceId: input.resolveTaskResourceId(taskId, {}),
                    executionPath: 'direct',
                };
                if (lastUserContent) {
                    statePatch.turnContract = input.buildTaskTurnContract({
                        message: lastUserContent,
                        workspacePath,
                        mode: 'task',
                        route: 'direct',
                        requiredCapabilities: [],
                        createdAt: input.getNowIso(),
                    });
                }
                input.upsertTaskState(taskId, statePatch);
            }
            return nextRecord;
        });

        if (!changed) {
            return;
        }
        try {
            fs.writeFileSync(legacyRuntimePath, JSON.stringify(sanitizedRecords, null, 2), 'utf-8');
        } catch (error) {
            logger.warn('[MastraEntrypoint] Failed to persist sanitized legacy runtime records:', error);
        }
    };
}
