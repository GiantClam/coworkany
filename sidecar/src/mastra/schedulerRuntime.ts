import * as path from 'path';
import type { DesktopEvent } from '../ipc/bridge';
import {
    ScheduledTaskStore,
    computeNextRecurringExecuteAt,
    detectScheduledIntent,
    formatScheduledTime,
    type ChainedScheduledStageIntent,
    type ScheduledTaskConfig,
    type ScheduledTaskRecord,
} from '../scheduling/scheduledTasks';
type UserMessageHandler = (
    message: string,
    threadId: string,
    resourceId: string,
    sendToDesktop: (event: DesktopEvent) => void,
) => Promise<{ runId: string }>;
type SchedulerMeta = {
    recurrence?: { kind: 'rrule'; value: string };
    chainedStages?: ChainedScheduledStageIntent[];
};
type ScheduledTaskConfigWithMeta = ScheduledTaskConfig & {
    __mastraSchedulerMeta?: SchedulerMeta;
};
export type ScheduleDecision = {
    scheduled: boolean;
    summary?: string;
    taskId?: string;
    executeAt?: string;
    error?: string;
};
export type ScheduledCancelResult = {
    success: boolean;
    cancelledCount: number;
    cancelledTitles: string[];
};
type SchedulerRuntimeDeps = {
    handleUserMessage: UserMessageHandler;
    resolveResourceIdForTask: (taskId: string) => string;
    emitDesktopEventForTask: (taskId: string, event: DesktopEvent) => void;
    getNow?: () => Date;
};
type RuntimeInput = {
    appDataRoot: string;
    deps: SchedulerRuntimeDeps;
};
type ScheduleInput = {
    sourceTaskId: string;
    title?: string;
    message: string;
    workspacePath: string;
    config?: Record<string, unknown>;
};
type CancelInput = {
    sourceTaskId: string;
    userMessage: string;
};
const parseEnvWindow = (key: string, fallback: number, allowZero = false): number => {
    const raw = process.env[key];
    const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(value)) return fallback;
    if (allowZero ? value < 0 : value <= 0) return fallback;
    return value;
};
const STALE_RUNNING_TIMEOUT_MS = parseEnvWindow(
    'COWORKANY_MASTRA_SCHEDULED_STALE_TIMEOUT_MS',
    20 * 60_000,
);
const SCHEDULED_IDEMPOTENCY_WINDOW_MS = parseEnvWindow(
    'COWORKANY_MASTRA_SCHEDULED_IDEMPOTENCY_WINDOW_MS',
    45_000,
    true,
);
const IDEMPOTENT_STATUSES = new Set<ScheduledTaskRecord['status']>([
    'scheduled',
    'running',
    'suspended_waiting_user',
]);
const CANCELLED_LIVE_STATUSES = new Set<ScheduledTaskRecord['status']>([
    'scheduled',
    'running',
    'suspended_waiting_user',
]);
const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;
const pickString = (value: unknown): string | undefined =>
    isNonEmptyString(value) ? value : undefined;
const toRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
const pickStringArray = (value: unknown): string[] | undefined =>
    Array.isArray(value) ? value.filter(isNonEmptyString) : undefined;
