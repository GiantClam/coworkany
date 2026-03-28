import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { type FrozenWorkRequest, type PresentationContract } from '../orchestration/workRequestSchema';
import type { PlatformRuntimeContext } from '../protocol/commands';
import {
    CHAINED_SCHEDULE_PATTERN,
    INLINE_CHINESE_RELATIVE_TIME_PATTERN,
    INLINE_ENGLISH_RELATIVE_TIME_PATTERN,
    LEADING_CHINESE_RELATIVE_TIME_PATTERN,
    LEADING_ENGLISH_RELATIVE_TIME_PATTERN,
    RECURRING_INTERVAL_PATTERN,
    RECURRING_MARKER_PATTERN,
    RECURRING_NOW_EXPRESSION_PATTERN,
    resolveRelativeUnitKind,
    SCHEDULED_TASK_PREFIX_PATTERNS,
    SPEECH_DIRECTIVE_PATTERN_SOURCES,
    SPEECH_FALLBACK_MARKER_PATTERN,
    STRIP_DANGLING_SPEECH_TAIL_PATTERN,
} from './scheduledTaskRules';

export interface ScheduledTaskConfig {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    disabledTools?: string[];
    environmentContext?: PlatformRuntimeContext;
}

export type ScheduledTaskStatus =
    | 'scheduled'
    | 'running'
    | 'suspended_waiting_user'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface ScheduledTaskRecord {
    id: string;
    title: string;
    taskQuery: string;
    workRequestId?: string;
    stageTaskId?: string;
    stageIndex?: number;
    totalStages?: number;
    delayMsFromPrevious?: number;
    previousStageSummary?: string;
    previousStageArtifacts?: string[];
    frozenWorkRequest?: FrozenWorkRequest;
    workspacePath: string;
    createdAt: string;
    executeAt: string;
    status: ScheduledTaskStatus;
    speakResult: boolean;
    sourceTaskId?: string;
    config?: ScheduledTaskConfig;
    resultSummary?: string;
    error?: string;
    startedAt?: string;
    completedAt?: string;
}

export interface ScheduledTaskInput {
    title: string;
    taskQuery: string;
    workRequestId?: string;
    stageTaskId?: string;
    stageIndex?: number;
    totalStages?: number;
    delayMsFromPrevious?: number;
    previousStageSummary?: string;
    previousStageArtifacts?: string[];
    frozenWorkRequest?: FrozenWorkRequest;
    workspacePath: string;
    executeAt: Date;
    speakResult: boolean;
    sourceTaskId?: string;
    config?: ScheduledTaskConfig;
}

export interface ParsedScheduledIntent {
    executeAt: Date;
    taskQuery: string;
    speakResult: boolean;
    originalTimeExpression: string;
    recurrence?: { kind: 'rrule'; value: string };
    chainedStages?: ChainedScheduledStageIntent[];
}

export interface ChainedScheduledStageIntent {
    delayMsFromPrevious: number;
    taskQuery: string;
    originalTimeExpression: string;
}

export interface RecoverStaleRunningOptions {
    now?: Date;
    timeoutMs: number;
    errorMessage?: string;
}

function normalizeRecords(raw: unknown): ScheduledTaskRecord[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .filter((entry): entry is ScheduledTaskRecord => {
            if (!entry || typeof entry !== 'object') return false;
            const candidate = entry as Partial<ScheduledTaskRecord>;
            return (
                typeof candidate.id === 'string' &&
                typeof candidate.title === 'string' &&
                typeof candidate.taskQuery === 'string' &&
                typeof candidate.workspacePath === 'string' &&
                typeof candidate.createdAt === 'string' &&
                typeof candidate.executeAt === 'string' &&
                typeof candidate.status === 'string' &&
                typeof candidate.speakResult === 'boolean'
            );
        })
        .map((entry) => ({
            ...entry,
            workRequestId: typeof entry.workRequestId === 'string' ? entry.workRequestId : undefined,
            stageTaskId: typeof entry.stageTaskId === 'string' ? entry.stageTaskId : undefined,
            stageIndex: typeof entry.stageIndex === 'number' ? entry.stageIndex : undefined,
            totalStages: typeof entry.totalStages === 'number' ? entry.totalStages : undefined,
            delayMsFromPrevious: typeof entry.delayMsFromPrevious === 'number' ? entry.delayMsFromPrevious : undefined,
            previousStageSummary: typeof entry.previousStageSummary === 'string'
                ? entry.previousStageSummary
                : undefined,
            previousStageArtifacts: Array.isArray(entry.previousStageArtifacts)
                ? entry.previousStageArtifacts.filter((artifact): artifact is string => typeof artifact === 'string')
                : undefined,
            frozenWorkRequest: entry.frozenWorkRequest && typeof entry.frozenWorkRequest === 'object'
                ? entry.frozenWorkRequest
                : undefined,
            config: entry.config ? { ...entry.config } : undefined,
        }));
}

