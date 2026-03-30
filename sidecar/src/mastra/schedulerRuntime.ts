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

const DEFAULT_STALE_RUNNING_TIMEOUT_MS = 20 * 60_000;
const envStaleTimeoutRaw = process.env.COWORKANY_MASTRA_SCHEDULED_STALE_TIMEOUT_MS;
const envStaleTimeoutParsed = typeof envStaleTimeoutRaw === 'string'
    ? Number(envStaleTimeoutRaw)
    : Number.NaN;
const STALE_RUNNING_TIMEOUT_MS = Number.isFinite(envStaleTimeoutParsed) && envStaleTimeoutParsed > 0
    ? envStaleTimeoutParsed
    : DEFAULT_STALE_RUNNING_TIMEOUT_MS;
const DEFAULT_SCHEDULED_IDEMPOTENCY_WINDOW_MS = 45_000;
const envIdempotencyWindowRaw = process.env.COWORKANY_MASTRA_SCHEDULED_IDEMPOTENCY_WINDOW_MS;
const envIdempotencyWindowParsed = typeof envIdempotencyWindowRaw === 'string'
    ? Number(envIdempotencyWindowRaw)
    : Number.NaN;
const SCHEDULED_IDEMPOTENCY_WINDOW_MS = Number.isFinite(envIdempotencyWindowParsed) && envIdempotencyWindowParsed >= 0
    ? envIdempotencyWindowParsed
    : DEFAULT_SCHEDULED_IDEMPOTENCY_WINDOW_MS;
const IDEMPOTENT_STATUSES = new Set<ScheduledTaskRecord['status']>([
    'scheduled',
    'running',
    'suspended_waiting_user',
]);

function pickString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function toScheduledTaskConfig(input: Record<string, unknown> | undefined): ScheduledTaskConfigWithMeta {
    const config = toRecord(input);
    const base: ScheduledTaskConfigWithMeta = {
        modelId: pickString(config.modelId),
        maxTokens: typeof config.maxTokens === 'number' ? config.maxTokens : undefined,
        maxHistoryMessages: typeof config.maxHistoryMessages === 'number' ? config.maxHistoryMessages : undefined,
        enabledClaudeSkills: Array.isArray(config.enabledClaudeSkills)
            ? config.enabledClaudeSkills.filter((value): value is string => typeof value === 'string')
            : undefined,
        enabledToolpacks: Array.isArray(config.enabledToolpacks)
            ? config.enabledToolpacks.filter((value): value is string => typeof value === 'string')
            : undefined,
        enabledSkills: Array.isArray(config.enabledSkills)
            ? config.enabledSkills.filter((value): value is string => typeof value === 'string')
            : undefined,
        disabledTools: Array.isArray(config.disabledTools)
            ? config.disabledTools.filter((value): value is string => typeof value === 'string')
            : undefined,
        environmentContext: config.environmentContext as ScheduledTaskConfig['environmentContext'] | undefined,
    };

    const currentMeta = toRecord(config.__mastraSchedulerMeta) as SchedulerMeta;
    if (currentMeta && (currentMeta.recurrence || (Array.isArray(currentMeta.chainedStages) && currentMeta.chainedStages.length > 0))) {
        base.__mastraSchedulerMeta = {
            recurrence: currentMeta.recurrence,
            chainedStages: Array.isArray(currentMeta.chainedStages)
                ? currentMeta.chainedStages
                : undefined,
        };
    }

    return base;
}

function getSchedulerMeta(record: ScheduledTaskRecord): SchedulerMeta {
    const config = record.config as ScheduledTaskConfigWithMeta | undefined;
    return config?.__mastraSchedulerMeta ?? {};
}

function setSchedulerMeta(config: ScheduledTaskConfigWithMeta, meta: SchedulerMeta): ScheduledTaskConfigWithMeta {
    if (!meta.recurrence && (!meta.chainedStages || meta.chainedStages.length === 0)) {
        const { __mastraSchedulerMeta, ...rest } = config;
        void __mastraSchedulerMeta;
        return rest;
    }

    return {
        ...config,
        __mastraSchedulerMeta: {
            recurrence: meta.recurrence,
            chainedStages: meta.chainedStages,
        },
    };
}

function isSameRecurrence(
    left: SchedulerMeta['recurrence'],
    right: SchedulerMeta['recurrence'],
): boolean {
    if (!left && !right) {
        return true;
    }
    if (!left || !right) {
        return false;
    }
    return left.kind === right.kind && left.value === right.value;
}