const parseSchedulerMeta = (value: unknown): SchedulerMeta => {
    const raw = toRecord(value);
    const recurrenceRaw = toRecord(raw.recurrence);
    const recurrence = recurrenceRaw.kind === 'rrule' && isNonEmptyString(recurrenceRaw.value)
        ? { kind: 'rrule' as const, value: recurrenceRaw.value }
        : undefined;
    const chainedStages = Array.isArray(raw.chainedStages)
        ? raw.chainedStages
            .map((item) => {
                const stage = toRecord(item);
                return {
                    delayMsFromPrevious: typeof stage.delayMsFromPrevious === 'number' ? stage.delayMsFromPrevious : Number.NaN,
                    taskQuery: pickString(stage.taskQuery) ?? '',
                    originalTimeExpression: pickString(stage.originalTimeExpression) ?? '',
                };
            })
            .filter(
                (stage) =>
                    Number.isFinite(stage.delayMsFromPrevious)
                    && stage.delayMsFromPrevious >= 0
                    && stage.taskQuery.length > 0,
            )
        : undefined;
    return {
        recurrence,
        chainedStages: chainedStages && chainedStages.length > 0 ? chainedStages : undefined,
    };
};
const toScheduledTaskConfig = (input: Record<string, unknown> | undefined): ScheduledTaskConfigWithMeta => {
    const raw = toRecord(input);
    const meta = parseSchedulerMeta(raw.__mastraSchedulerMeta);
    const config: ScheduledTaskConfigWithMeta = {
        modelId: pickString(raw.modelId),
        maxTokens: typeof raw.maxTokens === 'number' ? raw.maxTokens : undefined,
        maxHistoryMessages: typeof raw.maxHistoryMessages === 'number' ? raw.maxHistoryMessages : undefined,
        enabledClaudeSkills: pickStringArray(raw.enabledClaudeSkills),
        enabledToolpacks: pickStringArray(raw.enabledToolpacks),
        enabledSkills: pickStringArray(raw.enabledSkills),
        disabledTools: pickStringArray(raw.disabledTools),
        environmentContext: raw.environmentContext as ScheduledTaskConfig['environmentContext'] | undefined,
    };
    if (meta.recurrence || meta.chainedStages) {
        config.__mastraSchedulerMeta = meta;
    }
    return config;
};
const getSchedulerMeta = (record: ScheduledTaskRecord): SchedulerMeta => {
    const config = record.config as ScheduledTaskConfigWithMeta | undefined;
    return config?.__mastraSchedulerMeta ?? {};
};
const withSchedulerMeta = (
    config: ScheduledTaskConfigWithMeta,
    meta: SchedulerMeta,
): ScheduledTaskConfigWithMeta => {
    if (!meta.recurrence && !meta.chainedStages?.length) {
        const { __mastraSchedulerMeta, ...rest } = config;
        void __mastraSchedulerMeta;
        return rest;
    }
    return { ...config, __mastraSchedulerMeta: meta };
};
const isSameRecurrence = (
    left: SchedulerMeta['recurrence'],
    right: SchedulerMeta['recurrence'],
): boolean => {
    if (!left && !right) return true;
    if (!left || !right) return false;
    return left.kind === right.kind && left.value === right.value;
};
const isSameChainedStages = (
    left: SchedulerMeta['chainedStages'],
    right: SchedulerMeta['chainedStages'],
): boolean => {
    const a = left ?? [];
    const b = right ?? [];
    return a.length === b.length
        && a.every((stage, index) => {
            const other = b[index];
            return Boolean(other)
                && stage.delayMsFromPrevious === other!.delayMsFromPrevious
                && stage.taskQuery === other!.taskQuery;
        });
};
const toTaskTitle = (taskQuery: string, fallback?: string): string => {
    const fallbackTitle = pickString(fallback);
    if (fallbackTitle) return fallbackTitle;
    const trimmed = taskQuery.trim();
    return trimmed ? trimmed.slice(0, 60) : 'Scheduled Task';
};
const asSourceTaskId = (record: ScheduledTaskRecord): string =>
    record.sourceTaskId || `scheduled-${record.id}`;
const confirmationMessage = (record: ScheduledTaskRecord, meta: SchedulerMeta): string => {
    const lines = [
        `已安排在 ${formatScheduledTime(new Date(record.executeAt))} 执行：${record.title}${record.speakResult ? '，完成后会语音播报。' : '。'}`,
    ];
    if (meta.recurrence) lines.push(`循环规则：${meta.recurrence.value}`);
    return lines.join('\n');
};
const chainMessage = (record: ScheduledTaskRecord, stageCount: number): string =>
    [
        `已拆解为 ${stageCount} 个链式阶段任务。`,
        `当前仅安排第 1 阶段：已安排在 ${formatScheduledTime(new Date(record.executeAt))} 执行：${record.title}。`,
        '后续阶段会在前一阶段完成后自动续排。',
    ].join('\n');
const shouldCancelScheduledTasks = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed === 'cancel_task') {
        return true;
    }
    if (/(?:取消|停止|终止|结束|关闭|关掉|停掉).*(?:提醒|定时|任务|闹钟|计划|上述|这个|该)/u.test(trimmed)) {
        return true;
    }
    if (/^(?:取消|停止|终止|结束)(?:上述|这个|该)?任务$/u.test(trimmed)) {
        return true;
    }
    return /\b(cancel|stop|abort|terminate)\b/i.test(trimmed)
        && /\b(reminder|scheduled?|task)\b/i.test(trimmed);
};
const readLatestRecord = (store: ScheduledTaskStore, recordId: string): ScheduledTaskRecord | undefined =>
    store.read().find((item) => item.id === recordId);