function migrateScheduledTaskRecord(record: ScheduledTaskRecord): {
    record: ScheduledTaskRecord;
    changed: boolean;
} {
    const frozenWorkRequest = record.frozenWorkRequest;
    if (!frozenWorkRequest) {
        return { record, changed: false };
    }

    const currentPresentation = frozenWorkRequest.presentation;
    const uiFormat =
        currentPresentation?.uiFormat === 'table' ||
        currentPresentation?.uiFormat === 'report' ||
        currentPresentation?.uiFormat === 'artifact'
            ? currentPresentation.uiFormat
            : 'chat_message';
    const nextPresentation: PresentationContract = {
        uiFormat,
        ttsEnabled: currentPresentation?.ttsEnabled ?? record.speakResult,
        ttsMode: 'full',
        ttsMaxChars: 0,
        language: typeof currentPresentation?.language === 'string' && currentPresentation.language.trim().length > 0
            ? currentPresentation.language
            : 'zh-CN',
    };

    const changed =
        !currentPresentation ||
        currentPresentation.ttsMode !== nextPresentation.ttsMode ||
        currentPresentation.ttsMaxChars !== nextPresentation.ttsMaxChars ||
        currentPresentation.ttsEnabled !== nextPresentation.ttsEnabled ||
        currentPresentation.language !== nextPresentation.language ||
        currentPresentation.uiFormat !== nextPresentation.uiFormat;

    if (!changed) {
        return { record, changed: false };
    }

    return {
        changed: true,
        record: {
            ...record,
            frozenWorkRequest: {
                ...frozenWorkRequest,
                presentation: nextPresentation,
            },
        },
    };
}

function parseChineseNumber(raw: string): number {
    if (/^\d+$/.test(raw)) {
        return Number(raw);
    }

    const normalized = raw.replace(/兩/g, '两').replace(/零/g, '〇');
    const digits: Record<string, number> = {
        '〇': 0,
        '一': 1,
        '二': 2,
        '两': 2,
        '三': 3,
        '四': 4,
        '五': 5,
        '六': 6,
        '七': 7,
        '八': 8,
        '九': 9,
    };

    if (normalized === '十') {
        return 10;
    }

    const tenIndex = normalized.indexOf('十');
    if (tenIndex >= 0) {
        const tensRaw = normalized.slice(0, tenIndex);
        const onesRaw = normalized.slice(tenIndex + 1);
        const tens = tensRaw ? (digits[tensRaw] ?? 0) : 1;
        const ones = onesRaw ? (digits[onesRaw] ?? 0) : 0;
        return tens * 10 + ones;
    }

    return normalized
        .split('')
        .reduce((acc, char) => acc * 10 + (digits[char] ?? 0), 0);
}

function parseRelativeTimeExpression(expression: string, now: Date): Date | null {
    const lower = expression.trim().toLowerCase();

    const englishMatch = lower.match(INLINE_ENGLISH_RELATIVE_TIME_PATTERN);
    if (englishMatch) {
        const amount = Number(englishMatch[1]);
        const unitKind = resolveRelativeUnitKind(englishMatch[2] ?? '');
        const result = new Date(now);
        if (unitKind === 'second') {
            result.setSeconds(result.getSeconds() + amount);
        } else if (unitKind === 'minute') {
            result.setMinutes(result.getMinutes() + amount);
        } else if (unitKind === 'hour') {
            result.setHours(result.getHours() + amount);
        } else if (unitKind === 'day') {
            result.setDate(result.getDate() + amount);
        } else {
            return null;
        }
        return result;
    }

    const chineseMatch = expression.trim().match(INLINE_CHINESE_RELATIVE_TIME_PATTERN);
    if (chineseMatch) {
        const amount = parseChineseNumber(chineseMatch[1]);
        const unitKind = resolveRelativeUnitKind(chineseMatch[2] ?? '');
        const result = new Date(now);
        if (unitKind === 'second') {
            result.setSeconds(result.getSeconds() + amount);
        } else if (unitKind === 'minute') {
            result.setMinutes(result.getMinutes() + amount);
        } else if (unitKind === 'hour') {
            result.setHours(result.getHours() + amount);
        } else if (unitKind === 'day') {
            result.setDate(result.getDate() + amount);
        } else {
            return null;
        }
        return result;
    }

    if (lower.includes('tomorrow')) {
        const result = new Date(now);
        result.setDate(result.getDate() + 1);
        result.setHours(9, 0, 0, 0);
        return result;
    }

    return null;
}

