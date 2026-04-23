import type { TaskRuntimeState } from './taskRuntimeState';

type ChannelDeliveryEventSnapshot = {
    status?: string;
} & Record<string, unknown>;

type RuntimeSnapshotCollectorInput = {
    taskStates: Map<string, TaskRuntimeState>;
    resolveTaskCheckpointVersion: (state: TaskRuntimeState) => number;
    listRemoteSessions: () => Array<Record<string, unknown>>;
    listChannelDeliveryEvents: () => ChannelDeliveryEventSnapshot[];
    forwardBridgeStats: Record<string, unknown>;
    remoteSessionGovernancePolicy: Record<string, unknown>;
    getNowIso: () => string;
};

export function createRuntimeSnapshotCollector(
    input: RuntimeSnapshotCollectorInput,
): () => {
    generatedAt: string;
    activeTaskId?: string;
    tasks: Array<Record<string, unknown>>;
    count: number;
    remoteSessions: {
        count: number;
        sessions: Array<Record<string, unknown>>;
    };
    channelDeliveries: {
        count: number;
        pending: number;
        acked: number;
    };
    policyGateBridge: Record<string, unknown>;
    remoteSessionGovernance: Record<string, unknown>;
} {
    return () => {
        const tasks = Array.from(input.taskStates.values()).map((task) => ({
            taskId: task.taskId,
            threadId: task.conversationThreadId,
            title: task.title,
            workspacePath: task.workspacePath,
            createdAt: task.createdAt,
            status: task.status,
            suspended: task.suspended,
            suspensionReason: task.suspensionReason,
            lastTraceId: task.lastTraceId,
            enabledSkills: task.enabledSkills,
            modelId: task.modelId,
            resourceId: task.resourceId,
            checkpoint: task.checkpoint,
            checkpointVersion: task.checkpointVersion ?? input.resolveTaskCheckpointVersion(task),
            retry: task.retry,
            agentTasks: task.agentTasks ?? [],
            agentTaskProgress: task.agentTaskProgress ?? null,
            operationLog: task.operationLog ?? [],
            executionPath: task.executionPath ?? 'workflow',
            turnContract: task.turnContract ?? null,
        }));
        const remoteSessions = input.listRemoteSessions();
        const channelDeliveries = input.listChannelDeliveryEvents();
        const pendingChannelDeliveries = channelDeliveries.filter((event) => event.status === 'pending').length;
        const ackedChannelDeliveries = channelDeliveries.filter((event) => event.status === 'acked').length;
        const activeTaskId = tasks.find((task) => task.status === 'running')?.taskId as string | undefined
            ?? tasks.find((task) => task.status === 'retrying')?.taskId as string | undefined
            ?? tasks.find((task) => task.status === 'suspended')?.taskId as string | undefined
            ?? tasks.find((task) => task.status === 'interrupted')?.taskId as string | undefined;
        return {
            generatedAt: input.getNowIso(),
            activeTaskId,
            tasks,
            count: tasks.length,
            remoteSessions: {
                count: remoteSessions.length,
                sessions: remoteSessions,
            },
            channelDeliveries: {
                count: channelDeliveries.length,
                pending: pendingChannelDeliveries,
                acked: ackedChannelDeliveries,
            },
            policyGateBridge: {
                ...input.forwardBridgeStats,
            },
            remoteSessionGovernance: {
                ...input.remoteSessionGovernancePolicy,
            },
        };
    };
}