const isDuplicateScheduledRequest = (input: {
    record: ScheduledTaskRecord;
    sourceTaskId: string;
    taskQuery: string;
    executeAt: Date;
    speakResult: boolean;
    workspacePath: string;
    meta: SchedulerMeta;
}): boolean => {
    const { record } = input;
    if (!IDEMPOTENT_STATUSES.has(record.status)) return false;
    if (record.sourceTaskId !== input.sourceTaskId) return false;
    if (record.taskQuery !== input.taskQuery || record.workspacePath !== input.workspacePath) return false;
    if (record.speakResult !== input.speakResult) return false;
    const existingAt = new Date(record.executeAt).getTime();
    const requestedAt = input.executeAt.getTime();
    if (!Number.isFinite(existingAt) || !Number.isFinite(requestedAt)) return false;
    if (Math.abs(existingAt - requestedAt) > SCHEDULED_IDEMPOTENCY_WINDOW_MS) return false;
    const existingMeta = getSchedulerMeta(record);
    return isSameRecurrence(existingMeta.recurrence, input.meta.recurrence)
        && isSameChainedStages(existingMeta.chainedStages, input.meta.chainedStages);
};
const scheduleNextChainStageIfNeeded = (
    store: ScheduledTaskStore,
    record: ScheduledTaskRecord,
    completedAt: Date,
): void => {
    const meta = getSchedulerMeta(record);
    const stages = meta.chainedStages;
    const currentIndex = record.stageIndex ?? 0;
    if (!stages?.length || currentIndex >= stages.length) return;
    const nextStage = stages[currentIndex];
    if (!nextStage) return;
    const nextStageIndex = currentIndex + 1;
    const alreadyScheduled = store.read().some((item) =>
        item.sourceTaskId === record.sourceTaskId
        && item.stageIndex === nextStageIndex
        && item.status !== 'cancelled',
    );
    if (alreadyScheduled) return;
    const nextExecuteAt = new Date(completedAt.getTime() + nextStage.delayMsFromPrevious);
    const config = toScheduledTaskConfig(record.config as Record<string, unknown> | undefined);
    store.create({
        title: `阶段 ${nextStageIndex + 1}`,
        taskQuery: nextStage.taskQuery,
        workspacePath: record.workspacePath,
        executeAt: nextExecuteAt,
        speakResult: record.speakResult,
        sourceTaskId: record.sourceTaskId,
        stageIndex: nextStageIndex,
        totalStages: record.totalStages,
        delayMsFromPrevious: nextStage.delayMsFromPrevious,
        config: withSchedulerMeta(config, meta),
    });
};
const scheduleNextRecurringRunIfNeeded = (
    store: ScheduledTaskStore,
    record: ScheduledTaskRecord,
    completedAt: Date,
): void => {
    const meta = getSchedulerMeta(record);
    if (!meta.recurrence) return;
    if ((record.stageIndex ?? 0) !== 0) return;
    const nextExecuteAt = computeNextRecurringExecuteAt({
        recurrence: meta.recurrence,
        previousExecuteAt: record.executeAt,
        now: completedAt,
    });
    if (!nextExecuteAt) return;
    const nextIso = nextExecuteAt.toISOString();
    const alreadyScheduled = store.read().some((item) =>
        item.sourceTaskId === record.sourceTaskId
        && item.executeAt === nextIso
        && item.status === 'scheduled',
    );
    if (alreadyScheduled) return;
    const config = toScheduledTaskConfig(record.config as Record<string, unknown> | undefined);
    store.create({
        title: record.title,
        taskQuery: record.taskQuery,
        workspacePath: record.workspacePath,
        executeAt: nextExecuteAt,
        speakResult: record.speakResult,
        sourceTaskId: record.sourceTaskId,
        stageIndex: 0,
        totalStages: record.totalStages,
        config: withSchedulerMeta(config, meta),
    });
};
export function createMastraSchedulerRuntime(input: RuntimeInput): {
    scheduleIfNeeded: (args: ScheduleInput) => Promise<ScheduleDecision>;
    cancelBySourceTask: (args: CancelInput) => Promise<ScheduledCancelResult>;
    pollDueTasks: (now?: Date) => Promise<void>;
    start: () => void;
    stop: () => void;
    getStore: () => ScheduledTaskStore;
} {
    const store = new ScheduledTaskStore(path.join(input.appDataRoot, 'scheduled-tasks.json'));
    const getNow = input.deps.getNow ?? (() => new Date());
    const runningRecords = new Set<string>();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollInFlight: Promise<void> | null = null;
    const scheduleIfNeeded = async (args: ScheduleInput): Promise<ScheduleDecision> => {
        const parsed = detectScheduledIntent(args.message, getNow());
        if (!parsed) return { scheduled: false };
        const meta: SchedulerMeta = {
            recurrence: parsed.recurrence,
            chainedStages: parsed.chainedStages,
        };
        const duplicate = store.read().find((record) =>
            isDuplicateScheduledRequest({
                record,
                sourceTaskId: args.sourceTaskId,
                taskQuery: parsed.taskQuery,
                executeAt: parsed.executeAt,
                speakResult: parsed.speakResult,
                workspacePath: args.workspacePath,
                meta,
            }),
        );
        if (duplicate) {
            return {
                scheduled: true,
                summary: `检测到重复的定时创建请求，保持已有任务不重复创建。\n${confirmationMessage(duplicate, getSchedulerMeta(duplicate))}`,
                taskId: duplicate.id,
                executeAt: duplicate.executeAt,
            };
        }
        const totalStages = (parsed.chainedStages?.length ?? 0) + 1;
        const record = store.create({
            title: toTaskTitle(parsed.taskQuery, args.title),
            taskQuery: parsed.taskQuery,
            workspacePath: args.workspacePath,
            executeAt: parsed.executeAt,
            speakResult: parsed.speakResult,
            sourceTaskId: args.sourceTaskId,
            stageIndex: 0,
            totalStages,
            config: withSchedulerMeta(toScheduledTaskConfig(args.config), meta),
        });
        return {
            scheduled: true,
            summary: parsed.chainedStages?.length
                ? chainMessage(record, totalStages)
                : confirmationMessage(record, meta),
            taskId: record.id,
            executeAt: record.executeAt,
        };
    };
    const cancelBySourceTask = async (args: CancelInput): Promise<ScheduledCancelResult> => {
        if (!shouldCancelScheduledTasks(args.userMessage)) {
            return { success: false, cancelledCount: 0, cancelledTitles: [] };
        }
        const nowIso = getNow().toISOString();
        const reason = `Cancelled by user message: ${args.userMessage}`;
        const candidates = store.read().filter((record) =>
            record.sourceTaskId === args.sourceTaskId
            && CANCELLED_LIVE_STATUSES.has(record.status),
        );
        for (const record of candidates) {
            store.upsert({
                ...record,
                status: 'cancelled',
                completedAt: nowIso,
                error: reason,
            });
        }
        return {
            success: candidates.length > 0,
            cancelledCount: candidates.length,
            cancelledTitles: Array.from(new Set(candidates.map((item) => item.title).filter(isNonEmptyString))),
        };
    };
    const runScheduledRecord = async (record: ScheduledTaskRecord): Promise<void> => {
        if (runningRecords.has(record.id)) return;
        runningRecords.add(record.id);
        const runningRecord: ScheduledTaskRecord = {
            ...record,
            status: 'running',
            startedAt: getNow().toISOString(),
            error: undefined,
        };
        store.upsert(runningRecord);
        const sourceTaskId = asSourceTaskId(record);
        const resourceId = input.deps.resolveResourceIdForTask(sourceTaskId);
        let assistantText = '';
        try {
            await input.deps.handleUserMessage(
                record.taskQuery,
                sourceTaskId,
                resourceId,
                (event) => {
                    if (event.type === 'text_delta') assistantText += event.content;
                    input.deps.emitDesktopEventForTask(sourceTaskId, event);
                },
            );
            if (readLatestRecord(store, record.id)?.status === 'cancelled') return;
            const completedAt = getNow();
            store.upsert({
                ...runningRecord,
                status: 'completed',
                completedAt: completedAt.toISOString(),
                resultSummary: assistantText.trim() || 'Scheduled task completed.',
                error: undefined,
            });
            scheduleNextChainStageIfNeeded(store, runningRecord, completedAt);
            scheduleNextRecurringRunIfNeeded(store, runningRecord, completedAt);
        } catch (error) {
            if (readLatestRecord(store, record.id)?.status === 'cancelled') return;
            store.upsert({
                ...runningRecord,
                status: 'failed',
                completedAt: getNow().toISOString(),
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            runningRecords.delete(record.id);
        }
    };
    const pollDueTasks = async (now = getNow()): Promise<void> => {
        const recovered = store.recoverStaleRunning({
            now,
            timeoutMs: STALE_RUNNING_TIMEOUT_MS,
            errorMessage: `Scheduled task exceeded ${Math.floor(STALE_RUNNING_TIMEOUT_MS / 60_000)} minutes and was auto-marked as failed.`,
        });
        for (const record of recovered) {
            input.deps.emitDesktopEventForTask(asSourceTaskId(record), {
                type: 'error',
                message: record.error || 'scheduled_task_recovered_as_failed',
            });
        }
        for (const record of store.listDue(now)) {
            await runScheduledRecord(record);
        }
    };
    const pollDueTasksWithLock = async (): Promise<void> => {
        if (pollInFlight) return pollInFlight;
        pollInFlight = (async () => {
            try {
                await pollDueTasks();
            } catch (error) {
                console.error('[MastraSchedulerRuntime] pollDueTasks failed:', error);
            } finally {
                pollInFlight = null;
            }
        })();
        return pollInFlight;
    };
    const start = (): void => {
        if (pollTimer) return;
        void pollDueTasksWithLock();
        pollTimer = setInterval(() => {
            void pollDueTasksWithLock();
        }, 2_000);
    };
    const stop = (): void => {
        if (!pollTimer) return;
        clearInterval(pollTimer);
        pollTimer = null;
    };
    return {
        scheduleIfNeeded,
        cancelBySourceTask,
        pollDueTasks,
        start,
        stop,
        getStore: () => store,
    };
}