function isSameChainedStages(
    left: SchedulerMeta['chainedStages'],
    right: SchedulerMeta['chainedStages'],
): boolean {
    const leftStages = left ?? [];
    const rightStages = right ?? [];
    if (leftStages.length !== rightStages.length) {
        return false;
    }
    for (let index = 0; index < leftStages.length; index += 1) {
        const leftStage = leftStages[index];
        const rightStage = rightStages[index];
        if (!leftStage || !rightStage) {
            return false;
        }
        if (
            leftStage.delayMsFromPrevious !== rightStage.delayMsFromPrevious
            || leftStage.taskQuery !== rightStage.taskQuery
        ) {
            return false;
        }
    }
    return true;
}

function isDuplicateScheduledRequest(input: {
    record: ScheduledTaskRecord;
    sourceTaskId: string;
    taskQuery: string;
    executeAt: Date;
    speakResult: boolean;
    workspacePath: string;
    meta: SchedulerMeta;
}): boolean {
    const { record } = input;
    if (!IDEMPOTENT_STATUSES.has(record.status)) {
        return false;
    }
    if (record.sourceTaskId !== input.sourceTaskId) {
        return false;
    }
    if (record.taskQuery !== input.taskQuery || record.workspacePath !== input.workspacePath) {
        return false;
    }
    if (record.speakResult !== input.speakResult) {
        return false;
    }

    const recordExecuteAt = new Date(record.executeAt).getTime();
    const nextExecuteAt = input.executeAt.getTime();
    if (!Number.isFinite(recordExecuteAt) || !Number.isFinite(nextExecuteAt)) {
        return false;
    }
    if (Math.abs(recordExecuteAt - nextExecuteAt) > SCHEDULED_IDEMPOTENCY_WINDOW_MS) {
        return false;
    }

    const existingMeta = getSchedulerMeta(record);
    return (
        isSameRecurrence(existingMeta.recurrence, input.meta.recurrence)
        && isSameChainedStages(existingMeta.chainedStages, input.meta.chainedStages)
    );
}

function buildTaskTitle(taskQuery: string, fallback?: string): string {
    const fromFallback = pickString(fallback);
    if (fromFallback) {
        return fromFallback;
    }
    const trimmed = taskQuery.trim();
    if (!trimmed) {
        return 'Scheduled Task';
    }
    return trimmed.slice(0, 60);
}

function buildScheduledConfirmationMessage(record: ScheduledTaskRecord, meta: SchedulerMeta): string {
    const timeText = formatScheduledTime(new Date(record.executeAt));
    const parts = [`已安排在 ${timeText} 执行：${record.title}${record.speakResult ? '，完成后会语音播报。' : '。'}`];
    if (meta.recurrence) {
        parts.push(`循环规则：${meta.recurrence.value}`);
    }
    return parts.join('\n');
}

function buildSequentialSchedulingMessage(record: ScheduledTaskRecord, stageCount: number): string {
    return [
        `已拆解为 ${stageCount} 个链式阶段任务。`,
        `当前仅安排第 1 阶段：已安排在 ${formatScheduledTime(new Date(record.executeAt))} 执行：${record.title}。`,
        '后续阶段会在前一阶段完成后自动续排。',
    ].join('\n');
}

function readLatestRecord(store: ScheduledTaskStore, recordId: string): ScheduledTaskRecord | undefined {
    return store.read().find((item) => item.id === recordId);
}

function buildSourceTaskId(record: ScheduledTaskRecord): string {
    return record.sourceTaskId || `scheduled-${record.id}`;
}

function shouldCancelScheduledTasks(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }

    const chineseExplicitCancel = /(?:取消|停止|终止|结束|关闭|关掉|停掉).*(?:提醒|定时|任务|闹钟|计划|上述|这个|该)/u;
    if (chineseExplicitCancel.test(trimmed)) {
        return true;
    }

    const chineseShortCancel = /^(?:取消|停止|终止|结束)(?:上述|这个|该)?任务$/u;
    if (chineseShortCancel.test(trimmed)) {
        return true;
    }

    return /\b(cancel|stop|abort|terminate)\b/i.test(trimmed) && /\b(reminder|scheduled?|task)\b/i.test(trimmed);
}

