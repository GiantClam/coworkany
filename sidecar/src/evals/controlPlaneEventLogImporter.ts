import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TaskEventSchema, type TaskEvent } from '../protocol';

export type ImportedRuntimeReplayCase = {
    id: string;
    description: string;
    source: 'production_replay';
    productionReplaySource: string;
    input: {
        sourceText: string;
        workspacePath: string;
    };
    stages: {
        runtimeReplay: {
            eventLogPath: string;
            expect: {
                eventTypesInOrder: string[];
                eventTypesInclude: string[];
                eventTypesExclude?: string[];
                reopenTrigger?: string;
                reopenReasonIncludes?: string;
                planReadyDeliverablePathsInclude?: string[];
                finalStatus?: string;
            };
        };
    };
};

export type ImportControlPlaneEventLogOptions = {
    eventLogPath: string;
    caseId: string;
    description: string;
    productionReplaySource?: string;
    sourceText?: string;
    workspacePath?: string;
    sidecarRoot?: string;
};

export type ImportControlPlaneEventLogBatchOptions = {
    inputPaths: string[];
    caseIdPrefix?: string;
    descriptionPrefix?: string;
    productionReplaySource?: string;
    workspacePath?: string;
    sourceText?: string;
    sidecarRoot?: string;
};

export type ImportedRuntimeReplayBatchSummary = {
    totalCases: number;
    bySource: Record<string, number>;
};

export type ImportedRuntimeReplayBatchReport = ImportedRuntimeReplayBatchSummary & {
    generatedAt: string;
    caseIds: string[];
    eventLogPaths: string[];
    datasetPath?: string;
    insertedCases?: number;
    updatedCases?: number;
    totalDatasetCases?: number;
};

export type SyncProductionReplayDatasetOptions = ImportControlPlaneEventLogBatchOptions & {
    datasetPath: string;
    generatedAt?: string;
};

export type SyncedProductionReplayDatasetReport = ImportedRuntimeReplayBatchReport & {
    inputPaths: string[];
};

type ControlPlaneEvalCaseLine = {
    id?: string;
};

const RUNTIME_REPLAY_EVENT_TYPES = [
    'TASK_STATUS',
    'TASK_CONTRACT_REOPENED',
    'TASK_RESEARCH_UPDATED',
    'TASK_PLAN_READY',
    'TASK_USER_ACTION_REQUIRED',
    'TASK_CLARIFICATION_REQUIRED',
    'TASK_CHECKPOINT_REACHED',
    'TASK_FINISHED',
    'TASK_FAILED',
] as const;

const KNOWN_PRODUCTION_REPLAY_SOURCES = ['canary', 'beta', 'ga'] as const;

function dedupe<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}

function interpolatePathTemplate(value: string, variables: Record<string, string>): string {
    let next = value;
    for (const [key, raw] of Object.entries(variables)) {
        if (!raw) continue;
        next = next.split(raw).join(`{{${key}}}`);
    }
    return next;
}

function interpolatePathPrefixTemplate(value: string, variables: Record<string, string>): string {
    let next = value;
    const orderedVariables = Object.entries(variables)
        .filter(([, raw]) => Boolean(raw))
        .sort((left, right) => right[1].length - left[1].length);

    for (const [key, raw] of orderedVariables) {
        if (next === raw) {
            next = `{{${key}}}`;
            continue;
        }

        const normalizedRaw = raw.endsWith(path.sep) ? raw.slice(0, -1) : raw;
        if (next.startsWith(`${normalizedRaw}${path.sep}`)) {
            next = `{{${key}}}${next.slice(normalizedRaw.length)}`;
        }
    }

    return next;
}

function sanitizeCaseIdSegment(value: string): string {
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || 'replay';
}

function tokenizePathSegments(value: string): string[] {
    return value
        .split(/[\\/]/)
        .flatMap((segment) => segment.split(/[^a-zA-Z0-9]+/))
        .map((segment) => segment.trim().toLowerCase())
        .filter(Boolean);
}