type RecurrenceSpec = {
    rrule: string;
    intervalMs: number;
};

type RecurringIntervalParse = {
    amount: number;
    unitRaw: string;
    taskQueryRaw: string;
};

function stripScheduledTaskPrefix(input: string): string {
    let normalized = input.trim();
    for (const pattern of SCHEDULED_TASK_PREFIX_PATTERNS) {
        normalized = normalized.replace(pattern, '').trim();
    }
    return normalized;
}

function parseRecurringAmount(raw: string | undefined): number {
    if (!raw) {
        return 1;
    }
    return /[零〇一二两兩三四五六七八九十百]/u.test(raw)
        ? parseChineseNumber(raw)
        : Number(raw);
}

function normalizeRecurringStartExpression(raw: string): string {
    return raw
        .trim()
        .replace(/^[，,、:\-\s]+/u, '')
        .replace(/[，,、:\-\s]+$/u, '')
        .replace(/^(?:请)?(?:(?:帮我|帮忙|麻烦你)\s*)?(?:在)?\s*/u, '')
        .replace(/^(?:please\s+)?(?:(?:help\s+me|could\s+you)\s+)?/iu, '')
        .trim();
}

function parseRecurringStartExecuteAt(prefixRaw: string, now: Date): Date | null {
    const normalized = normalizeRecurringStartExpression(prefixRaw);
    if (!normalized || RECURRING_NOW_EXPRESSION_PATTERN.test(normalized)) {
        return new Date(now);
    }
    const trimmedStartTail = normalized
        .replace(/(?:开始|起|starting|beginning|begin)\s*$/iu, '')
        .replace(/[，,、:\-\s]+$/u, '')
        .trim();
    if (!trimmedStartTail || RECURRING_NOW_EXPRESSION_PATTERN.test(trimmedStartTail)) {
        return new Date(now);
    }
    try {
        return parseScheduledTimeExpression(trimmedStartTail, now);
    } catch {
        return null;
    }
}

function parseRecurringIntervalCandidate(candidate: string): RecurringIntervalParse | null {
    const markerMatch = RECURRING_MARKER_PATTERN.exec(candidate);
    if (!markerMatch || markerMatch.index === undefined) {
        return null;
    }

    const markerIndex = markerMatch.index;
    const markerText = markerMatch[0] ?? '';
    const suffix = candidate.slice(markerIndex + markerText.length).trim();
    if (!suffix) {
        return null;
    }

    const intervalMatch = suffix.match(RECURRING_INTERVAL_PATTERN);
    if (!intervalMatch) {
        return null;
    }

    const amount = parseRecurringAmount(intervalMatch[1]);
    const unitRaw = intervalMatch[2];
    if (!Number.isFinite(amount) || amount <= 0 || !unitRaw) {
        return null;
    }

    const afterIntervalRaw = suffix.slice(intervalMatch[0].length);
    const isEnglishUnit = /^[a-z]/i.test(unitRaw);
    if (isEnglishUnit && afterIntervalRaw.length > 0 && !/^[\s,:-]/.test(afterIntervalRaw)) {
        return null;
    }

    const taskQueryRaw = afterIntervalRaw.replace(/^[\s,:，、-]+/u, '').trim();
    if (!taskQueryRaw) {
        return null;
    }

    return {
        amount,
        unitRaw,
        taskQueryRaw,
    };
}

function extractLeadingScheduleExpression(candidate: string): {
    originalTimeExpression: string;
    taskQueryRaw: string;
} | null {
    const chineseMatch = candidate.match(LEADING_CHINESE_RELATIVE_TIME_PATTERN);
    if (chineseMatch?.[1] && chineseMatch[2]) {
        return {
            originalTimeExpression: chineseMatch[1].replace(/\s+/g, ''),
            taskQueryRaw: chineseMatch[2],
        };
    }

    const englishMatch = candidate.match(LEADING_ENGLISH_RELATIVE_TIME_PATTERN);
    if (englishMatch?.[1] && englishMatch[2]) {
        return {
            originalTimeExpression: englishMatch[1].toLowerCase().replace(/\s+/g, ' ').trim(),
            taskQueryRaw: englishMatch[2],
        };
    }

    return null;
}