export function createMastraSchedulerRuntime(input: {
    appDataRoot: string;
    deps: SchedulerRuntimeDeps;
}): {
    scheduleIfNeeded: (args: {
        sourceTaskId: string;
        title?: string;
        message: string;
        workspacePath: string;
        config?: Record<string, unknown>;
    }) => Promise<ScheduleDecision>;
    cancelBySourceTask: (args: {
        sourceTaskId: string;
        userMessage: string;
    }) => Promise<ScheduledCancelResult>;
    pollDueTasks: (now?: Date) => Promise<void>;
    start: () => void;
    stop: () => void;
    getStore: () => ScheduledTaskStore;
} {
    const scheduledTaskStore = new ScheduledTaskStore(path.join(input.appDataRoot, 'scheduled-tasks.json'));
    const getNow = input.deps.getNow ?? (() => new Date());
    const runningRecords = new Set<string>();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollInFlight: Promise<void> | null = null;

    const scheduleIfNeeded = async (args: {
        sourceTaskId: string;
        title?: string;
        message: string;
        workspacePath: string;
        config?: Record<string, unknown>;
    }): Promise<ScheduleDecision> => {
        const parsed = detectScheduledIntent(args.message, getNow());
        if (!parsed) {
            return { scheduled: false };
        }

        const config = toScheduledTaskConfig(args.config);
        const meta: SchedulerMeta = {
            recurrence: parsed.recurrence,
            chainedStages: parsed.chainedStages,
        };
        const duplicate = scheduledTaskStore.read().find((record) => isDuplicateScheduledRequest({
            record,
            sourceTaskId: args.sourceTaskId,
            taskQuery: parsed.taskQuery,
            executeAt: parsed.executeAt,
            speakResult: parsed.speakResult,
            workspacePath: args.workspacePath,
            meta,
        }));
        if (duplicate) {
            return {
                scheduled: true,
                summary: `检测到重复的定时创建请求，保持已有任务不重复创建。\n${buildScheduledConfirmationMessage(duplicate, getSchedulerMeta(duplicate))}`,
                taskId: duplicate.id,
                executeAt: duplicate.executeAt,
            };
        }

        const totalStages = (parsed.chainedStages?.length ?? 0) + 1;
        const firstRecord = scheduledTaskStore.create({
            title: buildTaskTitle(parsed.taskQuery, args.title),
            taskQuery: parsed.taskQuery,
            workspacePath: args.workspacePath,
            executeAt: parsed.executeAt,
            speakResult: parsed.speakResult,
            sourceTaskId: args.sourceTaskId,
            stageIndex: 0,
            totalStages,
            config: setSchedulerMeta(config, meta),
        });

        const summary = parsed.chainedStages && parsed.chainedStages.length > 0
            ? buildSequentialSchedulingMessage(firstRecord, totalStages)
            : buildScheduledConfirmationMessage(firstRecord, meta);

        return {
            scheduled: true,
            summary,
            taskId: firstRecord.id,
            executeAt: firstRecord.executeAt,
        };
    };

    const cancelBySourceTask = async (args: {
        sourceTaskId: string;
        userMessage: string;
    }): Promise<ScheduledCancelResult> => {
        if (!shouldCancelScheduledTasks(args.userMessage)) {
            return {
                success: false,
                cancelledCount: 0,
                cancelledTitles: [],
            };
        }

        const reason = `Cancelled by user message: ${args.userMessage}`;
        const nowIso = getNow().toISOString();
        const candidates = scheduledTaskStore
            .read()
            .filter((record) =>
                record.sourceTaskId === args.sourceTaskId
                && (record.status === 'scheduled' || record.status === 'running' || record.status === 'suspended_waiting_user'),
            );

        for (const record of candidates) {
            scheduledTaskStore.upsert({
                ...record,
                status: 'cancelled',
                completedAt: nowIso,
                error: reason,
            });
        }

        return {
            success: candidates.length > 0,
            cancelledCount: candidates.length,
            cancelledTitles: Array.from(new Set(candidates.map((record) => record.title).filter((title) => title.trim().length > 0))),
        };
    };

    const scheduleNextChainStageIfNeeded = (
        record: ScheduledTaskRecord,
        completedAt: Date,
    ): void => {
        const meta = getSchedulerMeta(record);
        const chainedStages = meta.chainedStages;
        if (!chainedStages || chainedStages.length === 0) {
            return;
        }

        const currentStageIndex = record.stageIndex ?? 0;
        if (currentStageIndex >= chainedStages.length) {
            return;
        }

        const nextStage = chainedStages[currentStageIndex];
        if (!nextStage) {
            return;
        }

        const nextStageIndex = currentStageIndex + 1;
        const nextExecuteAt = new Date(completedAt.getTime() + nextStage.delayMsFromPrevious);

        const hasExisting = scheduledTaskStore.read().some((item) =>
            item.sourceTaskId === record.sourceTaskId
            && item.stageIndex === nextStageIndex
            && item.status !== 'cancelled',
        );
        if (hasExisting) {
            return;
        }

        const config = toScheduledTaskConfig(record.config as Record<string, unknown> | undefined);
        const nextTitle = `阶段 ${nextStageIndex + 1}`;
        scheduledTaskStore.create({
            title: nextTitle,
            taskQuery: nextStage.taskQuery,
            workspacePath: record.workspacePath,
            executeAt: nextExecuteAt,
            speakResult: record.speakResult,
            sourceTaskId: record.sourceTaskId,
            stageIndex: nextStageIndex,
            totalStages: record.totalStages,
            delayMsFromPrevious: nextStage.delayMsFromPrevious,
            config: setSchedulerMeta(config, meta),
        });
    };

    const scheduleNextRecurringRunIfNeeded = (
        record: ScheduledTaskRecord,
        completedAt: Date,
    ): void => {
        const meta = getSchedulerMeta(record);
        if (!meta.recurrence) {
            return;
        }

        if ((record.stageIndex ?? 0) !== 0) {
            return;
        }

        const nextExecuteAt = computeNextRecurringExecuteAt({
            recurrence: meta.recurrence,
            previousExecuteAt: record.executeAt,
            now: completedAt,
        });
        if (!nextExecuteAt) {
            return;
        }

        const nextExecuteAtIso = nextExecuteAt.toISOString();
        const hasExisting = scheduledTaskStore.read().some((item) =>
            item.sourceTaskId === record.sourceTaskId
            && item.executeAt === nextExecuteAtIso
            && item.status === 'scheduled',
        );
        if (hasExisting) {
            return;
        }

        const config = toScheduledTaskConfig(record.config as Record<string, unknown> | undefined);
        scheduledTaskStore.create({
            title: record.title,
            taskQuery: record.taskQuery,
            workspacePath: record.workspacePath,
            executeAt: nextExecuteAt,
            speakResult: record.speakResult,
            sourceTaskId: record.sourceTaskId,
            stageIndex: 0,
            totalStages: record.totalStages,
            config: setSchedulerMeta(config, meta),
        });
    };

    const runScheduledRecord = async (record: ScheduledTaskRecord): Promise<void> => {
        if (runningRecords.has(record.id)) {
            return;
        }
        runningRecords.add(record.id);

        const startedAt = getNow().toISOString();
        const runningRecord: ScheduledTaskRecord = {
            ...record,
            status: 'running',
            startedAt,
            error: undefined,
        };
        scheduledTaskStore.upsert(runningRecord);

        const sourceTaskId = buildSourceTaskId(record);
        const resourceId = input.deps.resolveResourceIdForTask(sourceTaskId);
        let assistantText = '';

        try {
            await input.deps.handleUserMessage(
                record.taskQuery,
                sourceTaskId,
                resourceId,
                (event) => {
                    if (event.type === 'text_delta') {
                        assistantText += event.content;
                    }
                    input.deps.emitDesktopEventForTask(sourceTaskId, event);
                },
            );

            const latest = readLatestRecord(scheduledTaskStore, record.id);
            if (latest?.status === 'cancelled') {
                return;
            }

            const completedAt = getNow();
            scheduledTaskStore.upsert({
                ...runningRecord,
                status: 'completed',
                completedAt: completedAt.toISOString(),
                resultSummary: assistantText.trim() || 'Scheduled task completed.',
                error: undefined,
            });

            scheduleNextChainStageIfNeeded(runningRecord, completedAt);
            scheduleNextRecurringRunIfNeeded(runningRecord, completedAt);
        } catch (error) {
            const latest = readLatestRecord(scheduledTaskStore, record.id);
            if (latest?.status === 'cancelled') {
                return;
            }
            scheduledTaskStore.upsert({
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
        const recovered = scheduledTaskStore.recoverStaleRunning({
            now,
            timeoutMs: STALE_RUNNING_TIMEOUT_MS,
            errorMessage: `Scheduled task exceeded ${Math.floor(STALE_RUNNING_TIMEOUT_MS / 60_000)} minutes and was auto-marked as failed.`,
        });
        for (const record of recovered) {
            const sourceTaskId = buildSourceTaskId(record);
            input.deps.emitDesktopEventForTask(sourceTaskId, {
                type: 'error',
                message: record.error || 'scheduled_task_recovered_as_failed',
            });
        }

        const due = scheduledTaskStore.listDue(now);
        for (const record of due) {
            await runScheduledRecord(record);
        }
    };

    const pollDueTasksWithLock = async (): Promise<void> => {
        if (pollInFlight) {
            return pollInFlight;
        }
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
        if (pollTimer) {
            return;
        }
        void pollDueTasksWithLock();
        pollTimer = setInterval(() => {
            void pollDueTasksWithLock();
        }, 2_000);
    };

    const stop = (): void => {
        if (!pollTimer) {
            return;
        }
        clearInterval(pollTimer);
        pollTimer = null;
    };

    return {
        scheduleIfNeeded,
        cancelBySourceTask,
        pollDueTasks,
        start,
        stop,
        getStore: () => scheduledTaskStore,
    };
}
