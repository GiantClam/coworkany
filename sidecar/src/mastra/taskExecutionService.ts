import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { TaskRuntimeExecutionPath } from './taskRuntimeState';
import type {
    TaskMessageExecutionDelegateInput,
    TaskMessageExecutionDelegateResult,
} from './entrypoint';
import { mastra } from './index';
import { createTelemetryRunContext } from './telemetry';
import { TaskContextCompressionStore } from './contextCompression';
import { resolveMissingApiKeyForModel } from '../ipc/streaming';
import { classifyRuntimeErrorMessage } from './runtimeErrorClassifier';
import { resolveRuntimeModelId } from './model/runtimeModel';
import { writeJsonFileAtomic } from './atomicJsonFile';
import { analyzeWorkRequest, type AnalyzeIntentResult } from './workflows/steps/analyze-intent';
import { buildExecutionProfile, type AssessRiskResult } from './workflows/steps/assess-risk';
import { runResearchLoop, type ResearchLoopOutput } from './workflows/steps/research-loop';
import { freezeContract, type FreezeContractOutput } from './workflows/steps/freeze-contract';
import { executeFrozenTask, type ExecuteTaskOutput } from './workflows/steps/execute-task';

type TaskExecutionMode = 'direct' | 'workflow';
const contextCompressionStore = new TaskContextCompressionStore();
const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';
const DEFAULT_WORKFLOW_TIMEOUT_MS = 45_000;
const DEFAULT_WORKFLOW_RETRY_COUNT = 5;
const DEFAULT_WORKFLOW_RETRY_DELAY_MS = 1_000;
const DEFAULT_WORKFLOW_SHORT_RETRY_COUNT = 2;
const DEFAULT_WORKFLOW_BACKOFF_MULTIPLIER = 2;
const DEFAULT_WORKFLOW_BACKOFF_MAX_MS = 15_000;
const DEFAULT_WORKFLOW_JITTER_RATIO = 0.2;
const DEFAULT_STAGED_CHECKPOINT_RETENTION = 120;
const COMMAND_EXECUTION_CAPABILITY = 'command_execution';
const HOST_CONTROL_COMMAND_INTENT_PATTERN = /\b(shutdown|reboot|poweroff|halt)\b|关机|重启/iu;
const INTERNAL_WORKFLOW_RESULT_PATTERNS = [
    /^Seeded from user request:/i,
    /^Task completed via workflow runtime\.?$/i,
];

type ControlPlaneStage =
    | 'analyze-intent'
    | 'assess-risk'
    | 'research-if-needed'
    | 'freeze-contract'
    | 'execute-task';

type ControlPlaneCheckpointRecord = {
    key: string;
    taskId: string;
    turnId: string;
    workspacePath: string;
    messageHash: string;
    createdAt: string;
    updatedAt: string;
    stage: ControlPlaneStage;
    analyzeIntent?: AnalyzeIntentResult;
    assessRisk?: AssessRiskResult;
    research?: ResearchLoopOutput;
    frozenContract?: FreezeContractOutput;
    telemetry?: ControlPlaneTelemetrySnapshot;
};

type WorkflowRetryPolicy = {
    retryCount: number;
    retryDelayMs: number;
    shortRetryCount: number;
    backoffMultiplier: number;
    backoffMaxMs: number;
    jitterRatio: number;
};

type ControlPlaneTelemetrySnapshot = {
    stageDurationsMs: Partial<Record<ControlPlaneStage, number>>;
    stageAttemptCounts: Partial<Record<ControlPlaneStage, number>>;
    stageRetryCounts: Partial<Record<ControlPlaneStage, number>>;
    stageCheckpointHits: Partial<Record<ControlPlaneStage, number>>;
    checkpointLookupCount: number;
    checkpointHitCount: number;
};

type ControlPlaneStageRunResult<T> = {
    value: T;
    attempts: number;
    retries: number;
    durationMs: number;
};

const CONTROL_PLANE_STAGE_ORDER: ControlPlaneStage[] = [
    'analyze-intent',
    'assess-risk',
    'research-if-needed',
    'freeze-contract',
    'execute-task',
];

function resolveAppDataRoot(): string {
    const configured = process.env.COWORKANY_APP_DATA_DIR?.trim();
    return configured && configured.length > 0
        ? configured
        : path.join(process.cwd(), '.coworkany');
}

function hashForCheckpoint(value: string): string {
    return createHash('sha1').update(value).digest('hex');
}

function resolveStageIndex(stage: ControlPlaneStage): number {
    return CONTROL_PLANE_STAGE_ORDER.indexOf(stage);
}

function isStageAtOrAfter(
    current: ControlPlaneStage | undefined,
    expected: ControlPlaneStage,
): boolean {
    if (!current) {
        return false;
    }
    return resolveStageIndex(current) >= resolveStageIndex(expected);
}

function cloneCheckpointRecord(record: ControlPlaneCheckpointRecord): ControlPlaneCheckpointRecord {
    return {
        ...record,
        analyzeIntent: record.analyzeIntent
            ? JSON.parse(JSON.stringify(record.analyzeIntent)) as AnalyzeIntentResult
            : undefined,
        assessRisk: record.assessRisk
            ? JSON.parse(JSON.stringify(record.assessRisk)) as AssessRiskResult
            : undefined,
        research: record.research
            ? JSON.parse(JSON.stringify(record.research)) as ResearchLoopOutput
            : undefined,
        frozenContract: record.frozenContract
            ? JSON.parse(JSON.stringify(record.frozenContract)) as FreezeContractOutput
            : undefined,
        telemetry: cloneControlPlaneTelemetrySnapshot(record.telemetry),
    };
}

function defaultControlPlaneTelemetrySnapshot(): ControlPlaneTelemetrySnapshot {
    return {
        stageDurationsMs: {},
        stageAttemptCounts: {},
        stageRetryCounts: {},
        stageCheckpointHits: {},
        checkpointLookupCount: 0,
        checkpointHitCount: 0,
    };
}

function normalizeNonNegativeNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return value;
}

function parseStageNumberMap(value: unknown): Partial<Record<ControlPlaneStage, number>> {
    const record = toRecord(value);
    if (!record) {
        return {};
    }
    const parsed: Partial<Record<ControlPlaneStage, number>> = {};
    for (const stage of CONTROL_PLANE_STAGE_ORDER) {
        const normalized = normalizeNonNegativeNumber(record[stage]);
        if (normalized === null) {
            continue;
        }
        parsed[stage] = normalized;
    }
    return parsed;
}