function buildRecurrenceSpec(
    amount: number,
    unitRaw: string
): RecurrenceSpec | null {
    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }

    const unitKind = resolveRelativeUnitKind(unitRaw);
    if (unitKind === 'minute') {
        return {
            rrule: `FREQ=MINUTELY;INTERVAL=${amount}`,
            intervalMs: amount * 60_000,
        };
    }
    if (unitKind === 'hour') {
        return {
            rrule: `FREQ=HOURLY;INTERVAL=${amount}`,
            intervalMs: amount * 60 * 60_000,
        };
    }
    if (unitKind === 'day') {
        return {
            rrule: `FREQ=DAILY;INTERVAL=${amount}`,
            intervalMs: amount * 24 * 60 * 60_000,
        };
    }

    return null;
}

function parseRecurringIntent(candidate: string, now: Date): ParsedScheduledIntent | null {
    const markerMatch = RECURRING_MARKER_PATTERN.exec(candidate);
    if (!markerMatch || markerMatch.index === undefined) {
        return null;
    }
    const markerIndex = markerMatch.index;
    const markerText = markerMatch[0] ?? '';

    const intervalParse = parseRecurringIntervalCandidate(candidate);
    if (!intervalParse) {
        return null;
    }

    const recurrence = buildRecurrenceSpec(intervalParse.amount, intervalParse.unitRaw);
    if (!recurrence) {
        return null;
    }

    const prefixRaw = candidate.slice(0, markerIndex);
    const executeAt = parseRecurringStartExecuteAt(prefixRaw, now);
    if (!executeAt) {
        return null;
    }

    const { taskQuery, speakResult } = stripSpeechDirective(intervalParse.taskQueryRaw);
    if (!taskQuery) {
        return null;
    }

    const originalTimeExpression = markerText.startsWith('每')
        ? `每${intervalParse.amount}${intervalParse.unitRaw}`
        : `every ${intervalParse.amount} ${intervalParse.unitRaw}`;

    return {
        executeAt,
        taskQuery,
        speakResult,
        originalTimeExpression,
        recurrence: { kind: 'rrule', value: recurrence.rrule },
    };
}

function normalizeRelativeExpressionForDuration(raw: string): string {
    const trimmed = raw.trim();
    if (/^in\s+/i.test(trimmed)) {
        return trimmed.toLowerCase();
    }
    if (/(?:以?后|之?后)$/u.test(trimmed)) {
        return trimmed;
    }
    return `${trimmed}后`;
}

function parseRelativeDurationMs(expression: string): number | null {
    const anchor = new Date('2026-01-01T00:00:00.000Z');
    const parsed = parseRelativeTimeExpression(expression, anchor);
    if (!parsed) {
        return null;
    }
    const delayMs = parsed.getTime() - anchor.getTime();
    return delayMs > 0 ? delayMs : null;
}

function trimTaskSegment(input: string): string {
    return input
        .replace(/^[，,、\s]+/u, '')
        .replace(/[，,、。.!！；;\s]+$/u, '')
        .trim();
}

function extractChainedScheduledStages(taskQuery: string): {
    primaryTaskQuery: string;
    chainedStages: ChainedScheduledStageIntent[];
} {
    const matches: Array<{
        index: number;
        fullMatch: string;
        expression: string;
    }> = [];

    const regex = new RegExp(CHAINED_SCHEDULE_PATTERN.source, CHAINED_SCHEDULE_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(taskQuery)) !== null) {
        const expression = match[1]?.trim();
        if (!expression) {
            continue;
        }
        matches.push({
            index: match.index,
            fullMatch: match[0] ?? '',
            expression,
        });
    }

    if (matches.length === 0) {
        return {
            primaryTaskQuery: taskQuery.trim(),
            chainedStages: [],
        };
    }

    const primaryTaskQuery = trimTaskSegment(taskQuery.slice(0, matches[0]!.index));
    const chainedStages: ChainedScheduledStageIntent[] = [];

    for (let index = 0; index < matches.length; index += 1) {
        const current = matches[index]!;
        const next = matches[index + 1];
        const stageStart = current.index + current.fullMatch.length;
        const stageEnd = next ? next.index : taskQuery.length;
        const stageQuery = trimTaskSegment(taskQuery.slice(stageStart, stageEnd).replace(/^(?:将|把)\s*/u, ''));
        const normalizedExpression = normalizeRelativeExpressionForDuration(current.expression);
        const delayMs = parseRelativeDurationMs(normalizedExpression);
        if (!stageQuery || delayMs === null) {
            continue;
        }
        chainedStages.push({
            delayMsFromPrevious: delayMs,
            taskQuery: stageQuery,
            originalTimeExpression: current.expression.replace(/\s+/g, ''),
        });
    }

    if (!primaryTaskQuery || chainedStages.length === 0) {
        return {
            primaryTaskQuery: taskQuery.trim(),
            chainedStages: [],
        };
    }

    return {
        primaryTaskQuery,
        chainedStages,
    };
}

