import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { type FrozenWorkRequest, type PresentationContract } from '../orchestration/workRequestSchema';

export interface ScheduledTaskConfig {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
}

export type ScheduledTaskStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledTaskRecord {
    id: string;
    title: string;
    taskQuery: string;
    workRequestId?: string;
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

    const englishMatch = lower.match(/^in\s+(\d+)\s+(second|seconds|minute|minutes|hour|hours|day|days)\b/);
    if (englishMatch) {
        const amount = Number(englishMatch[1]);
        const unit = englishMatch[2];
        const result = new Date(now);
        if (unit.startsWith('second')) {
            result.setSeconds(result.getSeconds() + amount);
        } else if (unit.startsWith('minute')) {
            result.setMinutes(result.getMinutes() + amount);
        } else if (unit.startsWith('hour')) {
            result.setHours(result.getHours() + amount);
        } else {
            result.setDate(result.getDate() + amount);
        }
        return result;
    }

    const chineseMatch = expression.trim().match(/^([零〇一二两兩三四五六七八九十百\d]+)\s*(秒钟?|分钟?|分|小时|个小时|天)后$/);
    if (chineseMatch) {
        const amount = parseChineseNumber(chineseMatch[1]);
        const unit = chineseMatch[2];
        const result = new Date(now);
        if (unit.startsWith('秒')) {
            result.setSeconds(result.getSeconds() + amount);
        } else if (unit.startsWith('分')) {
            result.setMinutes(result.getMinutes() + amount);
        } else if (unit.includes('小时')) {
            result.setHours(result.getHours() + amount);
        } else {
            result.setDate(result.getDate() + amount);
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

function stripDanglingSpeechTail(input: string): string {
    return input
        .replace(/[，,、\s]*(?:并|然后|再)\s*(?:将|把)?\s*结果?$/iu, '')
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
    const patterns = [
        /(?:,|，|\s)*(?:并|然后|再)?(?:将|把)?结果?(?:用)?语音播报给我(?=[。.!！；;，,、\s]|$)/giu,
        /(?:,|，|\s)*(?:并|然后|再)?(?:将|把)?结果?(?:用)?语音播报(?=[。.!！；;，,、\s]|$)/giu,
        /(?:,|，|\s)*(?:并|然后|再)?(?:将|把)?结果?(?:朗读|读|念|说)给我听(?=[。.!！；;，,、\s]|$)/giu,
        /(?:,|，|\s)*(?:并|然后|再)?(?:用)?语音播报给我(?=[。.!！；;，,、\s]|$)/giu,
        /(?:,|，|\s)*(?:并|然后|再)?(?:用)?语音播报(?=[。.!！；;，,、\s]|$)/giu,
        /(?:,|，|\s)*(?:并|然后|再)?朗读给我听(?=[。.!！；;，,、\s]|$)/giu,
        /(?:,|，|\s)*(?:并|然后|再)?读给我听(?=[。.!！；;，,、\s]|$)/giu,
        /(?:,|，|\s)*(?:并|然后|再)?说给我听(?=[。.!！；;，,、\s]|$)/giu,
        /(?:,|，|\s)*(?:and then |and )?(?:speak|read)(?: the result| it)?(?: aloud)?(?: to me)?(?=[.!,;\s]|$)/giu,
    ];

    let stripped = input;
    let speakResult = false;
    for (const pattern of patterns) {
        const next = stripped.replace(pattern, '');
        if (next !== stripped) {
            stripped = next;
            speakResult = true;
        }
    }

    return {
        taskQuery: stripDanglingSpeechTail(cleanupSpeechDirectiveRemoval(stripped)),
        speakResult: speakResult || /(语音|朗读|读出来|说给我听|播报|read aloud|speak)/iu.test(input),
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

    const chineseMatch = trimmed.match(/^(?:请)?(?:在)?([零〇一二两兩三四五六七八九十百\d]+\s*(?:秒钟?|分钟?|分|小时|个小时|天)后)[，,、\s]*(.+)$/u);
    if (chineseMatch) {
        const originalTimeExpression = chineseMatch[1].replace(/\s+/g, '');
        const executeAt = parseScheduledTimeExpression(originalTimeExpression, now);
        const { taskQuery, speakResult } = stripSpeechDirective(chineseMatch[2]);
        if (!taskQuery) return null;
        return { executeAt, taskQuery, speakResult, originalTimeExpression };
    }

    const englishMatch = trimmed.match(/^in\s+(\d+\s+(?:second|seconds|minute|minutes|hour|hours|day|days))[\s,:-]+(.+)$/i);
    if (englishMatch) {
        const originalTimeExpression = `in ${englishMatch[1]}`;
        const executeAt = parseScheduledTimeExpression(originalTimeExpression, now);
        const { taskQuery, speakResult } = stripSpeechDirective(englishMatch[2]);
        if (!taskQuery) return null;
        return { executeAt, taskQuery, speakResult, originalTimeExpression };
    }

    return null;
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