function parseControlPlaneTelemetrySnapshot(value: unknown): ControlPlaneTelemetrySnapshot {
    const record = toRecord(value);
    if (!record) {
        return defaultControlPlaneTelemetrySnapshot();
    }
    return {
        stageDurationsMs: parseStageNumberMap(record.stageDurationsMs),
        stageAttemptCounts: parseStageNumberMap(record.stageAttemptCounts),
        stageRetryCounts: parseStageNumberMap(record.stageRetryCounts),
        stageCheckpointHits: parseStageNumberMap(record.stageCheckpointHits),
        checkpointLookupCount: normalizeNonNegativeNumber(record.checkpointLookupCount) ?? 0,
        checkpointHitCount: normalizeNonNegativeNumber(record.checkpointHitCount) ?? 0,
    };
}

function cloneControlPlaneTelemetrySnapshot(
    telemetry?: ControlPlaneTelemetrySnapshot,
): ControlPlaneTelemetrySnapshot {
    const normalized = telemetry ?? defaultControlPlaneTelemetrySnapshot();
    return {
        stageDurationsMs: { ...normalized.stageDurationsMs },
        stageAttemptCounts: { ...normalized.stageAttemptCounts },
        stageRetryCounts: { ...normalized.stageRetryCounts },
        stageCheckpointHits: { ...normalized.stageCheckpointHits },
        checkpointLookupCount: normalized.checkpointLookupCount,
        checkpointHitCount: normalized.checkpointHitCount,
    };
}

function incrementStageMetric(
    target: Partial<Record<ControlPlaneStage, number>>,
    stage: ControlPlaneStage,
    delta: number,
): void {
    target[stage] = (target[stage] ?? 0) + delta;
}

function toCheckpointRecord(value: unknown): ControlPlaneCheckpointRecord | null {
    const raw = toRecord(value);
    if (!raw) {
        return null;
    }
    const key = pickText(raw.key);
    const taskId = pickText(raw.taskId);
    const turnId = pickText(raw.turnId);
    const workspacePath = pickText(raw.workspacePath);
    const messageHash = pickText(raw.messageHash);
    const createdAt = pickText(raw.createdAt);
    const updatedAt = pickText(raw.updatedAt);
    const stage = pickText(raw.stage) as ControlPlaneStage | null;
    if (!key || !taskId || !turnId || !workspacePath || !messageHash || !createdAt || !updatedAt || !stage) {
        return null;
    }
    if (!CONTROL_PLANE_STAGE_ORDER.includes(stage)) {
        return null;
    }
    return {
        key,
        taskId,
        turnId,
        workspacePath,
        messageHash,
        createdAt,
        updatedAt,
        stage,
        analyzeIntent: raw.analyzeIntent as AnalyzeIntentResult | undefined,
        assessRisk: raw.assessRisk as AssessRiskResult | undefined,
        research: raw.research as ResearchLoopOutput | undefined,
        frozenContract: raw.frozenContract as FreezeContractOutput | undefined,
        telemetry: parseControlPlaneTelemetrySnapshot(raw.telemetry),
    };
}

class ControlPlaneCheckpointStore {
    private readonly filePath: string;
    private readonly records = new Map<string, ControlPlaneCheckpointRecord>();
    private readonly maxRecords: number;

    constructor(input?: {
        filePath?: string;
        maxRecords?: number;
    }) {
        this.filePath = input?.filePath
            ?? path.join(resolveAppDataRoot(), 'mastra-control-plane-checkpoints.json');
        this.maxRecords = input?.maxRecords
            ?? readBoundedInt(
                'COWORKANY_MASTRA_TASK_STAGE_CHECKPOINT_MAX_RECORDS',
                DEFAULT_STAGED_CHECKPOINT_RETENTION,
                20,
                1_000,
            );
        this.load();
    }

    get(key: string): ControlPlaneCheckpointRecord | undefined {
        const hit = this.records.get(key);
        return hit ? cloneCheckpointRecord(hit) : undefined;
    }

    upsert(record: ControlPlaneCheckpointRecord): void {
        this.records.set(record.key, cloneCheckpointRecord(record));
        this.prune();
        this.save();
    }

    remove(key: string): void {
        if (!this.records.has(key)) {
            return;
        }
        this.records.delete(key);
        this.save();
    }

    private prune(): void {
        if (this.records.size <= this.maxRecords) {
            return;
        }
        const sorted = Array.from(this.records.values()).sort((left, right) => {
            return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
        });
        const overflow = sorted.length - this.maxRecords;
        for (let index = 0; index < overflow; index += 1) {
            const doomed = sorted[index];
            if (!doomed) {
                continue;
            }
            this.records.delete(doomed.key);
        }
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
            const list = Array.isArray(raw) ? raw : [];
            for (const item of list) {
                const parsed = toCheckpointRecord(item);
                if (!parsed) {
                    continue;
                }
                this.records.set(parsed.key, parsed);
            }
            this.prune();
        } catch {
            // Best-effort load. Malformed files should not block runtime.
        }
    }

    private save(): void {
        try {
            const payload = Array.from(this.records.values());
            writeJsonFileAtomic(this.filePath, payload);
        } catch {
            // Best-effort persistence. Runtime execution must continue.
        }
    }
}

const controlPlaneCheckpointStore = new ControlPlaneCheckpointStore();

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function pickText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function isInternalWorkflowResultText(value: string): boolean {
    return INTERNAL_WORKFLOW_RESULT_PATTERNS.some((pattern) => pattern.test(value));
}

function pickPublicText(value: unknown): string | null {
    const text = pickText(value);
    if (!text) {
        return null;
    }
    return isInternalWorkflowResultText(text) ? null : text;
}