function stripDanglingSpeechTail(input: string): string {
    return input
        .replace(STRIP_DANGLING_SPEECH_TAIL_PATTERN, '')
        .replace(/[，,、\s]+$/u, '')
        .trim();
}

function cleanupSpeechDirectiveRemoval(input: string): string {
    return input
        .replace(/[，,、]\s*(?=[。.!！；;])/gu, '')
        .replace(/[。.!！；;]{2,}/gu, '。')
        .replace(/[，,、]{2,}/gu, '，')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function stripSpeechDirective(input: string): { taskQuery: string; speakResult: boolean } {
    let stripped = input;
    let speakResult = false;
    for (const patternSource of SPEECH_DIRECTIVE_PATTERN_SOURCES) {
        const pattern = new RegExp(patternSource, 'giu');
        const next = stripped.replace(pattern, '');
        if (next !== stripped) {
            stripped = next;
            speakResult = true;
        }
    }

    return {
        taskQuery: stripDanglingSpeechTail(cleanupSpeechDirectiveRemoval(stripped)),
        speakResult: speakResult || SPEECH_FALLBACK_MARKER_PATTERN.test(input),
    };
}

export function parseScheduledTimeExpression(expression: string, now: Date = new Date()): Date {
    const isoCandidate = new Date(expression);
    if (!Number.isNaN(isoCandidate.getTime()) && /[tT]|:\d{2}/.test(expression)) {
        return isoCandidate;
    }

    const relative = parseRelativeTimeExpression(expression, now);
    if (relative) {
        return relative;
    }

    throw new Error(`Unable to parse scheduled time expression: "${expression}"`);
}

export function detectScheduledIntent(query: string, now: Date = new Date()): ParsedScheduledIntent | null {
    const trimmed = query.trim();
    if (!trimmed) return null;
    const trimmedWithoutTaskPrefix = stripScheduledTaskPrefix(trimmed);
    const candidate = trimmedWithoutTaskPrefix || trimmed;

    const recurringIntent = parseRecurringIntent(candidate, now);
    if (recurringIntent) {
        return recurringIntent;
    }

    const leadingExpression = extractLeadingScheduleExpression(candidate);
    if (leadingExpression) {
        const executeAt = parseScheduledTimeExpression(leadingExpression.originalTimeExpression, now);
        const { taskQuery, speakResult } = stripSpeechDirective(leadingExpression.taskQueryRaw);
        if (!taskQuery) return null;
        const splitResult = extractChainedScheduledStages(taskQuery);
        if (!splitResult.primaryTaskQuery) return null;
        return {
            executeAt,
            taskQuery: splitResult.primaryTaskQuery,
            speakResult,
            originalTimeExpression: leadingExpression.originalTimeExpression,
            chainedStages: splitResult.chainedStages.length > 0 ? splitResult.chainedStages : undefined,
        };
    }

    return null;
}

export function getRecurrenceIntervalMs(recurrence?: null | { kind: 'rrule'; value: string }): number | null {
    if (!recurrence || recurrence.kind !== 'rrule') {
        return null;
    }
    const raw = recurrence.value.trim();
    if (!raw) {
        return null;
    }
    const tokens = raw.split(';').map((token) => token.trim()).filter(Boolean);
    const fields = new Map<string, string>();
    for (const token of tokens) {
        const [key, value] = token.split('=');
        if (!key || !value) {
            continue;
        }
        fields.set(key.toUpperCase(), value.toUpperCase());
    }
    const freq = fields.get('FREQ');
    const intervalRaw = fields.get('INTERVAL');
    const interval = intervalRaw ? Number(intervalRaw) : 1;
    if (!freq || !Number.isFinite(interval) || interval <= 0) {
        return null;
    }
    if (freq === 'MINUTELY') {
        return interval * 60_000;
    }
    if (freq === 'HOURLY') {
        return interval * 60 * 60_000;
    }
    if (freq === 'DAILY') {
        return interval * 24 * 60 * 60_000;
    }
    return null;
}

export function computeNextRecurringExecuteAt(input: {
    recurrence?: null | { kind: 'rrule'; value: string };
    previousExecuteAt: string;
    now?: Date;
}): Date | null {
    const intervalMs = getRecurrenceIntervalMs(input.recurrence);
    if (!intervalMs || intervalMs <= 0) {
        return null;
    }
    const previousExecuteAtMs = new Date(input.previousExecuteAt).getTime();
    if (!Number.isFinite(previousExecuteAtMs)) {
        return null;
    }

    const nowMs = (input.now ?? new Date()).getTime();
    let nextMs = previousExecuteAtMs + intervalMs;
    while (nextMs <= nowMs) {
        nextMs += intervalMs;
    }
    return new Date(nextMs);
}

export function formatScheduledTime(date: Date): string {
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(date);
}

export class ScheduledTaskStore {
    constructor(private readonly filePath: string) {}

    private ensureDirectory(): void {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }

    private write(records: ScheduledTaskRecord[]): void {
        this.ensureDirectory();
        fs.writeFileSync(this.filePath, JSON.stringify(records, null, 2), 'utf-8');
    }

    read(): ScheduledTaskRecord[] {
        try {
            if (!fs.existsSync(this.filePath)) {
                return [];
            }
            const normalized = normalizeRecords(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')));
            let changed = false;
            const migrated = normalized.map((record) => {
                const result = migrateScheduledTaskRecord(record);
                changed = changed || result.changed;
                return result.record;
            });
            if (changed) {
                this.write(migrated);
            }
            return migrated;
        } catch (error) {
            console.error('[ScheduledTaskStore] Failed to read scheduled tasks:', error);
            return [];
        }
    }

    create(input: ScheduledTaskInput): ScheduledTaskRecord {
        const tasks = this.read();
        const record: ScheduledTaskRecord = {
            id: randomUUID(),
            title: input.title,
            taskQuery: input.taskQuery,
            workRequestId: input.workRequestId,
            stageTaskId: input.stageTaskId,
            stageIndex: input.stageIndex,
            totalStages: input.totalStages,
            delayMsFromPrevious: input.delayMsFromPrevious,
            previousStageSummary: input.previousStageSummary,
            previousStageArtifacts: input.previousStageArtifacts,
            frozenWorkRequest: input.frozenWorkRequest,
            workspacePath: input.workspacePath,
            createdAt: new Date().toISOString(),
            executeAt: input.executeAt.toISOString(),
            status: 'scheduled',
            speakResult: input.speakResult,
            sourceTaskId: input.sourceTaskId,
            config: input.config ? { ...input.config } : undefined,
        };
        tasks.push(record);
        this.write(tasks);
        return record;
    }

    upsert(record: ScheduledTaskRecord): void {
        const tasks = this.read();
        const index = tasks.findIndex((item) => item.id === record.id);
        if (index >= 0) {
            tasks[index] = record;
        } else {
            tasks.push(record);
        }
        this.write(tasks);
    }

    listDue(now: Date = new Date()): ScheduledTaskRecord[] {
        return this.read().filter((task) => task.status === 'scheduled' && new Date(task.executeAt).getTime() <= now.getTime());
    }

    recoverStaleRunning(options: RecoverStaleRunningOptions): ScheduledTaskRecord[] {
        const now = options.now ?? new Date();
        const nowMs = now.getTime();
        const recoveredAt = now.toISOString();
        const errorMessage =
            options.errorMessage ??
            'Scheduled task exceeded the allowed running time and was auto-marked as failed.';

        const tasks = this.read();
        const recovered: ScheduledTaskRecord[] = [];
        let changed = false;

        const nextTasks = tasks.map((task) => {
            if (task.status !== 'running') {
                return task;
            }

            const referenceIso = task.startedAt ?? task.executeAt ?? task.createdAt;
            const referenceMs = new Date(referenceIso).getTime();
            if (!Number.isFinite(referenceMs) || nowMs - referenceMs < options.timeoutMs) {
                return task;
            }

            changed = true;
            const recoveredTask: ScheduledTaskRecord = {
                ...task,
                status: 'failed',
                completedAt: recoveredAt,
                error: errorMessage,
            };
            recovered.push(recoveredTask);
            return recoveredTask;
        });

        if (changed) {
            this.write(nextTasks);
        }

        return recovered;
    }
}
