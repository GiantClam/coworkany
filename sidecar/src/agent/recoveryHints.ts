export type RecoverableTaskHint = {
    taskId: string;
    workspacePath: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRecoverableTaskId(taskId: string | undefined | null): boolean {
    return typeof taskId === 'string' && UUID_PATTERN.test(taskId);
}

export function normalizeRecoverableTaskInputs(
    taskIds?: string[],
    taskHints?: RecoverableTaskHint[],
): {
    taskIds?: string[];
    taskHints?: RecoverableTaskHint[];
    invalidTaskIds: string[];
} {
    const invalidTaskIds = new Set<string>();

    const normalizedTaskIds = taskIds?.filter((taskId) => {
        const valid = isRecoverableTaskId(taskId);
        if (!valid && taskId.length > 0) {
            invalidTaskIds.add(taskId);
        }
        return valid;
    });

    const normalizedTaskHints = taskHints?.filter((task) => {
        const valid = isRecoverableTaskId(task.taskId);
        if (!valid && task.taskId.length > 0) {
            invalidTaskIds.add(task.taskId);
        }
        return valid && typeof task.workspacePath === 'string' && task.workspacePath.length > 0;
    });

    return {
        taskIds: normalizedTaskIds && normalizedTaskIds.length > 0 ? normalizedTaskIds : undefined,
        taskHints: normalizedTaskHints && normalizedTaskHints.length > 0 ? normalizedTaskHints : undefined,
        invalidTaskIds: Array.from(invalidTaskIds),
    };
}