function pickWorkflowResultText(value: unknown): string | null {
    const root = toRecord(value);
    const rootOutput = toRecord(root?.output);
    const rootResponse = toRecord(root?.response);
    const rootPayload = toRecord(root?.payload);
    const preferredCandidates = [
        pickPublicText(root?.result),
        pickPublicText(rootOutput?.result),
        pickPublicText(rootOutput?.text),
        pickPublicText(rootOutput?.message),
        pickPublicText(rootResponse?.result),
        pickPublicText(rootResponse?.text),
        pickPublicText(rootPayload?.result),
        pickPublicText(rootPayload?.text),
        pickPublicText(root?.text),
        pickPublicText(root?.message),
    ];
    for (const candidate of preferredCandidates) {
        if (candidate) {
            return candidate;
        }
    }

    const visited = new Set<object>();
    const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
    const textFields = ['result', 'text', 'message', 'answer', 'finalAnswer', 'content'];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }
        const currentRecord = toRecord(current.value);
        const depth = current.depth;
        if (!currentRecord) {
            continue;
        }
        if (visited.has(currentRecord)) {
            continue;
        }
        visited.add(currentRecord);

        for (const field of textFields) {
            const candidate = pickPublicText(currentRecord[field]);
            if (candidate) {
                return candidate;
            }
        }
        // Keep shallow summary support for explicit workflow outputs,
        // but ignore deep planning/research summaries (e.g. seed evidence).
        if (depth <= 1) {
            const shallowSummary = pickPublicText(currentRecord.summary);
            if (shallowSummary) {
                return shallowSummary;
            }
        }

        const nestedCandidates: unknown[] = [
            currentRecord.result,
            currentRecord.output,
            currentRecord.response,
            currentRecord.data,
            currentRecord.payload,
            currentRecord.steps,
            currentRecord.state,
        ];
        for (const nested of nestedCandidates) {
            if (nested && typeof nested === 'object') {
                queue.push({
                    value: nested,
                    depth: depth + 1,
                });
            }
        }

        for (const nested of Object.values(currentRecord)) {
            if (!nested || typeof nested !== 'object') {
                continue;
            }
            if (Array.isArray(nested)) {
                for (const value of nested) {
                    if (value && typeof value === 'object') {
                        queue.push({
                            value,
                            depth: depth + 1,
                        });
                    }
                }
                continue;
            }
            queue.push({
                value: nested,
                depth: depth + 1,
            });
        }
    }
    return null;
}

function pickWorkflowStatus(value: unknown): string {
    const record = toRecord(value);
    if (!record) {
        return 'unknown';
    }
    return pickText(record.status) ?? 'unknown';
}

function readFlag(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (value == null) {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false;
    }
    return fallback;
}

function readBoundedInt(
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function readBoundedNumber(
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const raw = process.env[name];
    const parsed = Number(raw ?? '');
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveWorkflowRetryDelayMs(input: {
    retryOrdinal: number;
    baseDelayMs: number;
    shortRetryCount: number;
    backoffMultiplier: number;
    backoffMaxMs: number;
    jitterRatio: number;
}): number {
    const retryOrdinal = Math.max(1, Math.floor(input.retryOrdinal));
    let candidate = input.baseDelayMs;
    if (retryOrdinal > input.shortRetryCount) {
        const exponentialIndex = retryOrdinal - input.shortRetryCount;
        candidate = Math.min(
            input.backoffMaxMs,
            Math.round(input.baseDelayMs * Math.pow(input.backoffMultiplier, exponentialIndex)),
        );
    }
    const jitterWindow = Math.max(0, Math.floor(candidate * input.jitterRatio));
    const jitterOffset = jitterWindow > 0
        ? Math.floor((Math.random() * ((jitterWindow * 2) + 1)) - jitterWindow)
        : 0;
    return Math.max(100, candidate + jitterOffset);
}

function isRetryableWorkflowError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /(workflow_run_timeout|workflow_retryable_failure|missing_terminal_after_tooling_progress|No snapshot found for this workflow run|stream_[a-z_]*timeout|execute_task_timeout|generate_fallback_timeout|time(?:d)?\s*out|econnreset|etimedout|socket hang up|network|429|rate.?limit|temporar(?:y|ily)|unavailable|gateway|upstream|unable to get issuer certificate|unable to verify (?:the first|leaf) certificate|self[-\s]?signed certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_[A-Z_]+)/i
        .test(message);
}

function isPersistentTlsTrustFailureMessage(message: string): boolean {
    return /(?:unable to get issuer certificate|unable to verify (?:the first|leaf) certificate|self[-\s]?signed certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_[A-Z_]+|network socket disconnected before secure tls connection was established)/i
        .test(message);
}

function resolveWorkflowRetryPolicy(): WorkflowRetryPolicy {
    const retryDelayMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS',
        DEFAULT_WORKFLOW_RETRY_DELAY_MS,
        100,
        10_000,
    );
    return {
        retryCount: readBoundedInt(
            'COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT',
            DEFAULT_WORKFLOW_RETRY_COUNT,
            0,
            5,
        ),
        retryDelayMs,
        shortRetryCount: readBoundedInt(
            'COWORKANY_MASTRA_TASK_WORKFLOW_SHORT_RETRY_COUNT',
            DEFAULT_WORKFLOW_SHORT_RETRY_COUNT,
            0,
            5,
        ),
        backoffMultiplier: readBoundedNumber(
            'COWORKANY_MASTRA_TASK_WORKFLOW_BACKOFF_MULTIPLIER',
            DEFAULT_WORKFLOW_BACKOFF_MULTIPLIER,
            1.1,
            4,
        ),
        backoffMaxMs: readBoundedInt(
            'COWORKANY_MASTRA_TASK_WORKFLOW_BACKOFF_MAX_MS',
            DEFAULT_WORKFLOW_BACKOFF_MAX_MS,
            retryDelayMs,
            60_000,
        ),
        jitterRatio: readBoundedNumber(
            'COWORKANY_MASTRA_TASK_WORKFLOW_JITTER_RATIO',
            DEFAULT_WORKFLOW_JITTER_RATIO,
            0,
            0.5,
        ),
    };
}

async function emitRetryingEvent(input: {
    delegateInput: TaskMessageExecutionDelegateInput;
    runId?: string;
    message: string;
    attempt: number;
    maxAttempts: number;
    retryAfterMs: number;
    error: unknown;
}): Promise<void> {
    await input.delegateInput.emitDesktopEvent({
        type: 'rate_limited',
        runId: input.runId,
        message: input.message,
        attempt: input.attempt,
        maxAttempts: input.maxAttempts,
        retryAfterMs: input.retryAfterMs,
        error: String(input.error),
        stage: 'unknown',
        turnId: input.delegateInput.turnId,
    });
}

function buildCheckpointKey(input: {
    taskId: string;
    workspacePath: string;
    message: string;
}): string {
    const messageHash = hashForCheckpoint(`${input.workspacePath}\n${input.message}`);
    return `${input.taskId}:${messageHash}`;
}

function getNowIso(): string {
    return new Date().toISOString();
}