function resolveSidecarRoot(): string {
    const filePath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(filePath), '../..');
}

export function loadTaskEventsFromJsonl(filePath: string): TaskEvent[] {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Event log not found: ${resolved}`);
    }

    const events: TaskEvent[] = [];
    const lines = fs.readFileSync(resolved, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            const result = TaskEventSchema.safeParse(parsed);
            if (result.success) {
                events.push(result.data);
            }
        } catch {
            // Ignore malformed lines to keep ingestion tolerant of mixed logs.
        }
    }

    return events;
}

export function collectEventLogFiles(inputPaths: string[]): string[] {
    const files = new Set<string>();

    const visit = (targetPath: string): void => {
        const resolved = path.resolve(targetPath);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Event log path does not exist: ${resolved}`);
        }

        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(resolved).sort()) {
                visit(path.join(resolved, entry));
            }
            return;
        }

        if (resolved.endsWith('.jsonl')) {
            files.add(resolved);
        }
    };

    for (const inputPath of inputPaths) {
        visit(inputPath);
    }

    return Array.from(files).sort();
}

export function deriveImportedRuntimeReplayCaseId(eventLogPath: string, prefix = 'imported-runtime-replay'): string {
    const baseName = path.basename(eventLogPath, path.extname(eventLogPath));
    return `${sanitizeCaseIdSegment(prefix)}-${sanitizeCaseIdSegment(baseName)}`;
}

export function deriveImportedRuntimeReplayDescription(eventLogPath: string, prefix = 'Imported replay'): string {
    const baseName = path.basename(eventLogPath, path.extname(eventLogPath)).replace(/[-_]+/g, ' ');
    return `${prefix}: ${baseName}`;
}

export function inferProductionReplaySourceFromPath(eventLogPath: string): string | undefined {
    const tokens = tokenizePathSegments(path.resolve(eventLogPath)).reverse();
    for (const token of tokens) {
        if ((KNOWN_PRODUCTION_REPLAY_SOURCES as readonly string[]).includes(token)) {
            return token;
        }
    }
    return undefined;
}

export function detectWorkspacePathFromTaskEvents(events: TaskEvent[]): string | undefined {
    const startedEvent = events.find((event) => event.type === 'TASK_STARTED');
    if (startedEvent && 'context' in startedEvent.payload) {
        const context = startedEvent.payload.context as { workspacePath?: string };
        if (typeof context.workspacePath === 'string' && context.workspacePath.length > 0) {
            return context.workspacePath;
        }
    }

    const planReadyEvent = [...events].reverse().find((event) => event.type === 'TASK_PLAN_READY');
    if (planReadyEvent && 'deliverables' in planReadyEvent.payload) {
        const paths = (planReadyEvent.payload.deliverables as Array<{ path?: string }>)
            .map((deliverable) => deliverable.path)
            .filter((value): value is string => typeof value === 'string' && value.length > 0);
        if (paths.length > 0) {
            const first = paths[0];
            return path.dirname(first);
        }
    }

    return undefined;
}

function detectSourceText(events: TaskEvent[]): string {
    const userChat = events.find((event) =>
        event.type === 'CHAT_MESSAGE' &&
        'role' in event.payload &&
        event.payload.role === 'user' &&
        'content' in event.payload &&
        typeof event.payload.content === 'string'
    );
    if (userChat && 'content' in userChat.payload) {
        return String(userChat.payload.content);
    }
    return 'Imported runtime replay case';
}

export function summarizeImportedRuntimeReplayCases(
    importedCases: ImportedRuntimeReplayCase[]
): ImportedRuntimeReplayBatchSummary {
    const bySource: Record<string, number> = {};
    for (const importedCase of importedCases) {
        bySource[importedCase.productionReplaySource] = (bySource[importedCase.productionReplaySource] ?? 0) + 1;
    }
    return {
        totalCases: importedCases.length,
        bySource: Object.fromEntries(Object.entries(bySource).sort(([left], [right]) => left.localeCompare(right))),
    };
}

