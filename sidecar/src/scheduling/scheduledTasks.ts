import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { type FrozenWorkRequest } from '../orchestration/workRequestSchema';
import type { PlatformRuntimeContext } from '../protocol/commands';
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
const SCHEDULE_PREFIX_PATTERNS = [
    /^创建定时任务[：:\s,，、-]*/u,
    /^新建定时任务[：:\s,，、-]*/u,
    /^定时任务[：:\s,，、-]*/u,
    /^create\s+scheduled\s+task[：:\s,，、-]*/iu,
    /^scheduled\s+task[：:\s,，、-]*/iu,
] as const;
const ENGLISH_RELATIVE_PATTERN = /in\s+(\d+)\s*(seconds?|minutes?|hours?|days?)/i;
const CHINESE_RELATIVE_PATTERN = /([零〇一二两兩三四五六七八九十\d]+)\s*(秒钟?|分钟?|分|小时|小時|天|日)(?:\s*(后|以后|之后))?/u;
const CHINESE_ABSOLUTE_TIME_PATTERN = /^(今天|明天|后天)?\s*(凌晨|早上|上午|中午|下午|晚上)?\s*([零〇一二两兩三四五六七八九十\d]{1,3})\s*点(?:\s*([零〇一二两兩三四五六七八九十\d]{1,3})\s*分?)?$/u;
const RECURRING_INTERVAL_PATTERN = /(every\s+\d*\s*(?:minutes?|hours?|days?)|每\s*[零〇一二两兩三四五六七八九十\d]*\s*(?:分钟?|分|小时|小時|天|日))/iu;
const ENGLISH_RECURRING_PATTERN = /^(.*?\b)?every\s+(\d+)?\s*(minutes?|hours?|days?)\s+(.+)$/i;
const CHINESE_RECURRING_PATTERN = /^(.*?)每\s*([零〇一二两兩三四五六七八九十\d]*)\s*(分钟?|分|小时|小時|天|日)\s*(.+)$/u;
const CHAIN_STAGE_PATTERN = /然后(?:再)?(?:等)?\s*([零〇一二两兩三四五六七八九十\d]+\s*(?:秒钟?|分钟?|分|小时|小時|天|日)(?:\s*(?:后|以后|之后))?)[,，、\s]*(.*?)(?=(?:然后(?:再)?(?:等)?\s*[零〇一二两兩三四五六七八九十\d]+\s*(?:秒钟?|分钟?|分|小时|小時|天|日)(?:\s*(?:后|以后|之后))?)|$)/gu;
const SPEECH_DIRECTIVE_PATTERNS = [
    /(?:并|并且)?(?:将|把)?结果(?:用语音播报给我(?:听)?|语音播报给我(?:听)?|朗读给我(?:听)?|读出来|播报给我(?:听)?|念给我(?:听)?)/giu,
    /(?:并|并且)?(?:把|将)?结果(?:read|speak)\s*(?:it\s*)?(?:aloud|out\s*loud)/giu,
] as const;
const SPEECH_MARKER_FALLBACK = /(语音播报|朗读|读出来|read\s+.*aloud|speak\s+.*aloud)/iu;
function normalizeText(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}
function stripRoutedEnvelope(input: string): string {
    let text = input.trim();
    const routedMatch = text.match(/^原始任务[：:]\s*([\s\S]*?)(?:\n+用户路由[：:][^\n]*)?$/u);
    if (routedMatch?.[1]) {
        text = routedMatch[1].trim();
    }
    return text;
}
function stripScheduledTaskPrefix(input: string): string {
    let text = input.trim();
    for (const pattern of SCHEDULE_PREFIX_PATTERNS) {
        text = text.replace(pattern, '').trim();
    }
    return text;
}
function trimTaskSegment(input: string): string {
    return input
        .replace(/^[，,、:\s-]+/u, '')
        .replace(/[，,、。.!！；;\s]+$/u, '')
        .trim();
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
        const left = normalized.slice(0, tenIndex);
        const right = normalized.slice(tenIndex + 1);
        const tens = left ? (digits[left] ?? 0) : 1;
        const ones = right ? (digits[right] ?? 0) : 0;
        return tens * 10 + ones;
    }
    return normalized
        .split('')
        .reduce((acc, char) => acc * 10 + (digits[char] ?? 0), 0);
}
function relativeUnitToMs(unitRaw: string): number | null {
    const unit = unitRaw.toLowerCase();
    if (/^秒/.test(unit) || /^second/.test(unit)) {
        return 1_000;
    }
    if (/^分/.test(unit) || /^minute/.test(unit)) {
        return 60_000;
    }
    if (/^小/.test(unit) || /^hour/.test(unit)) {
        return 60 * 60_000;
    }
    if (/^(天|日)/.test(unit) || /^day/.test(unit)) {
        return 24 * 60 * 60_000;
    }
    return null;
}
function parseRelativeAmount(raw: string): number {
    return /[零〇一二两兩三四五六七八九十]/u.test(raw) ? parseChineseNumber(raw) : Number(raw);
}
function parseRelativeTimeExpression(expression: string, now: Date): Date | null {
    const text = expression.trim();
    const englishMatch = text.match(ENGLISH_RELATIVE_PATTERN);
    if (englishMatch?.[1] && englishMatch[2]) {
        const amount = Number(englishMatch[1]);
        const unitMs = relativeUnitToMs(englishMatch[2]);
        if (Number.isFinite(amount) && amount >= 0 && unitMs) {
            return new Date(now.getTime() + amount * unitMs);
        }
    }
    const chineseMatch = text.match(CHINESE_RELATIVE_PATTERN);
    if (chineseMatch?.[1] && chineseMatch[2]) {
        const amount = parseRelativeAmount(chineseMatch[1]);
        const unitMs = relativeUnitToMs(chineseMatch[2]);
        if (Number.isFinite(amount) && amount >= 0 && unitMs) {
            return new Date(now.getTime() + amount * unitMs);
        }
    }
    if (/\btomorrow\b/i.test(text)) {
        const next = new Date(now);
        next.setUTCDate(next.getUTCDate() + 1);
        return next;
    }
    return null;
}
function parseChineseAbsoluteTimeExpression(expression: string, now: Date): Date | null {
    const match = expression.trim().match(CHINESE_ABSOLUTE_TIME_PATTERN);
    if (!match) {
        return null;
    }
    const dayMarker = match[1];
    const period = match[2];
    const rawHour = match[3];
    const rawMinute = match[4];
    if (!rawHour) {
        return null;
    }
    let hour = parseRelativeAmount(rawHour);
    let minute = rawMinute ? parseRelativeAmount(rawMinute) : 0;
    if (!Number.isFinite(hour) || hour < 0 || hour > 24) {
        return null;
    }
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
        return null;
    }

    if (period === '凌晨' || period === '早上' || period === '上午') {
        hour = hour % 12;
    } else if (period === '中午') {
        if (hour < 11) {
            hour += 12;
        }
    } else if (period === '下午' || period === '晚上') {
        if (hour < 12) {
            hour += 12;
        }
    }
    if (hour === 24) {
        hour = 0;
    }

    let dayOffset = 0;
    if (dayMarker === '明天') {
        dayOffset = 1;
    } else if (dayMarker === '后天') {
        dayOffset = 2;
    }

    const scheduled = new Date(now);
    scheduled.setMilliseconds(0);
    scheduled.setSeconds(0);
    scheduled.setMinutes(minute);
    scheduled.setHours(hour);
    scheduled.setDate(scheduled.getDate() + dayOffset);

    if (!dayMarker && scheduled.getTime() <= now.getTime()) {
        scheduled.setDate(scheduled.getDate() + 1);
    }
    return scheduled;
}
function cleanupSpeechDirectiveRemoval(input: string): string {
    return input
        .replace(/[，,、]\s*(?=[。.!！；;])/gu, '')
        .replace(/[。.!！；;]{2,}/gu, '。')
        .replace(/[，,、]{2,}/gu, '，')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
function stripDanglingSpeechTail(input: string): string {
    return input
        .replace(/(?:并|并且)?(?:请)?(?:给我)?(?:听|一下)?$/u, '')
        .replace(/[，,、\s]+$/u, '')
        .trim();
}
function stripSpeechDirective(input: string): { taskQuery: string; speakResult: boolean } {
    let text = input;
    let speakResult = false;
    for (const pattern of SPEECH_DIRECTIVE_PATTERNS) {
        const replaced = text.replace(pattern, '');
        if (replaced !== text) {
            speakResult = true;
            text = replaced;
        }
    }
    if (!speakResult && SPEECH_MARKER_FALLBACK.test(input)) {
        speakResult = true;
    }
    return {
        taskQuery: stripDanglingSpeechTail(cleanupSpeechDirectiveRemoval(text)),
        speakResult,
    };
}
function normalizeRelativeExpressionForDelay(raw: string): string {
    const text = raw.trim();
    if (/^in\s+/i.test(text)) {
        return text;
    }
    if (/(后|以后|之后)$/u.test(text)) {
        return text;
    }
    return `${text}后`;
}
function parseRelativeDelayMs(expression: string): number | null {
    const anchor = new Date('2026-01-01T00:00:00.000Z');
    const parsed = parseRelativeTimeExpression(expression, anchor);
    if (!parsed) {
        return null;
    }
    const delayMs = parsed.getTime() - anchor.getTime();
    return delayMs >= 0 ? delayMs : null;
}
function extractChainedStages(taskQueryRaw: string): {
    primaryTaskQuery: string;
    chainedStages: ChainedScheduledStageIntent[];
} {
    const text = taskQueryRaw.trim();
    const matches = Array.from(text.matchAll(CHAIN_STAGE_PATTERN));
    if (matches.length === 0) {
        return {
            primaryTaskQuery: trimTaskSegment(text),
            chainedStages: [],
        };
    }
    const first = matches[0];
    const firstIndex = first?.index ?? 0;
    const primaryTaskQuery = trimTaskSegment(text.slice(0, firstIndex));
    const chainedStages: ChainedScheduledStageIntent[] = [];
    for (const match of matches) {
        const expression = match[1]?.trim();
        const taskQuery = trimTaskSegment((match[2] ?? '').replace(/^(?:将|把)\s*/u, ''));
        if (!expression || !taskQuery) {
            continue;
        }
        const delayMs = parseRelativeDelayMs(normalizeRelativeExpressionForDelay(expression));
        if (delayMs === null) {
            continue;
        }
        chainedStages.push({
            delayMsFromPrevious: delayMs,
            taskQuery,
            originalTimeExpression: expression.replace(/\s+/g, ''),
        });
    }
    if (!primaryTaskQuery || chainedStages.length === 0) {
        return {
            primaryTaskQuery: trimTaskSegment(text),
            chainedStages: [],
        };
    }
    return {
        primaryTaskQuery,
        chainedStages,
    };
}
function buildRecurrenceSpec(amount: number, unitRaw: string): { rrule: string; intervalMs: number } | null {
    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }
    const unitMs = relativeUnitToMs(unitRaw);
    if (!unitMs) {
        return null;
    }
    if (unitMs === 60_000) {
        return { rrule: `FREQ=MINUTELY;INTERVAL=${amount}`, intervalMs: amount * unitMs };
    }
    if (unitMs === 60 * 60_000) {
        return { rrule: `FREQ=HOURLY;INTERVAL=${amount}`, intervalMs: amount * unitMs };
    }
    if (unitMs === 24 * 60 * 60_000) {
        return { rrule: `FREQ=DAILY;INTERVAL=${amount}`, intervalMs: amount * unitMs };
    }
    return null;
}
function parseRecurringIntent(candidate: string, now: Date): ParsedScheduledIntent | null {
    const english = candidate.match(ENGLISH_RECURRING_PATTERN);
    if (english?.[3] && english[4]) {
        const amount = english[2] ? Number(english[2]) : 1;
        const recurrence = buildRecurrenceSpec(amount, english[3]);
        if (!recurrence) {
            return null;
        }
        const startExpr = normalizeText(english[1] ?? '');
        const executeAt = !startExpr || /(?:^from now$|^now$|^from now start$)/i.test(startExpr)
            ? new Date(now)
            : parseScheduledTimeExpression(startExpr, now);
        const { taskQuery, speakResult } = stripSpeechDirective(english[4]);
        if (!taskQuery) {
            return null;
        }
        return {
            executeAt,
            taskQuery,
            speakResult,
            originalTimeExpression: `every ${amount} ${english[3]}`,
            recurrence: { kind: 'rrule', value: recurrence.rrule },
        };
    }
    const chinese = candidate.match(CHINESE_RECURRING_PATTERN);
    if (chinese?.[3] && chinese[4]) {
        const amount = chinese[2] ? parseRelativeAmount(chinese[2]) : 1;
        const recurrence = buildRecurrenceSpec(amount, chinese[3]);
        if (!recurrence) {
            return null;
        }
        const startExpr = normalizeText(chinese[1] ?? '');
        const executeAt = !startExpr || /从现在开始|从现在起|现在开始|马上开始/u.test(startExpr)
            ? new Date(now)
            : parseScheduledTimeExpression(startExpr, now);
        const { taskQuery, speakResult } = stripSpeechDirective(chinese[4]);
        if (!taskQuery) {
            return null;
        }
        return {
            executeAt,
            taskQuery,
            speakResult,
            originalTimeExpression: `每${amount}${chinese[3]}`,
            recurrence: { kind: 'rrule', value: recurrence.rrule },
        };
    }
    return null;
}
function extractLeadingScheduleExpression(candidate: string): { originalTimeExpression: string; taskQueryRaw: string } | null {
    const chinese = candidate.match(/^([零〇一二两兩三四五六七八九十\d]+\s*(?:秒钟?|分钟?|分|小时|小時|天|日)\s*(?:后|以后|之后))[,，、:\s-]*(.+)$/u);
    if (chinese?.[1] && chinese[2]) {
        return {
            originalTimeExpression: chinese[1].replace(/\s+/g, ''),
            taskQueryRaw: chinese[2],
        };
    }
    const absolute = candidate.match(/^(今天|明天|后天)?\s*(凌晨|早上|上午|中午|下午|晚上)?\s*([零〇一二两兩三四五六七八九十\d]{1,3})\s*点(?:\s*([零〇一二两兩三四五六七八九十\d]{1,3})\s*分?)?[,，、:\s-]*(.+)$/u);
    if (absolute?.[5]) {
        const timeExpression = normalizeText(
            `${absolute[1] ?? ''}${absolute[2] ?? ''}${absolute[3]}点${absolute[4] ? `${absolute[4]}分` : ''}`,
        );
        return {
            originalTimeExpression: timeExpression,
            taskQueryRaw: absolute[5],
        };
    }
    const english = candidate.match(/^(in\s+\d+\s*(?:seconds?|minutes?|hours?|days?))[,，、:\s-]*(.+)$/i);
    if (english?.[1] && english[2]) {
        return {
            originalTimeExpression: english[1].toLowerCase().replace(/\s+/g, ' ').trim(),
            taskQueryRaw: english[2],
        };
    }
    return null;
}
export function parseScheduledTimeExpression(expression: string, now: Date = new Date()): Date {
    const iso = new Date(expression);
    if (!Number.isNaN(iso.getTime()) && /[tT]|:\d{2}/.test(expression)) {
        return iso;
    }
    const relative = parseRelativeTimeExpression(expression, now);
    if (relative) {
        return relative;
    }
    const chineseAbsolute = parseChineseAbsoluteTimeExpression(expression, now);
    if (chineseAbsolute) {
        return chineseAbsolute;
    }
    throw new Error(`Unable to parse scheduled time expression: "${expression}"`);
}
export function detectScheduledIntent(query: string, now: Date = new Date()): ParsedScheduledIntent | null {
    const trimmed = stripRoutedEnvelope(query);
    if (!trimmed) {
        return null;
    }
    const candidate = stripScheduledTaskPrefix(trimmed) || trimmed;
    const recurring = parseRecurringIntent(candidate, now);
    if (recurring) {
        return recurring;
    }
    const leading = extractLeadingScheduleExpression(candidate);
    if (!leading) {
        return null;
    }
    const executeAt = parseScheduledTimeExpression(leading.originalTimeExpression, now);
    const { taskQuery, speakResult } = stripSpeechDirective(leading.taskQueryRaw);
    if (!taskQuery) {
        return null;
    }
    const split = extractChainedStages(taskQuery);
    if (!split.primaryTaskQuery) {
        return null;
    }
    return {
        executeAt,
        taskQuery: split.primaryTaskQuery,
        speakResult,
        originalTimeExpression: leading.originalTimeExpression,
        chainedStages: split.chainedStages.length > 0 ? split.chainedStages : undefined,
    };
}
export function getRecurrenceIntervalMs(recurrence?: null | { kind: 'rrule'; value: string }): number | null {
    if (!recurrence || recurrence.kind !== 'rrule') {
        return null;
    }
    const fields = new Map<string, string>();
    for (const token of recurrence.value.split(';').map((value) => value.trim()).filter(Boolean)) {
        const [key, value] = token.split('=');
        if (key && value) {
            fields.set(key.toUpperCase(), value.toUpperCase());
        }
    }
    const freq = fields.get('FREQ');
    const intervalRaw = fields.get('INTERVAL');
    const interval = intervalRaw ? Number(intervalRaw) : 1;
    if (!freq || !Number.isFinite(interval) || interval <= 0) {
        return null;
    }
    if (freq === 'MINUTELY') return interval * 60_000;
    if (freq === 'HOURLY') return interval * 60 * 60_000;
    if (freq === 'DAILY') return interval * 24 * 60 * 60_000;
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
    const previousMs = new Date(input.previousExecuteAt).getTime();
    if (!Number.isFinite(previousMs)) {
        return null;
    }
    const nowMs = (input.now ?? new Date()).getTime();
    let nextMs = previousMs + intervalMs;
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
function normalizeRecords(raw: unknown): ScheduledTaskRecord[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((entry): entry is ScheduledTaskRecord => {
        if (!entry || typeof entry !== 'object') return false;
        const candidate = entry as Partial<ScheduledTaskRecord>;
        return (
            typeof candidate.id === 'string'
            && typeof candidate.title === 'string'
            && typeof candidate.taskQuery === 'string'
            && typeof candidate.workspacePath === 'string'
            && typeof candidate.createdAt === 'string'
            && typeof candidate.executeAt === 'string'
            && typeof candidate.status === 'string'
            && typeof candidate.speakResult === 'boolean'
        );
    });
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
            return normalizeRecords(JSON.parse(fs.readFileSync(this.filePath, 'utf-8')));
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
            config: input.config,
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
        const errorMessage = options.errorMessage
            ?? 'Scheduled task exceeded the allowed running time and was auto-marked as failed.';
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
            const failedTask: ScheduledTaskRecord = {
                ...task,
                status: 'failed',
                completedAt: recoveredAt,
                error: errorMessage,
            };
            recovered.push(failedTask);
            return failedTask;
        });
        if (changed) {
            this.write(nextTasks);
        }
        return recovered;
    }
}