async function runControlPlaneStageWithRetry<T>(input: {
    delegateInput: TaskMessageExecutionDelegateInput;
    stage: ControlPlaneStage;
    retryPolicy: WorkflowRetryPolicy;
    execute: (attempt: number) => Promise<T>;
}): Promise<ControlPlaneStageRunResult<T>> {
    const maxAttempts = input.retryPolicy.retryCount + 1;
    const startedAtMs = Date.now();
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const value = await input.execute(attempt);
            return {
                value,
                attempts: attempt + 1,
                retries: attempt,
                durationMs: Date.now() - startedAtMs,
            };
        } catch (error) {
            const canRetry = isRetryableWorkflowError(error)
                && attempt < input.retryPolicy.retryCount;
            if (!canRetry) {
                throw error;
            }
            const retryDelayMs = resolveWorkflowRetryDelayMs({
                retryOrdinal: attempt + 1,
                baseDelayMs: input.retryPolicy.retryDelayMs,
                shortRetryCount: input.retryPolicy.shortRetryCount,
                backoffMultiplier: input.retryPolicy.backoffMultiplier,
                backoffMaxMs: input.retryPolicy.backoffMaxMs,
                jitterRatio: input.retryPolicy.jitterRatio,
            });
            await emitRetryingEvent({
                delegateInput: input.delegateInput,
                message: `Control-plane step "${input.stage}" failed. Retrying (${attempt + 2}/${maxAttempts})...`,
                attempt: attempt + 2,
                maxAttempts,
                retryAfterMs: retryDelayMs,
                error,
            });
            await delay(retryDelayMs);
        }
    }
    throw new Error(`control_plane_step_exhausted:${input.stage}`);
}

function emitControlPlaneTelemetryLog(input: {
    taskId: string;
    turnId: string;
    runId: string;
    traceId: string;
    outcome: 'success' | 'suspended' | 'error';
    suspendedReason?: string;
    errorMessage?: string;
    telemetry: ControlPlaneTelemetrySnapshot;
}): void {
    try {
        const lookupCount = input.telemetry.checkpointLookupCount;
        const hitCount = input.telemetry.checkpointHitCount;
        const checkpointHitRate = lookupCount > 0 ? hitCount / lookupCount : 0;
        console.info('[ControlPlaneTelemetry]', JSON.stringify({
            taskId: input.taskId,
            turnId: input.turnId,
            runId: input.runId,
            traceId: input.traceId,
            outcome: input.outcome,
            suspendedReason: input.suspendedReason ?? null,
            errorMessage: input.errorMessage ?? null,
            checkpoint: {
                lookupCount,
                hitCount,
                missCount: Math.max(0, lookupCount - hitCount),
                hitRate: Number(checkpointHitRate.toFixed(4)),
            },
            stages: {
                durationsMs: input.telemetry.stageDurationsMs,
                attempts: input.telemetry.stageAttemptCounts,
                retries: input.telemetry.stageRetryCounts,
                checkpointHits: input.telemetry.stageCheckpointHits,
            },
            emittedAt: getNowIso(),
        }));
    } catch {
        // Best-effort telemetry log; runtime flow should not fail on logging.
    }
}

function resolveExecutionMode(input: TaskMessageExecutionDelegateInput): TaskExecutionMode {
    const configuredPath = input.executionOptions?.executionPath;
    if (configuredPath === 'workflow') {
        return 'workflow';
    }
    if (configuredPath === 'direct') {
        return 'direct';
    }
    const envDefault = process.env.COWORKANY_TASK_EXECUTION_DEFAULT?.trim().toLowerCase();
    if (envDefault === 'direct') {
        return 'direct';
    }
    if (envDefault === 'workflow') {
        return 'workflow';
    }
    return 'workflow';
}

function normalizeRequiredCapabilities(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0);
}

function shouldUseStagedWorkflowForDirectCommandTask(input: TaskMessageExecutionDelegateInput): boolean {
    if (input.executionOptions?.executionPath !== 'direct') {
        return false;
    }
    if (input.executionOptions?.forcedRouteMode !== 'task') {
        return false;
    }
    // Host-control intents (shutdown/reboot) must stay on direct lane.
    // The staged path depends on model-level tool invocation and can repeatedly
    // fail with missing command-execution evidence before any tool call occurs.
    if (HOST_CONTROL_COMMAND_INTENT_PATTERN.test(input.message)) {
        return false;
    }
    const requiredCapabilities = normalizeRequiredCapabilities(
        input.executionOptions?.requiredCompletionCapabilities,
    );
    return requiredCapabilities.includes(COMMAND_EXECUTION_CAPABILITY);
}

function shouldDisableWorkflowFallbackToDirect(input: TaskMessageExecutionDelegateInput): boolean {
    if (input.executionOptions?.forcedRouteMode !== 'task') {
        return false;
    }
    const requiredCapabilities = normalizeRequiredCapabilities(
        input.executionOptions?.requiredCompletionCapabilities,
    );
    return requiredCapabilities.length > 0;
}