export function buildImportedRuntimeReplayBatchReport(input: {
    importedCases: ImportedRuntimeReplayCase[];
    datasetPath?: string;
    insertedCases?: number;
    updatedCases?: number;
    totalDatasetCases?: number;
    generatedAt?: string;
}): ImportedRuntimeReplayBatchReport {
    const summary = summarizeImportedRuntimeReplayCases(input.importedCases);
    return {
        ...summary,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        caseIds: input.importedCases.map((item) => item.id).sort(),
        eventLogPaths: input.importedCases
            .map((item) => item.stages.runtimeReplay.eventLogPath)
            .sort(),
        datasetPath: input.datasetPath,
        insertedCases: input.insertedCases,
        updatedCases: input.updatedCases,
        totalDatasetCases: input.totalDatasetCases,
    };
}

export function importControlPlaneEventLog(
    options: ImportControlPlaneEventLogOptions
): ImportedRuntimeReplayCase {
    const sidecarRoot = path.resolve(options.sidecarRoot ?? resolveSidecarRoot());
    const events = loadTaskEventsFromJsonl(options.eventLogPath);
    if (events.length === 0) {
        throw new Error(`No valid TaskEvent entries found in ${options.eventLogPath}`);
    }

    const workspacePath = options.workspacePath ?? detectWorkspacePathFromTaskEvents(events) ?? '{{workspace}}';
    const pathVariables = {
        workspace: workspacePath,
        sidecarRoot,
    };

    const replayEventTypes = events
        .map((event) => event.type)
        .filter((type) => RUNTIME_REPLAY_EVENT_TYPES.includes(type as typeof RUNTIME_REPLAY_EVENT_TYPES[number]));
    const eventTypesInOrder = replayEventTypes;
    const eventTypesInclude = dedupe(replayEventTypes);
    const eventTypesExclude: string[] = [];
    if (!eventTypesInclude.includes('TASK_CLARIFICATION_REQUIRED')) {
        eventTypesExclude.push('TASK_CLARIFICATION_REQUIRED');
    }

    const reopenedEvent = [...events].reverse().find((event) => event.type === 'TASK_CONTRACT_REOPENED');
    const planReadyEvent = [...events].reverse().find((event) => event.type === 'TASK_PLAN_READY');
    const latestStatusEvent = [...events].reverse().find((event) => event.type === 'TASK_STATUS');
    const deliverablePaths = planReadyEvent && 'deliverables' in planReadyEvent.payload
        ? ((planReadyEvent.payload.deliverables as Array<{ path?: string }>)
            .map((deliverable) => deliverable.path)
            .filter((value): value is string => typeof value === 'string')
            .map((value) => interpolatePathPrefixTemplate(value, pathVariables)))
        : [];

    const eventLogPath = interpolatePathPrefixTemplate(path.resolve(options.eventLogPath), pathVariables);

    return {
        id: options.caseId,
        description: options.description,
        source: 'production_replay',
        productionReplaySource: options.productionReplaySource ?? inferProductionReplaySourceFromPath(options.eventLogPath) ?? 'manual_import',
        input: {
            sourceText: interpolatePathTemplate(options.sourceText ?? detectSourceText(events), pathVariables),
            workspacePath: '{{workspace}}',
        },
        stages: {
            runtimeReplay: {
                eventLogPath,
                expect: {
                    eventTypesInOrder,
                    eventTypesInclude,
                    ...(eventTypesExclude.length > 0 ? { eventTypesExclude } : {}),
                    ...(reopenedEvent && 'trigger' in reopenedEvent.payload
                        ? { reopenTrigger: String(reopenedEvent.payload.trigger) }
                        : {}),
                    ...(reopenedEvent && 'reason' in reopenedEvent.payload && typeof reopenedEvent.payload.reason === 'string'
                        ? { reopenReasonIncludes: String(reopenedEvent.payload.reason).slice(0, 80) }
                        : {}),
                    ...(deliverablePaths.length > 0 ? { planReadyDeliverablePathsInclude: deliverablePaths } : {}),
                    ...(latestStatusEvent && 'status' in latestStatusEvent.payload
                        ? { finalStatus: String(latestStatusEvent.payload.status) }
                        : {}),
                },
            },
        },
    };
}