async function runWithStagedWorkflow(input: TaskMessageExecutionDelegateInput): Promise<TaskRuntimeExecutionPath> {
    contextCompressionStore.recordUserTurn({
        taskId: input.taskId,
        threadId: input.preferredThreadId,
        resourceId: input.resourceId,
        workspacePath: input.workspacePath,
        content: input.message,
        turnId: input.turnId,
    });
    const promptPack = contextCompressionStore.buildPromptPack(input.taskId);
    const recalledMemoryFiles = promptPack?.recalledTopicMemories.map((entry) => entry.relativePath) ?? [];
    if (promptPack) {
        input.executionOptions?.onPreCompact?.({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            microSummary: promptPack.microSummary,
            structuredSummary: promptPack.structuredSummary,
            recalledMemoryFiles,
        });
    }

    const modelId = resolveRuntimeModelId(
        input.executionOptions?.modelId,
        DEFAULT_MODEL_ID,
    );
    const missingApiKey = resolveMissingApiKeyForModel(modelId);
    if (missingApiKey) {
        const failureMessage = `missing_api_key:${missingApiKey}`;
        const snapshot = contextCompressionStore.recordAssistantTurn({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            content: failureMessage,
            turnId: input.turnId,
        });
        input.executionOptions?.onPostCompact?.({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            microSummary: snapshot.microSummary,
            structuredSummary: snapshot.structuredSummary,
            recalledMemoryFiles,
        });
        await input.emitDesktopEvent({
            type: 'error',
            runId: `preflight-${randomUUID()}`,
            message: failureMessage,
            turnId: input.turnId,
        });
        return 'workflow';
    }

    const runId = `control-plane-${randomUUID()}`;
    const workspacePath = input.workspacePath ?? process.cwd();
    const telemetry = createTelemetryRunContext({
        taskId: input.taskId,
        threadId: input.preferredThreadId,
        resourceId: input.resourceId,
        workspacePath: input.workspacePath,
    });
    const traceId = telemetry.traceId;
    const checkpointKey = buildCheckpointKey({
        taskId: input.taskId,
        workspacePath,
        message: input.message,
    });
    const messageHash = hashForCheckpoint(`${workspacePath}\n${input.message}`);
    const retryPolicy = resolveWorkflowRetryPolicy();
    let checkpoint = controlPlaneCheckpointStore.get(checkpointKey) ?? {
        key: checkpointKey,
        taskId: input.taskId,
        turnId: input.turnId,
        workspacePath,
        messageHash,
        createdAt: getNowIso(),
        updatedAt: getNowIso(),
        stage: 'analyze-intent' as const,
        telemetry: defaultControlPlaneTelemetrySnapshot(),
    };

    const persistCheckpoint = (patch: Partial<ControlPlaneCheckpointRecord>): void => {
        checkpoint = {
            ...checkpoint,
            ...patch,
            updatedAt: getNowIso(),
        };
        controlPlaneCheckpointStore.upsert(checkpoint);
    };
    const hasStageData = (stage: ControlPlaneStage): boolean => {
        if (!isStageAtOrAfter(checkpoint.stage, stage)) {
            return false;
        }
        if (stage === 'analyze-intent') {
            return Boolean(checkpoint.analyzeIntent);
        }
        if (stage === 'assess-risk') {
            return Boolean(checkpoint.assessRisk);
        }
        if (stage === 'research-if-needed') {
            return Boolean(checkpoint.research);
        }
        if (stage === 'freeze-contract') {
            return Boolean(checkpoint.frozenContract);
        }
        return false;
    };
    const controlPlaneTelemetry = cloneControlPlaneTelemetrySnapshot(checkpoint.telemetry);
    const persistTelemetry = (): void => {
        persistCheckpoint({
            telemetry: cloneControlPlaneTelemetrySnapshot(controlPlaneTelemetry),
        });
    };
    const recordCheckpointLookup = (stage: ControlPlaneStage, hit: boolean): void => {
        controlPlaneTelemetry.checkpointLookupCount += 1;
        if (hit) {
            controlPlaneTelemetry.checkpointHitCount += 1;
            incrementStageMetric(controlPlaneTelemetry.stageCheckpointHits, stage, 1);
        }
        persistTelemetry();
    };
    const recordStageRun = (
        stage: ControlPlaneStage,
        stats: {
            attempts: number;
            retries: number;
            durationMs: number;
        },
    ): void => {
        incrementStageMetric(controlPlaneTelemetry.stageAttemptCounts, stage, stats.attempts);
        incrementStageMetric(controlPlaneTelemetry.stageRetryCounts, stage, stats.retries);
        incrementStageMetric(controlPlaneTelemetry.stageDurationsMs, stage, stats.durationMs);
        persistTelemetry();
    };

    try {
        const hasAnalyzeIntentCheckpoint = hasStageData('analyze-intent') && Boolean(checkpoint.analyzeIntent);
        recordCheckpointLookup('analyze-intent', hasAnalyzeIntentCheckpoint);
        const analyzeIntent = hasAnalyzeIntentCheckpoint && checkpoint.analyzeIntent
            ? checkpoint.analyzeIntent
            : await (async () => {
                const stageRun = await runControlPlaneStageWithRetry({
                    delegateInput: input,
                    stage: 'analyze-intent',
                    retryPolicy,
                    execute: async () => analyzeWorkRequest({
                        userInput: input.message,
                        workspacePath,
                    }),
                });
                recordStageRun('analyze-intent', stageRun);
                persistCheckpoint({
                    stage: 'analyze-intent',
                    analyzeIntent: stageRun.value,
                });
                return stageRun.value;
            })();

        const hasAssessRiskCheckpoint = hasStageData('assess-risk') && Boolean(checkpoint.assessRisk);
        recordCheckpointLookup('assess-risk', hasAssessRiskCheckpoint);
        const assessRisk = hasAssessRiskCheckpoint && checkpoint.assessRisk
            ? checkpoint.assessRisk
            : await (async () => {
                const stageRun = await runControlPlaneStageWithRetry({
                    delegateInput: input,
                    stage: 'assess-risk',
                    retryPolicy,
                    execute: async () => buildExecutionProfile(analyzeIntent.normalized),
                });
                recordStageRun('assess-risk', stageRun);
                persistCheckpoint({
                    stage: 'assess-risk',
                    assessRisk: stageRun.value,
                });
                return stageRun.value;
            })();

        const userActions = assessRisk.userActions ?? [];
        const hasBlockingAction = userActions.some((action) => action.blocking);
        if (hasBlockingAction) {
            if (promptPack) {
                input.executionOptions?.onPostCompact?.({
                    taskId: input.taskId,
                    threadId: input.preferredThreadId,
                    resourceId: input.resourceId,
                    workspacePath: input.workspacePath,
                    microSummary: promptPack.microSummary,
                    structuredSummary: promptPack.structuredSummary,
                    recalledMemoryFiles,
                });
            }
            const questions = userActions
                .flatMap((action) => action.questions ?? [])
                .filter((question): question is string => typeof question === 'string' && question.length > 0);
            emitControlPlaneTelemetryLog({
                taskId: input.taskId,
                turnId: input.turnId,
                runId,
                traceId,
                outcome: 'suspended',
                suspendedReason: 'user_input_required',
                telemetry: controlPlaneTelemetry,
            });
            await input.emitDesktopEvent({
                type: 'suspended',
                runId,
                toolCallId: `workflow-suspend-${input.taskId}`,
                toolName: 'control_plane',
                payload: {
                    questions,
                    reason: 'Waiting for required user input before research/execution.',
                    blocking: true,
                },
                traceId,
                turnId: input.turnId,
            });
            return 'workflow';
        }

        const hasResearchCheckpoint = hasStageData('research-if-needed') && Boolean(checkpoint.research);
        recordCheckpointLookup('research-if-needed', hasResearchCheckpoint);
        const research = hasResearchCheckpoint && checkpoint.research
            ? checkpoint.research
            : await (async () => {
                const stageRun = await runControlPlaneStageWithRetry({
                    delegateInput: input,
                    stage: 'research-if-needed',
                    retryPolicy,
                    execute: async () => runResearchLoop({
                        normalized: analyzeIntent.normalized,
                    }),
                });
                recordStageRun('research-if-needed', stageRun);
                persistCheckpoint({
                    stage: 'research-if-needed',
                    research: stageRun.value,
                });
                return stageRun.value;
            })();

        const hasFreezeContractCheckpoint = hasStageData('freeze-contract') && Boolean(checkpoint.frozenContract);
        recordCheckpointLookup('freeze-contract', hasFreezeContractCheckpoint);
        const frozenContract = hasFreezeContractCheckpoint && checkpoint.frozenContract
            ? checkpoint.frozenContract
            : await (async () => {
                const stageRun = await runControlPlaneStageWithRetry({
                    delegateInput: input,
                    stage: 'freeze-contract',
                    retryPolicy,
                    execute: async () => freezeContract({
                        normalized: research.normalized,
                    }),
                });
                recordStageRun('freeze-contract', stageRun);
                persistCheckpoint({
                    stage: 'freeze-contract',
                    frozenContract: stageRun.value,
                });
                return stageRun.value;
            })();

        if (
            typeof frozenContract.executionQuery !== 'string'
            || frozenContract.executionQuery.trim().length === 0
        ) {
            const failureMessage = 'Execution query is empty after contract freeze; workflow stopped safely.';
            const snapshot = contextCompressionStore.recordAssistantTurn({
                taskId: input.taskId,
                threadId: input.preferredThreadId,
                resourceId: input.resourceId,
                workspacePath: input.workspacePath,
                content: failureMessage,
                turnId: input.turnId,
            });
            input.executionOptions?.onPostCompact?.({
                taskId: input.taskId,
                threadId: input.preferredThreadId,
                resourceId: input.resourceId,
                workspacePath: input.workspacePath,
                microSummary: snapshot.microSummary,
                structuredSummary: snapshot.structuredSummary,
                recalledMemoryFiles,
            });
            emitControlPlaneTelemetryLog({
                taskId: input.taskId,
                turnId: input.turnId,
                runId,
                traceId,
                outcome: 'error',
                errorMessage: failureMessage,
                telemetry: controlPlaneTelemetry,
            });
            await input.emitDesktopEvent({
                type: 'error',
                runId,
                message: failureMessage,
                traceId,
                turnId: input.turnId,
            });
            return 'workflow';
        }

        const requiresCheckpointApproval = (assessRisk.checkpoints ?? [])
            .some((item) => item.requiresUserConfirmation === true);
        if (requiresCheckpointApproval) {
            if (promptPack) {
                input.executionOptions?.onPostCompact?.({
                    taskId: input.taskId,
                    threadId: input.preferredThreadId,
                    resourceId: input.resourceId,
                    workspacePath: input.workspacePath,
                    microSummary: promptPack.microSummary,
                    structuredSummary: promptPack.structuredSummary,
                    recalledMemoryFiles,
                });
            }
            emitControlPlaneTelemetryLog({
                taskId: input.taskId,
                turnId: input.turnId,
                runId,
                traceId,
                outcome: 'suspended',
                suspendedReason: 'checkpoint_approval_required',
                telemetry: controlPlaneTelemetry,
            });
            await input.emitDesktopEvent({
                type: 'suspended',
                runId,
                toolCallId: `workflow-checkpoint-${input.taskId}`,
                toolName: 'control_plane',
                payload: {
                    checkpointTitle: 'Execution checkpoint approval',
                    progress: 0.5,
                    message: 'Execution is waiting for checkpoint approval.',
                },
                traceId,
                turnId: input.turnId,
            });
            return 'workflow';
        }

        const coworker = mastra.getAgent('coworker');
        const requiredCompletionCapabilities = normalizeRequiredCapabilities(
            input.executionOptions?.requiredCompletionCapabilities,
        );
        const executeRun = await runControlPlaneStageWithRetry<ExecuteTaskOutput>({
            delegateInput: input,
            stage: 'execute-task',
            retryPolicy,
            execute: async () => executeFrozenTask({
                coworker,
                task: {
                    frozen: frozenContract.frozen,
                    executionPlan: frozenContract.executionPlan,
                    executionQuery: frozenContract.executionQuery,
                    originalMessage: input.message,
                    requiredCapabilities: requiredCompletionCapabilities,
                },
                workspacePath,
            }),
        });
        recordStageRun('execute-task', executeRun);
        const executed = executeRun.value;
        const syntheticToolNames = executed.toolEvidence.toolNames.slice(0, 12);
        for (const [index, toolName] of syntheticToolNames.entries()) {
            const syntheticToolCallId = `control-plane:${input.taskId}:${input.turnId ?? 'turn'}:${index}`;
            await input.emitDesktopEvent({
                type: 'tool_call',
                runId,
                toolName,
                args: {
                    synthetic: true,
                    source: 'control_plane_execute_task',
                    observedToolCallCount: executed.toolEvidence.toolCallCount,
                    observedCommandToolCallCount: executed.toolEvidence.commandToolCallCount,
                },
                traceId,
                turnId: input.turnId,
            });
            await input.emitDesktopEvent({
                type: 'tool_result',
                runId,
                toolCallId: syntheticToolCallId,
                toolName,
                result: {
                    synthetic: true,
                    success: true,
                    source: 'control_plane_execute_task',
                    observedToolCallCount: executed.toolEvidence.toolCallCount,
                    observedCommandToolCallCount: executed.toolEvidence.commandToolCallCount,
                },
                traceId,
                turnId: input.turnId,
            });
        }

        const summary = pickText(executed.result);
        if (!summary) {
            throw new Error('workflow_missing_assistant_narrative');
        }
        const snapshot = contextCompressionStore.recordAssistantTurn({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            content: summary,
            turnId: input.turnId,
        });
        input.executionOptions?.onPostCompact?.({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            microSummary: snapshot.microSummary,
            structuredSummary: snapshot.structuredSummary,
            recalledMemoryFiles,
        });
        await input.emitDesktopEvent({
            type: 'text_delta',
            runId,
            role: 'assistant',
            content: summary,
            traceId,
            turnId: input.turnId,
        });
        await input.emitDesktopEvent({
            type: 'complete',
            runId,
            finishReason: executed.completed ? 'workflow:success' : 'workflow:incomplete',
            traceId,
            turnId: input.turnId,
        });
        emitControlPlaneTelemetryLog({
            taskId: input.taskId,
            turnId: input.turnId,
            runId,
            traceId,
            outcome: 'success',
            telemetry: controlPlaneTelemetry,
        });
        controlPlaneCheckpointStore.remove(checkpointKey);
        return 'workflow';
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const classification = classifyRuntimeErrorMessage(message);
        const missingRequiredToolEvidence = /workflow_missing_required_tool_evidence/i.test(message);
        if (classification.failureClass === 'retryable' || missingRequiredToolEvidence) {
            throw error;
        }
        const snapshot = contextCompressionStore.recordAssistantTurn({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            content: message,
            turnId: input.turnId,
        });
        input.executionOptions?.onPostCompact?.({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            microSummary: snapshot.microSummary,
            structuredSummary: snapshot.structuredSummary,
            recalledMemoryFiles,
        });
        emitControlPlaneTelemetryLog({
            taskId: input.taskId,
            turnId: input.turnId,
            runId,
            traceId,
            outcome: 'error',
            errorMessage: message,
            telemetry: controlPlaneTelemetry,
        });
        await input.emitDesktopEvent({
            type: 'error',
            runId,
            message,
            traceId,
            turnId: input.turnId,
        });
        return 'workflow';
    }
}

async function runWithWorkflow(input: TaskMessageExecutionDelegateInput): Promise<TaskRuntimeExecutionPath> {
    contextCompressionStore.recordUserTurn({
        taskId: input.taskId,
        threadId: input.preferredThreadId,
        resourceId: input.resourceId,
        workspacePath: input.workspacePath,
        content: input.message,
        turnId: input.turnId,
    });
    const promptPack = contextCompressionStore.buildPromptPack(input.taskId);
    const recalledMemoryFiles = promptPack?.recalledTopicMemories.map((entry) => entry.relativePath) ?? [];
    if (promptPack) {
        input.executionOptions?.onPreCompact?.({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            microSummary: promptPack.microSummary,
            structuredSummary: promptPack.structuredSummary,
            recalledMemoryFiles,
        });
    }
    const modelId = resolveRuntimeModelId(
        input.executionOptions?.modelId,
        DEFAULT_MODEL_ID,
    );
    const missingApiKey = resolveMissingApiKeyForModel(modelId);
    if (missingApiKey) {
        const failureMessage = `missing_api_key:${missingApiKey}`;
        const snapshot = contextCompressionStore.recordAssistantTurn({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            content: failureMessage,
            turnId: input.turnId,
        });
        input.executionOptions?.onPostCompact?.({
            taskId: input.taskId,
            threadId: input.preferredThreadId,
            resourceId: input.resourceId,
            workspacePath: input.workspacePath,
            microSummary: snapshot.microSummary,
            structuredSummary: snapshot.structuredSummary,
            recalledMemoryFiles,
        });
        await input.emitDesktopEvent({
            type: 'error',
            runId: `preflight-${randomUUID()}`,
            message: failureMessage,
            turnId: input.turnId,
        });
        return 'workflow';
    }
    const workflowUserInput = input.message;
    const workflow = mastra.getWorkflow('controlPlane');
    const telemetry = createTelemetryRunContext({
        taskId: input.taskId,
        threadId: input.preferredThreadId,
        resourceId: input.resourceId,
        workspacePath: input.workspacePath,
    });
    const workflowTimeoutMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS',
        DEFAULT_WORKFLOW_TIMEOUT_MS,
        500,
        120_000,
    );
    const workflowRetryCount = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT',
        DEFAULT_WORKFLOW_RETRY_COUNT,
        0,
        5,
    );
    const workflowRetryDelayMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS',
        DEFAULT_WORKFLOW_RETRY_DELAY_MS,
        100,
        10_000,
    );
    const workflowShortRetryCount = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_SHORT_RETRY_COUNT',
        DEFAULT_WORKFLOW_SHORT_RETRY_COUNT,
        0,
        5,
    );
    const workflowBackoffMultiplier = readBoundedNumber(
        'COWORKANY_MASTRA_TASK_WORKFLOW_BACKOFF_MULTIPLIER',
        DEFAULT_WORKFLOW_BACKOFF_MULTIPLIER,
        1.1,
        4,
    );
    const workflowBackoffMaxMs = readBoundedInt(
        'COWORKANY_MASTRA_TASK_WORKFLOW_BACKOFF_MAX_MS',
        DEFAULT_WORKFLOW_BACKOFF_MAX_MS,
        workflowRetryDelayMs,
        60_000,
    );
    const workflowJitterRatio = readBoundedNumber(
        'COWORKANY_MASTRA_TASK_WORKFLOW_JITTER_RATIO',
        DEFAULT_WORKFLOW_JITTER_RATIO,
        0,
        0.5,
    );
    const maxAttempts = workflowRetryCount + 1;

    for (let attempt = 0; attempt <= workflowRetryCount; attempt += 1) {
        const runId = `control-plane-${randomUUID()}`;
        try {
            const run = await workflow.createRun({
                runId,
                resourceId: input.resourceId,
            });
            const abortController = new AbortController();
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const startPayload = {
                inputData: {
                    userInput: workflowUserInput,
                    workspacePath: input.workspacePath ?? process.cwd(),
                },
                tracingOptions: telemetry.tracingOptions,
                outputOptions: {
                    includeState: true,
                    includeResumeLabels: true,
                },
                signal: abortController.signal,
            };
            const result = await (async () => {
                try {
                    return await Promise.race([
                        (run.start as (input: unknown) => Promise<unknown>)(startPayload),
                        new Promise<never>((_, reject) => {
                            timeoutId = setTimeout(() => {
                                abortController.abort(new Error('workflow_run_timeout'));
                                reject(new Error(`workflow_run_timeout:${workflowTimeoutMs}`));
                            }, workflowTimeoutMs);
                        }),
                    ]);
                } finally {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                }
            })();

            const status = pickWorkflowStatus(result);
            if (status === 'suspended') {
                if (promptPack) {
                    input.executionOptions?.onPostCompact?.({
                        taskId: input.taskId,
                        threadId: input.preferredThreadId,
                        resourceId: input.resourceId,
                        workspacePath: input.workspacePath,
                        microSummary: promptPack.microSummary,
                        structuredSummary: promptPack.structuredSummary,
                        recalledMemoryFiles,
                    });
                }
                await input.emitDesktopEvent({
                    type: 'suspended',
                    runId,
                    toolCallId: `workflow-suspend-${input.taskId}`,
                    toolName: 'control_plane',
                    payload: result,
                    turnId: input.turnId,
                });
                return 'workflow';
            }
            if (status === 'failed' || status === 'tripwire') {
                const failureMessage = pickWorkflowResultText(result) ?? `control_plane_failed:${status}`;
                const failureClassification = classifyRuntimeErrorMessage(failureMessage);
                const persistentTlsTrustFailure = isPersistentTlsTrustFailureMessage(failureMessage);
                const canRetry = failureClassification.failureClass === 'retryable'
                    && !persistentTlsTrustFailure
                    && attempt < workflowRetryCount;
                if (canRetry) {
                    const retryDelayMs = resolveWorkflowRetryDelayMs({
                        retryOrdinal: attempt + 1,
                        baseDelayMs: workflowRetryDelayMs,
                        shortRetryCount: workflowShortRetryCount,
                        backoffMultiplier: workflowBackoffMultiplier,
                        backoffMaxMs: workflowBackoffMaxMs,
                        jitterRatio: workflowJitterRatio,
                    });
                    await input.emitDesktopEvent({
                        type: 'rate_limited',
                        runId,
                        message: `Workflow execution delayed. Retrying (${attempt + 2}/${maxAttempts})...`,
                        attempt: attempt + 2,
                        maxAttempts,
                        retryAfterMs: retryDelayMs,
                        error: failureMessage,
                        stage: 'unknown',
                        turnId: input.turnId,
                    });
                    await delay(retryDelayMs);
                    continue;
                }
                if (failureClassification.failureClass === 'retryable' && !persistentTlsTrustFailure) {
                    throw new Error(`workflow_retryable_failure:${failureMessage}`);
                }
                const snapshot = contextCompressionStore.recordAssistantTurn({
                    taskId: input.taskId,
                    threadId: input.preferredThreadId,
                    resourceId: input.resourceId,
                    workspacePath: input.workspacePath,
                    content: failureMessage,
                    turnId: input.turnId,
                });
                input.executionOptions?.onPostCompact?.({
                    taskId: input.taskId,
                    threadId: input.preferredThreadId,
                    resourceId: input.resourceId,
                    workspacePath: input.workspacePath,
                    microSummary: snapshot.microSummary,
                    structuredSummary: snapshot.structuredSummary,
                    recalledMemoryFiles,
                });
                await input.emitDesktopEvent({
                    type: 'error',
                    runId,
                    message: failureMessage,
                    turnId: input.turnId,
                });
                return 'workflow';
            }
            const summary = pickWorkflowResultText(result);
            if (!summary) {
                throw new Error('workflow_missing_assistant_narrative');
            }
            const snapshot = contextCompressionStore.recordAssistantTurn({
                taskId: input.taskId,
                threadId: input.preferredThreadId,
                resourceId: input.resourceId,
                workspacePath: input.workspacePath,
                content: summary,
                turnId: input.turnId,
            });
            input.executionOptions?.onPostCompact?.({
                taskId: input.taskId,
                threadId: input.preferredThreadId,
                resourceId: input.resourceId,
                workspacePath: input.workspacePath,
                microSummary: snapshot.microSummary,
                structuredSummary: snapshot.structuredSummary,
                recalledMemoryFiles,
            });
            await input.emitDesktopEvent({
                type: 'text_delta',
                runId,
                role: 'assistant',
                content: summary,
                turnId: input.turnId,
            });
            await input.emitDesktopEvent({
                type: 'complete',
                runId,
                finishReason: `workflow:${status}`,
                turnId: input.turnId,
            });
            return 'workflow';
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const persistentTlsTrustFailure = isPersistentTlsTrustFailureMessage(message);
            const canRetry = isRetryableWorkflowError(error)
                && !persistentTlsTrustFailure
                && attempt < workflowRetryCount;
            if (!canRetry) {
                throw error;
            }
            const retryDelayMs = resolveWorkflowRetryDelayMs({
                retryOrdinal: attempt + 1,
                baseDelayMs: workflowRetryDelayMs,
                shortRetryCount: workflowShortRetryCount,
                backoffMultiplier: workflowBackoffMultiplier,
                backoffMaxMs: workflowBackoffMaxMs,
                jitterRatio: workflowJitterRatio,
            });
            await input.emitDesktopEvent({
                type: 'rate_limited',
                message: `Workflow request timed out. Retrying (${attempt + 2}/${maxAttempts})...`,
                attempt: attempt + 2,
                maxAttempts,
                retryAfterMs: retryDelayMs,
                error: String(error),
                stage: 'unknown',
                turnId: input.turnId,
            });
            await delay(retryDelayMs);
        }
    }

    throw new Error('workflow_exhausted_without_result');
}