export function importControlPlaneEventLogBatch(
    options: ImportControlPlaneEventLogBatchOptions
): ImportedRuntimeReplayCase[] {
    return collectEventLogFiles(options.inputPaths).map((eventLogPath) => {
        return importControlPlaneEventLog({
            eventLogPath,
            caseId: deriveImportedRuntimeReplayCaseId(eventLogPath, options.caseIdPrefix),
            description: deriveImportedRuntimeReplayDescription(eventLogPath, options.descriptionPrefix),
            productionReplaySource: options.productionReplaySource,
            workspacePath: options.workspacePath,
            sourceText: options.sourceText,
            sidecarRoot: options.sidecarRoot,
        });
    });
}

export function upsertImportedRuntimeReplayCase(
    datasetPath: string,
    importedCase: ImportedRuntimeReplayCase
): { updated: boolean; totalCases: number } {
    const resolved = path.resolve(datasetPath);
    const existingLines = fs.existsSync(resolved)
        ? fs.readFileSync(resolved, 'utf-8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [];

    let updated = false;
    const nextLines = existingLines.map((line) => {
        try {
            const parsed = JSON.parse(line) as ControlPlaneEvalCaseLine;
            if (parsed.id === importedCase.id) {
                updated = true;
                return JSON.stringify(importedCase);
            }
            return line;
        } catch {
            return line;
        }
    });

    if (!updated) {
        nextLines.push(JSON.stringify(importedCase));
    }

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${nextLines.join('\n')}\n`, 'utf-8');

    return {
        updated,
        totalCases: nextLines.length,
    };
}

export function upsertImportedRuntimeReplayCases(
    datasetPath: string,
    importedCases: ImportedRuntimeReplayCase[]
): { inserted: number; updated: number; totalCases: number } {
    let inserted = 0;
    let updated = 0;
    let totalCases = 0;

    for (const importedCase of importedCases) {
        const result = upsertImportedRuntimeReplayCase(datasetPath, importedCase);
        totalCases = result.totalCases;
        if (result.updated) {
            updated += 1;
        } else {
            inserted += 1;
        }
    }

    return {
        inserted,
        updated,
        totalCases,
    };
}

function countDatasetCases(datasetPath: string): number {
    const resolved = path.resolve(datasetPath);
    if (!fs.existsSync(resolved)) {
        return 0;
    }

    return fs.readFileSync(resolved, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .length;
}

export function syncProductionReplayDataset(
    options: SyncProductionReplayDatasetOptions
): SyncedProductionReplayDatasetReport {
    const resolvedInputPaths = options.inputPaths
        .map((inputPath) => path.resolve(inputPath))
        .filter((inputPath) => fs.existsSync(inputPath));
    const importedCases = resolvedInputPaths.length > 0
        ? importControlPlaneEventLogBatch({
            ...options,
            inputPaths: resolvedInputPaths,
        })
        : [];

    if (importedCases.length === 0) {
        return {
            ...buildImportedRuntimeReplayBatchReport({
                importedCases,
                datasetPath: path.resolve(options.datasetPath),
                insertedCases: 0,
                updatedCases: 0,
                totalDatasetCases: countDatasetCases(options.datasetPath),
                generatedAt: options.generatedAt,
            }),
            inputPaths: resolvedInputPaths,
        };
    }

    const result = upsertImportedRuntimeReplayCases(options.datasetPath, importedCases);
    return {
        ...buildImportedRuntimeReplayBatchReport({
            importedCases,
            datasetPath: path.resolve(options.datasetPath),
            insertedCases: result.inserted,
            updatedCases: result.updated,
            totalDatasetCases: result.totalCases,
            generatedAt: options.generatedAt,
        }),
        inputPaths: resolvedInputPaths,
    };
}