export function createMastraTaskExecutionService(): {
    executeTaskMessage: (
        input: TaskMessageExecutionDelegateInput,
    ) => Promise<TaskMessageExecutionDelegateResult>;
} {
    const stagedCheckpointRetryEnabled = readFlag(
        'COWORKANY_MASTRA_TASK_STAGED_CHECKPOINT_RETRY_ENABLED',
        true,
    );
    const directCommandStagedExecutionEnabled = readFlag(
        'COWORKANY_MASTRA_TASK_DIRECT_COMMAND_STAGED_EXECUTION_ENABLED',
        false,
    );
    const workflowFallbackToDirect = readFlag(
        'COWORKANY_WORKFLOW_EXECUTION_FALLBACK_TO_DIRECT',
        true,
    );
    return {
        executeTaskMessage: async (input): Promise<TaskMessageExecutionDelegateResult> => {
            const disableWorkflowFallbackToDirect = shouldDisableWorkflowFallbackToDirect(input);
            const mode = resolveExecutionMode(input);
            if (mode === 'direct') {
                const shouldUseStagedWorkflow = (
                    stagedCheckpointRetryEnabled
                    && directCommandStagedExecutionEnabled
                    && shouldUseStagedWorkflowForDirectCommandTask(input)
                );
                if (!shouldUseStagedWorkflow) {
                    await input.runDirect();
                    return { executionPath: 'direct' };
                }
                try {
                    await runWithStagedWorkflow({
                        ...input,
                        executionOptions: {
                            ...input.executionOptions,
                            executionPath: 'workflow',
                            forcedRouteMode: 'task',
                        },
                    });
                    return { executionPath: 'direct' };
                } catch (error) {
                    if (!workflowFallbackToDirect || disableWorkflowFallbackToDirect) {
                        throw error;
                    }
                    await input.runDirect();
                    return { executionPath: 'workflow_fallback' };
                }
            }
            try {
                const executionPath = stagedCheckpointRetryEnabled
                    ? await runWithStagedWorkflow(input)
                    : await runWithWorkflow(input);
                return { executionPath };
            } catch (error) {
                if (!workflowFallbackToDirect || disableWorkflowFallbackToDirect) {
                    throw error;
                }
                await input.runDirect();
                return { executionPath: 'workflow_fallback' };
            }
        },
    };
}
