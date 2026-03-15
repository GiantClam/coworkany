import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { SkillRecord } from '../../hooks/useSkills';

interface SkillCreatorEvalPathsResult {
    success: boolean;
    path: string;
    created: boolean;
    outputPath?: string;
    benchmarkJsonPath?: string;
    benchmarkMarkdownPath?: string;
    stdout?: string;
    error?: string;
}

interface SkillBenchmarkMetricStats {
    mean?: number;
    stddev?: number;
    min?: number;
    max?: number;
}

interface SkillBenchmarkRunSummaryEntry {
    pass_rate?: SkillBenchmarkMetricStats;
    time_seconds?: SkillBenchmarkMetricStats;
    tokens?: SkillBenchmarkMetricStats;
}

interface SkillBenchmarkRun {
    configuration?: string;
    notes?: string[];
}

interface SkillBenchmarkDocument {
    metadata?: {
        skill_name?: string;
        timestamp?: string;
        evals_run?: Array<string | number>;
        runs_per_configuration?: number;
    };
    run_summary?: Record<string, SkillBenchmarkRunSummaryEntry | Record<string, string>>;
    runs?: SkillBenchmarkRun[];
    notes?: string[];
}

interface IpcResult {
    success: boolean;
    payload: Record<string, unknown>;
}

interface BenchmarkNotesDraftMetadata {
    source?: 'llm' | 'heuristic';
    provider?: string;
    model?: string;
    warning?: string;
    generatedAt?: string;
    attemptCount?: number;
    proxyUrl?: string;
    proxyBypassed?: boolean;
    logPath?: string;
}

interface BenchmarkNotesHistoryEntry {
    id: string;
    savedAt: string;
    notes: string[];
    previousNotes: string[];
    source?: string;
    provider?: string;
    model?: string;
    warning?: string;
    generatedAt?: string;
}

interface SkillReviewServerResult {
    success: boolean;
    workspacePath: string;
    url?: string;
    port?: number;
    running: boolean;
    restarted: boolean;
    logPath?: string;
    error?: string;
}

interface AnalyzerConnectivityStatus {
    configured: boolean;
    reachable: boolean;
    provider?: string;
    model?: string;
    endpoint?: string;
    checkedAt?: string;
    resultSource?: string;
    statusPath?: string;
    logPath?: string;
    statusCode?: number;
    attemptCount?: number;
    proxyUrl?: string;
    proxyBypassed?: boolean;
    error?: string;
}

interface AnalyzerHealthHistoryEntry {
    id: string;
    status: AnalyzerConnectivityStatus;
}

interface AnalyzerReadinessAssessment {
    assessedAt: string;
    benchmarkPath: string;
    level: 'ready' | 'warning' | 'blocked';
    summary: string;
    reasons: string[];
    recommendations: string[];
    recentEventCount: number;
    recentSuccesses: number;
    recentFailures: number;
    latestResultSource?: string;
    latestReachable?: boolean;
    smokeSuccessPresent: boolean;
    recentFailureBudget: number;
    recentFailureBudgetRemaining: number;
    recentFailureRate: number;
    consecutiveFailures: number;
    latestEventAgeHours?: number;
    smokeSuccessAgeHours?: number;
    latestEventStale: boolean;
    smokeSuccessStale: boolean;
}

interface SkillCreatorWorkbenchProps {
    skill: SkillRecord;
    onError: (message: string) => void;
}

interface SkillCreatorWorkbenchPrefs {
    benchmarkDir?: string;
    previousWorkspacePath?: string;
}

type DraftSource = 'llm' | 'heuristic' | null;
export type AnalyzerReliabilityLevel = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export function deriveAnalyzerReliability(history: AnalyzerHealthHistoryEntry[]): { level: AnalyzerReliabilityLevel; label: string } {
    const recent = history.slice(0, 5);
    if (recent.length === 0) {
        return { level: 'unknown', label: 'Unknown' };
    }
    const failures = recent.filter((entry) => !entry.status.reachable).length;
    const consecutiveFailures = Boolean(
        recent[0] &&
        !recent[0].status.reachable &&
        recent[1] &&
        !recent[1].status.reachable
    );
    const successRate = (recent.length - failures) / recent.length;
    if (consecutiveFailures || failures >= 3 || successRate < 0.5) {
        return { level: 'unhealthy', label: 'Unhealthy' };
    }
    if (failures > 0 || successRate < 0.8) {
        return { level: 'degraded', label: 'Degraded' };
    }
    return { level: 'healthy', label: 'Healthy' };
}

async function openLocalPath(path: string, revealParent = false): Promise<void> {
    await invoke('open_local_path', {
        input: {
            path,
            revealParent,
        },
    });
}

async function pickDirectory(defaultPath?: string): Promise<string | null> {
    const selected = await open({
        directory: true,
        multiple: false,
        defaultPath,
    });
    if (Array.isArray(selected)) {
        return selected[0] ?? null;
    }
    return selected;
}

async function pickJsonFile(defaultPath?: string): Promise<string | null> {
    const selected = await open({
        directory: false,
        multiple: false,
        defaultPath,
        filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (Array.isArray(selected)) {
        return selected[0] ?? null;
    }
    return selected;
}

export function SkillCreatorWorkbench({ skill, onError }: SkillCreatorWorkbenchProps) {
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [benchmarkDir, setBenchmarkDir] = useState('');
    const [previousWorkspacePath, setPreviousWorkspacePath] = useState('');
    const [lastStdout, setLastStdout] = useState<string>('');
    const [generatedBenchmarkJson, setGeneratedBenchmarkJson] = useState<string | null>(null);
    const [generatedBenchmarkMarkdown, setGeneratedBenchmarkMarkdown] = useState<string | null>(null);
    const [generatedReviewPath, setGeneratedReviewPath] = useState<string | null>(null);
    const [benchmarkPreview, setBenchmarkPreview] = useState<SkillBenchmarkDocument | null>(null);
    const [analyzerNotesDraft, setAnalyzerNotesDraft] = useState('');
    const [draftSource, setDraftSource] = useState<DraftSource>(null);
    const [draftStatus, setDraftStatus] = useState('');
    const [draftMetadata, setDraftMetadata] = useState<BenchmarkNotesDraftMetadata | null>(null);
    const [noteHistory, setNoteHistory] = useState<BenchmarkNotesHistoryEntry[]>([]);
    const [historyPath, setHistoryPath] = useState<string | null>(null);
    const [analyzerLogPath, setAnalyzerLogPath] = useState<string | null>(null);
    const [analyzerConnectivity, setAnalyzerConnectivity] = useState<AnalyzerConnectivityStatus | null>(null);
    const [analyzerHistory, setAnalyzerHistory] = useState<AnalyzerHealthHistoryEntry[]>([]);
    const [analyzerHistoryPath, setAnalyzerHistoryPath] = useState<string | null>(null);
    const [analyzerReadiness, setAnalyzerReadiness] = useState<AnalyzerReadinessAssessment | null>(null);
    const [analyzerReadinessPath, setAnalyzerReadinessPath] = useState<string | null>(null);
    const [liveReviewUrl, setLiveReviewUrl] = useState<string | null>(null);
    const [liveReviewLogPath, setLiveReviewLogPath] = useState<string | null>(null);
    const storageKey = useMemo(
        () => `coworkany:skill-creator-workbench:${skill.manifest.id}`,
        [skill.manifest.id]
    );

    const evalsPath = useMemo(
        () => `${skill.rootPath.replace(/[\\/]+$/, '')}/evals/evals.json`,
        [skill.rootPath]
    );
    const workspaceFeedbackPath = useMemo(
        () => benchmarkDir.trim()
            ? `${benchmarkDir.trim().replace(/[\\/]+$/, '')}/feedback.json`
            : '',
        [benchmarkDir]
    );
    const benchmarkJsonPath = useMemo(
        () => generatedBenchmarkJson ?? (benchmarkDir.trim()
            ? `${benchmarkDir.trim().replace(/[\\/]+$/, '')}/benchmark.json`
            : null),
        [benchmarkDir, generatedBenchmarkJson]
    );
    const benchmarkSummaryEntries = useMemo(() => {
        const summary = benchmarkPreview?.run_summary ?? {};
        return Object.entries(summary)
            .filter(([key]) => key !== 'delta')
            .map(([key, value]) => ({
                key,
                label: key.replace(/_/g, ' '),
                entry: value as SkillBenchmarkRunSummaryEntry,
            }));
    }, [benchmarkPreview]);
    const benchmarkDelta = useMemo(
        () => (benchmarkPreview?.run_summary?.delta ?? {}) as Record<string, string>,
        [benchmarkPreview]
    );
    const benchmarkRunNotes = useMemo(() => {
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const run of benchmarkPreview?.runs ?? []) {
            for (const note of run.notes ?? []) {
                const trimmed = note.trim();
                if (!trimmed || seen.has(trimmed)) {
                    continue;
                }
                seen.add(trimmed);
                deduped.push(trimmed);
            }
        }
        return deduped;
    }, [benchmarkPreview]);
    const analyzerHistorySummary = useMemo(() => {
        const total = analyzerHistory.length;
        const successes = analyzerHistory.filter((entry) => entry.status.reachable).length;
        const failures = total - successes;
        return { total, successes, failures };
    }, [analyzerHistory]);
    const analyzerReliability = useMemo(
        () => deriveAnalyzerReliability(analyzerHistory),
        [analyzerHistory]
    );
    const readinessBudgetSummary = useMemo(() => {
        if (!analyzerReadiness) {
            return null;
        }
        return {
            failureRatePct: Number.isFinite(analyzerReadiness.recentFailureRate)
                ? Math.round(analyzerReadiness.recentFailureRate * 100)
                : 0,
            latestEventAge: typeof analyzerReadiness.latestEventAgeHours === 'number'
                ? `${analyzerReadiness.latestEventAgeHours.toFixed(1)}h`
                : 'n/a',
            smokeAge: typeof analyzerReadiness.smokeSuccessAgeHours === 'number'
                ? `${analyzerReadiness.smokeSuccessAgeHours.toFixed(1)}h`
                : 'n/a',
        };
    }, [analyzerReadiness]);

    useEffect(() => {
        let restoredBenchmarkDir = '';
        let restoredPreviousWorkspacePath = '';
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw) as SkillCreatorWorkbenchPrefs;
                restoredBenchmarkDir = parsed.benchmarkDir ?? '';
                restoredPreviousWorkspacePath = parsed.previousWorkspacePath ?? '';
            }
        } catch {
            // Ignore malformed local storage payloads and reset to defaults.
        }

        setBenchmarkDir(restoredBenchmarkDir);
        setPreviousWorkspacePath(restoredPreviousWorkspacePath);
        setLastStdout('');
        setGeneratedBenchmarkJson(null);
        setGeneratedBenchmarkMarkdown(null);
        setGeneratedReviewPath(null);
        setBenchmarkPreview(null);
        setAnalyzerNotesDraft('');
        setDraftSource(null);
        setDraftStatus('');
        setDraftMetadata(null);
        setNoteHistory([]);
        setHistoryPath(null);
        setAnalyzerLogPath(null);
        setAnalyzerConnectivity(null);
        setAnalyzerHistory([]);
        setAnalyzerHistoryPath(null);
        setAnalyzerReadiness(null);
        setAnalyzerReadinessPath(null);
        setLiveReviewUrl(null);
        setLiveReviewLogPath(null);
    }, [storageKey]);

    useEffect(() => {
        setGeneratedBenchmarkJson(null);
        setGeneratedBenchmarkMarkdown(null);
        setGeneratedReviewPath(null);
        setBenchmarkPreview(null);
        setAnalyzerNotesDraft('');
        setDraftSource(null);
        setDraftStatus('');
        setDraftMetadata(null);
        setNoteHistory([]);
        setHistoryPath(null);
        setAnalyzerLogPath(null);
        setAnalyzerConnectivity(null);
        setAnalyzerHistory([]);
        setAnalyzerHistoryPath(null);
        setAnalyzerReadiness(null);
        setAnalyzerReadinessPath(null);
        setLiveReviewUrl(null);
        setLiveReviewLogPath(null);
    }, [benchmarkDir]);

    useEffect(() => {
        setAnalyzerNotesDraft((benchmarkPreview?.notes ?? []).join('\n'));
        setDraftSource(null);
        setDraftStatus('');
        setDraftMetadata(null);
        setAnalyzerLogPath(null);
    }, [benchmarkPreview]);

    useEffect(() => {
        const prefs: SkillCreatorWorkbenchPrefs = {
            benchmarkDir,
            previousWorkspacePath,
        };
        window.localStorage.setItem(storageKey, JSON.stringify(prefs));
    }, [benchmarkDir, previousWorkspacePath, storageKey]);

    const handleOpenPath = async (path: string, revealParent = false) => {
        try {
            await openLocalPath(path, revealParent);
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        }
    };

    const loadBenchmarkPreview = async (path: string, quiet = false) => {
        try {
            const result = await invoke<IpcResult>('load_skill_benchmark_preview', {
                input: { benchmarkPath: path },
            });
            const payload = result.payload ?? {};
            const benchmark = payload.benchmark;
            if (benchmark && typeof benchmark === 'object') {
                setBenchmarkPreview(benchmark as SkillBenchmarkDocument);
                return;
            }
            setBenchmarkPreview(null);
        } catch (error) {
            setBenchmarkPreview(null);
            if (!quiet) {
                onError(error instanceof Error ? error.message : String(error));
            }
        }
    };

    const loadBenchmarkNotesHistory = async (path: string, quiet = false) => {
        try {
            const result = await invoke<IpcResult>('load_skill_benchmark_notes_history', {
                input: {
                    benchmarkPath: path,
                    limit: 8,
                },
            });
            const payload = result.payload ?? {};
            setHistoryPath(typeof payload.path === 'string' ? payload.path : null);
            const entries = Array.isArray(payload.entries)
                ? payload.entries.filter((entry): entry is BenchmarkNotesHistoryEntry => Boolean(entry && typeof entry === 'object')).map((entry) => ({
                    id: String(entry.id ?? ''),
                    savedAt: String(entry.savedAt ?? ''),
                    notes: Array.isArray(entry.notes) ? entry.notes.map((note) => String(note)) : [],
                    previousNotes: Array.isArray(entry.previousNotes) ? entry.previousNotes.map((note) => String(note)) : [],
                    source: typeof entry.source === 'string' ? entry.source : undefined,
                    provider: typeof entry.provider === 'string' ? entry.provider : undefined,
                    model: typeof entry.model === 'string' ? entry.model : undefined,
                    warning: typeof entry.warning === 'string' ? entry.warning : undefined,
                    generatedAt: typeof entry.generatedAt === 'string' ? entry.generatedAt : undefined,
                }))
                : [];
            setNoteHistory(entries);
        } catch (error) {
            setNoteHistory([]);
            setHistoryPath(null);
            if (!quiet) {
                onError(error instanceof Error ? error.message : String(error));
            }
        }
    };

    const loadAnalyzerStatus = async (path: string, quiet = false) => {
        try {
            const result = await invoke<IpcResult>('load_skill_benchmark_analyzer_status', {
                input: { benchmarkPath: path },
            });
            const payload = result.payload ?? {};
            const status = payload.status;
            if (status && typeof status === 'object') {
                const statusRecord = status as Record<string, unknown>;
                setAnalyzerConnectivity({
                    configured: Boolean(statusRecord.configured),
                    reachable: Boolean(statusRecord.reachable),
                    provider: typeof statusRecord.provider === 'string' ? statusRecord.provider : undefined,
                    model: typeof statusRecord.model === 'string' ? statusRecord.model : undefined,
                    endpoint: typeof statusRecord.endpoint === 'string' ? statusRecord.endpoint : undefined,
                    checkedAt: typeof statusRecord.checkedAt === 'string' ? statusRecord.checkedAt : undefined,
                    resultSource: typeof statusRecord.resultSource === 'string' ? statusRecord.resultSource : undefined,
                    statusPath: typeof payload.path === 'string' ? payload.path : undefined,
                    logPath: typeof statusRecord.logPath === 'string' ? statusRecord.logPath : undefined,
                    statusCode: typeof statusRecord.statusCode === 'number' ? statusRecord.statusCode : undefined,
                    attemptCount: typeof statusRecord.attemptCount === 'number' ? statusRecord.attemptCount : undefined,
                    proxyUrl: typeof statusRecord.proxyUrl === 'string' ? statusRecord.proxyUrl : undefined,
                    proxyBypassed: typeof statusRecord.proxyBypassed === 'boolean' ? statusRecord.proxyBypassed : undefined,
                    error: typeof statusRecord.error === 'string' ? statusRecord.error : undefined,
                });
                return;
            }
            setAnalyzerConnectivity(null);
        } catch (error) {
            if (!quiet) {
                onError(error instanceof Error ? error.message : String(error));
            }
        }
    };

    const loadAnalyzerHistory = async (path: string, quiet = false) => {
        try {
            const result = await invoke<IpcResult>('load_skill_benchmark_analyzer_history', {
                input: {
                    benchmarkPath: path,
                    limit: 8,
                },
            });
            const payload = result.payload ?? {};
            setAnalyzerHistoryPath(typeof payload.path === 'string' ? payload.path : null);
            const entries = Array.isArray(payload.entries)
                ? payload.entries
                    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
                    .map((entry) => {
                        const status = entry.status && typeof entry.status === 'object'
                            ? entry.status as Record<string, unknown>
                            : {};
                        return {
                            id: String(entry.id ?? ''),
                            status: {
                                configured: Boolean(status.configured),
                                reachable: Boolean(status.reachable),
                                provider: typeof status.provider === 'string' ? status.provider : undefined,
                                model: typeof status.model === 'string' ? status.model : undefined,
                                endpoint: typeof status.endpoint === 'string' ? status.endpoint : undefined,
                                checkedAt: typeof status.checkedAt === 'string' ? status.checkedAt : undefined,
                                resultSource: typeof status.resultSource === 'string' ? status.resultSource : undefined,
                                statusPath: undefined,
                                logPath: typeof status.logPath === 'string' ? status.logPath : undefined,
                                statusCode: typeof status.statusCode === 'number' ? status.statusCode : undefined,
                                attemptCount: typeof status.attemptCount === 'number' ? status.attemptCount : undefined,
                                proxyUrl: typeof status.proxyUrl === 'string' ? status.proxyUrl : undefined,
                                proxyBypassed: typeof status.proxyBypassed === 'boolean' ? status.proxyBypassed : undefined,
                                error: typeof status.error === 'string' ? status.error : undefined,
                            },
                        };
                    })
                : [];
            setAnalyzerHistory(entries);
        } catch (error) {
            setAnalyzerHistory([]);
            setAnalyzerHistoryPath(null);
            if (!quiet) {
                onError(error instanceof Error ? error.message : String(error));
            }
        }
    };

    const assessAnalyzerReadiness = async (path: string, quiet = false) => {
        try {
            const result = await invoke<IpcResult>('assess_skill_benchmark_analyzer_readiness', {
                input: { benchmarkPath: path },
            });
            const payload = result.payload ?? {};
            setAnalyzerReadinessPath(typeof payload.path === 'string' ? payload.path : null);
            const assessment = payload.assessment;
            if (assessment && typeof assessment === 'object') {
                const record = assessment as Record<string, unknown>;
                setAnalyzerReadiness({
                    assessedAt: String(record.assessedAt ?? ''),
                    benchmarkPath: String(record.benchmarkPath ?? ''),
                    level: (record.level === 'ready' || record.level === 'warning' || record.level === 'blocked')
                        ? record.level
                        : 'blocked',
                    summary: String(record.summary ?? ''),
                    reasons: Array.isArray(record.reasons) ? record.reasons.map((value) => String(value)) : [],
                    recommendations: Array.isArray(record.recommendations) ? record.recommendations.map((value) => String(value)) : [],
                    recentEventCount: typeof record.recentEventCount === 'number' ? record.recentEventCount : 0,
                    recentSuccesses: typeof record.recentSuccesses === 'number' ? record.recentSuccesses : 0,
                    recentFailures: typeof record.recentFailures === 'number' ? record.recentFailures : 0,
                    latestResultSource: typeof record.latestResultSource === 'string' ? record.latestResultSource : undefined,
                    latestReachable: typeof record.latestReachable === 'boolean' ? record.latestReachable : undefined,
                    smokeSuccessPresent: Boolean(record.smokeSuccessPresent),
                    recentFailureBudget: typeof record.recentFailureBudget === 'number' ? record.recentFailureBudget : 0,
                    recentFailureBudgetRemaining: typeof record.recentFailureBudgetRemaining === 'number'
                        ? record.recentFailureBudgetRemaining
                        : 0,
                    recentFailureRate: typeof record.recentFailureRate === 'number' ? record.recentFailureRate : 0,
                    consecutiveFailures: typeof record.consecutiveFailures === 'number' ? record.consecutiveFailures : 0,
                    latestEventAgeHours: typeof record.latestEventAgeHours === 'number'
                        ? record.latestEventAgeHours
                        : undefined,
                    smokeSuccessAgeHours: typeof record.smokeSuccessAgeHours === 'number'
                        ? record.smokeSuccessAgeHours
                        : undefined,
                    latestEventStale: Boolean(record.latestEventStale),
                    smokeSuccessStale: Boolean(record.smokeSuccessStale),
                });
                return;
            }
            setAnalyzerReadiness(null);
        } catch (error) {
            if (!quiet) {
                onError(error instanceof Error ? error.message : String(error));
            }
        }
    };

    const checkAnalyzerConnectivity = async (quiet = false) => {
        try {
            if (!quiet) {
                setLoadingAction('check-analyzer');
            }
            const result = await invoke<IpcResult>('check_skill_benchmark_analyzer', {
                input: {
                    benchmarkPath: benchmarkJsonPath ?? undefined,
                },
            });
            const payload = result.payload ?? {};
            setAnalyzerConnectivity({
                configured: Boolean(payload.configured),
                reachable: Boolean(payload.reachable),
                provider: typeof payload.provider === 'string' ? payload.provider : undefined,
                model: typeof payload.model === 'string' ? payload.model : undefined,
                endpoint: typeof payload.endpoint === 'string' ? payload.endpoint : undefined,
                checkedAt: typeof payload.checkedAt === 'string' ? payload.checkedAt : undefined,
                resultSource: typeof payload.resultSource === 'string' ? payload.resultSource : undefined,
                statusPath: typeof payload.statusPath === 'string' ? payload.statusPath : undefined,
                logPath: typeof payload.logPath === 'string' ? payload.logPath : undefined,
                statusCode: typeof payload.statusCode === 'number' ? payload.statusCode : undefined,
                attemptCount: typeof payload.attemptCount === 'number' ? payload.attemptCount : undefined,
                proxyUrl: typeof payload.proxyUrl === 'string' ? payload.proxyUrl : undefined,
                proxyBypassed: typeof payload.proxyBypassed === 'boolean' ? payload.proxyBypassed : undefined,
                error: typeof payload.error === 'string' ? payload.error : undefined,
            });
            if (benchmarkJsonPath) {
                await loadAnalyzerHistory(benchmarkJsonPath, true);
                await assessAnalyzerReadiness(benchmarkJsonPath, true);
            }
        } catch (error) {
            setAnalyzerConnectivity({
                configured: false,
                reachable: false,
                error: error instanceof Error ? error.message : String(error),
            });
            if (!quiet) {
                onError(error instanceof Error ? error.message : String(error));
            }
        } finally {
            if (!quiet) {
                setLoadingAction(null);
            }
        }
    };

    const runAnalyzerSmoke = async () => {
        if (!benchmarkJsonPath) {
            onError('Benchmark JSON path is required before running analyzer smoke.');
            return;
        }

        try {
            setLoadingAction('smoke-analyzer');
            const result = await invoke<IpcResult>('run_skill_benchmark_analyzer_smoke', {
                input: {
                    benchmarkPath: benchmarkJsonPath,
                    skillPath: skill.rootPath,
                },
            });
            const payload = result.payload ?? {};
            setAnalyzerConnectivity({
                configured: Boolean(payload.configured),
                reachable: Boolean(payload.reachable),
                provider: typeof payload.provider === 'string' ? payload.provider : undefined,
                model: typeof payload.model === 'string' ? payload.model : undefined,
                endpoint: typeof payload.endpoint === 'string' ? payload.endpoint : undefined,
                checkedAt: typeof payload.checkedAt === 'string' ? payload.checkedAt : undefined,
                resultSource: typeof payload.resultSource === 'string' ? payload.resultSource : 'smoke',
                statusPath: typeof payload.statusPath === 'string' ? payload.statusPath : undefined,
                logPath: typeof payload.logPath === 'string' ? payload.logPath : undefined,
                statusCode: typeof payload.statusCode === 'number' ? payload.statusCode : undefined,
                attemptCount: typeof payload.attemptCount === 'number' ? payload.attemptCount : undefined,
                proxyUrl: typeof payload.proxyUrl === 'string' ? payload.proxyUrl : undefined,
                proxyBypassed: typeof payload.proxyBypassed === 'boolean' ? payload.proxyBypassed : undefined,
                error: typeof payload.error === 'string' ? payload.error : undefined,
            });
            if (typeof payload.logPath === 'string') {
                setAnalyzerLogPath(payload.logPath);
            }
            await loadAnalyzerHistory(benchmarkJsonPath, true);
            const smokeNotes = Array.isArray(payload.notes) ? payload.notes.map((note) => String(note)) : [];
            setLastStdout(
                Boolean(payload.reachable)
                    ? `Analyzer smoke passed${smokeNotes.length ? ` with ${smokeNotes.length} parsed note${smokeNotes.length === 1 ? '' : 's'}` : ''}`
                    : `Analyzer smoke failed${typeof payload.error === 'string' ? `: ${payload.error}` : ''}`
            );
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingAction(null);
        }
    };

    useEffect(() => {
        void checkAnalyzerConnectivity(true);
    }, [storageKey]);

    useEffect(() => {
        if (!benchmarkJsonPath) {
            return;
        }
        void loadAnalyzerStatus(benchmarkJsonPath, true);
        void loadAnalyzerHistory(benchmarkJsonPath, true);
        void assessAnalyzerReadiness(benchmarkJsonPath, true);
    }, [benchmarkJsonPath]);

    const loadLiveReviewStatus = async (workspacePath: string, quiet = false) => {
        try {
            const result = await invoke<SkillReviewServerResult>('get_skill_review_server_status', {
                input: { workspacePath },
            });
            setLiveReviewUrl(result.running ? (result.url ?? null) : null);
            setLiveReviewLogPath(result.logPath ?? null);
        } catch (error) {
            setLiveReviewUrl(null);
            setLiveReviewLogPath(null);
            if (!quiet) {
                onError(error instanceof Error ? error.message : String(error));
            }
        }
    };

    useEffect(() => {
        if (!benchmarkDir.trim()) {
            setLiveReviewUrl(null);
            setLiveReviewLogPath(null);
            return;
        }

        void loadLiveReviewStatus(benchmarkDir.trim(), true);
    }, [benchmarkDir]);

    const handleEnsureEvals = async () => {
        try {
            setLoadingAction('evals');
            const result = await invoke<SkillCreatorEvalPathsResult>('ensure_skill_evals_file', {
                input: {
                    skillPath: skill.rootPath,
                    skillName: skill.manifest.name,
                },
            });
            await openLocalPath(result.path);
            setLastStdout(result.created ? 'Created evals/evals.json' : 'Opened existing evals/evals.json');
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingAction(null);
        }
    };

    const handlePickBenchmarkDir = async () => {
        try {
            const selected = await pickDirectory(benchmarkDir.trim() || skill.rootPath);
            if (selected) {
                setBenchmarkDir(selected);
            }
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        }
    };

    const handlePickPreviousWorkspace = async () => {
        try {
            const selected = await pickDirectory(previousWorkspacePath.trim() || benchmarkDir.trim() || skill.rootPath);
            if (selected) {
                setPreviousWorkspacePath(selected);
            }
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleAggregateBenchmark = async () => {
        if (!benchmarkDir.trim()) {
            onError('Benchmark workspace path is required.');
            return;
        }

        try {
            setLoadingAction('benchmark');
            const result = await invoke<SkillCreatorEvalPathsResult>('aggregate_skill_benchmark', {
                input: {
                    benchmarkDir: benchmarkDir.trim(),
                    skillName: skill.manifest.name,
                    skillPath: skill.rootPath,
                },
            });
            setGeneratedBenchmarkJson(result.benchmarkJsonPath ?? null);
            setGeneratedBenchmarkMarkdown(result.benchmarkMarkdownPath ?? null);
            setLastStdout(result.stdout ?? 'Benchmark aggregation complete');
            if (result.benchmarkJsonPath) {
                await loadBenchmarkPreview(result.benchmarkJsonPath, true);
            }
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingAction(null);
        }
    };

    const handleGenerateReview = async () => {
        if (!benchmarkDir.trim()) {
            onError('Benchmark workspace path is required.');
            return;
        }

        try {
            setLoadingAction('review');
            const result = await invoke<SkillCreatorEvalPathsResult>('generate_skill_review_viewer', {
                input: {
                    workspacePath: benchmarkDir.trim(),
                    skillName: skill.manifest.name,
                    benchmarkPath: generatedBenchmarkJson ?? `${benchmarkDir.trim().replace(/[\\/]+$/, '')}/benchmark.json`,
                    previousWorkspacePath: previousWorkspacePath.trim() || undefined,
                },
            });
            if (result.outputPath) {
                setGeneratedReviewPath(result.outputPath);
                await openLocalPath(result.outputPath);
            }
            setLastStdout(
                `${result.stdout ?? 'Review viewer generated'}\n` +
                'When human review is finished, import the downloaded feedback.json into this workspace.'
            );
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingAction(null);
        }
    };

    const handleStartLiveReview = async () => {
        if (!benchmarkDir.trim()) {
            onError('Benchmark workspace path is required.');
            return;
        }

        try {
            setLoadingAction('live-review');
            const result = await invoke<SkillReviewServerResult>('start_skill_review_server', {
                input: {
                    workspacePath: benchmarkDir.trim(),
                    skillName: skill.manifest.name,
                    benchmarkPath: benchmarkJsonPath ?? undefined,
                    previousWorkspacePath: previousWorkspacePath.trim() || undefined,
                },
            });
            setLiveReviewUrl(result.url ?? null);
            setLiveReviewLogPath(result.logPath ?? null);
            setLastStdout(
                `${result.restarted ? 'Restarted' : 'Started'} live review server` +
                (result.url ? ` at ${result.url}` : '') +
                `\nFeedback now saves directly to ${workspaceFeedbackPath}.`
            );
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingAction(null);
        }
    };

    const handleStopLiveReview = async () => {
        if (!benchmarkDir.trim()) {
            onError('Benchmark workspace path is required.');
            return;
        }

        try {
            setLoadingAction('stop-live-review');
            const result = await invoke<SkillReviewServerResult>('stop_skill_review_server', {
                input: {
                    workspacePath: benchmarkDir.trim(),
                },
            });
            setLiveReviewUrl(null);
            setLiveReviewLogPath(result.logPath ?? null);
            setLastStdout(result.running ? 'Live review server is still running.' : 'Stopped live review server.');
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingAction(null);
        }
    };

    const handleLoadBenchmarkPreview = async () => {
        if (!benchmarkJsonPath) {
            onError('Benchmark JSON path is not available yet.');
            return;
        }

        try {
            setLoadingAction('preview');
            await loadBenchmarkPreview(benchmarkJsonPath, false);
            await loadBenchmarkNotesHistory(benchmarkJsonPath, true);
            setLastStdout(`Loaded benchmark preview from ${benchmarkJsonPath}`);
        } finally {
            setLoadingAction(null);
        }
    };

    const handleImportFeedback = async () => {
        if (!benchmarkDir.trim()) {
            onError('Benchmark workspace path is required before importing feedback.');
            return;
        }

        try {
            const selected = await pickJsonFile(benchmarkDir.trim());
            if (!selected) {
                return;
            }

            setLoadingAction('feedback');
            const result = await invoke<SkillCreatorEvalPathsResult>('import_skill_review_feedback', {
                input: {
                    workspacePath: benchmarkDir.trim(),
                    feedbackPath: selected,
                    overwrite: true,
                },
            });
            setLastStdout(result.stdout ?? 'Imported feedback.json into the workspace');
            await openLocalPath(result.path);
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingAction(null);
        }
    };

    const handleSaveBenchmarkNotes = async () => {
        if (!benchmarkJsonPath) {
            onError('Benchmark JSON path is not available yet.');
            return;
        }

        try {
            setLoadingAction('save-notes');
            const notes = analyzerNotesDraft
                .split(/\r?\n/)
                .map((note) => note.trim())
                .filter(Boolean);
            await invoke<IpcResult>('save_skill_benchmark_notes', {
                input: {
                    benchmarkPath: benchmarkJsonPath,
                    notes,
                    metadata: draftMetadata ? {
                        source: draftMetadata.source,
                        provider: draftMetadata.provider,
                        model: draftMetadata.model,
                        warning: draftMetadata.warning,
                        generatedAt: draftMetadata.generatedAt,
                    } : null,
                },
            });
            await loadBenchmarkPreview(benchmarkJsonPath, true);
            await loadBenchmarkNotesHistory(benchmarkJsonPath, true);
            setLastStdout(`Saved ${notes.length} analyzer note${notes.length === 1 ? '' : 's'} to ${benchmarkJsonPath}`);
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingAction(null);
        }
    };

    const handleGenerateBenchmarkNotesDraft = async () => {
        if (!benchmarkJsonPath) {
            onError('Benchmark JSON path is not available yet.');
            return;
        }

        try {
            setLoadingAction('generate-notes');
            const result = await invoke<IpcResult>('generate_skill_benchmark_notes', {
                input: {
                    benchmarkPath: benchmarkJsonPath,
                    skillPath: skill.rootPath,
                },
            });
            const payload = result.payload ?? {};
            const notes = Array.isArray(payload.notes)
                ? payload.notes.map((note) => String(note))
                : [];
            const source = payload.source === 'llm' || payload.source === 'heuristic'
                ? payload.source
                : null;
            const provider = typeof payload.provider === 'string' ? payload.provider : '';
            const model = typeof payload.model === 'string' ? payload.model : '';
            const warning = typeof payload.warning === 'string' ? payload.warning : '';
            const generatedAt = typeof payload.generatedAt === 'string'
                ? payload.generatedAt
                : new Date().toISOString();
            const attemptCount = typeof payload.attemptCount === 'number' ? payload.attemptCount : undefined;
            const proxyUrl = typeof payload.proxyUrl === 'string' ? payload.proxyUrl : undefined;
            const proxyBypassed = typeof payload.proxyBypassed === 'boolean' ? payload.proxyBypassed : undefined;
            const logPath = typeof payload.logPath === 'string' ? payload.logPath : undefined;
            const statusPath = typeof payload.statusPath === 'string' ? payload.statusPath : undefined;
            const resultSource = typeof payload.resultSource === 'string' ? payload.resultSource : undefined;
            setAnalyzerNotesDraft(notes.join('\n'));
            setDraftSource(source);
            setDraftMetadata({
                source: source ?? 'heuristic',
                provider: provider || undefined,
                model: model || undefined,
                warning: warning || undefined,
                generatedAt,
                attemptCount,
                proxyUrl,
                proxyBypassed,
                logPath,
            });
            setAnalyzerLogPath(logPath ?? null);
            setAnalyzerConnectivity({
                configured: Boolean(provider || model),
                reachable: source === 'llm',
                provider: provider || undefined,
                model: model || undefined,
                checkedAt: generatedAt,
                resultSource: resultSource || 'generate',
                statusPath,
                logPath,
                attemptCount,
                proxyUrl,
                proxyBypassed,
                error: source === 'llm' ? undefined : warning || 'Analyzer generation fell back to heuristic notes',
            });
            if (benchmarkJsonPath) {
                await loadAnalyzerHistory(benchmarkJsonPath, true);
                await assessAnalyzerReadiness(benchmarkJsonPath, true);
            }
            setDraftStatus(
                source === 'llm'
                    ? `Model-generated via ${provider}${model ? ` / ${model}` : ''}${attemptCount && attemptCount > 1 ? ` after ${attemptCount} attempts` : ''}`
                    : warning || 'Heuristic fallback draft'
            );
            setLastStdout(
                source === 'llm'
                    ? `Generated ${notes.length} analyzer note draft${notes.length === 1 ? '' : 's'} with ${provider}${model ? ` / ${model}` : ''}${attemptCount && attemptCount > 1 ? ` after ${attemptCount} attempts` : ''}${proxyUrl ? ` via proxy ${proxyUrl}` : proxyBypassed ? ' with proxy bypass' : ''}`
                    : `Generated ${notes.length} analyzer note draft with heuristic fallback${warning ? ` (${warning})` : ''}`
            );
        } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingAction(null);
        }
    };

    return (
        <div style={{
            padding: '12px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-panel)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
        }}>
            <div style={{ display: 'grid', gap: '4px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>Skill Creator Eval Loop</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Create or open <code>evals/evals.json</code>, aggregate benchmark results,
                    generate the official static review viewer, and bring downloaded
                    <code> feedback.json </code> back into the selected workspace.
                </div>
            </div>

            <div style={{
                display: 'grid',
                gap: '8px',
                padding: '12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-element)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'grid', gap: '4px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>Analyzer connectivity</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Probes the currently active model profile before you rely on model-backed draft generation.
                        </div>
                        <div style={{ fontSize: '12px', color: analyzerReliability.level === 'healthy' ? 'var(--text-secondary)' : analyzerReliability.level === 'degraded' ? 'var(--warning, #b45309)' : analyzerReliability.level === 'unhealthy' ? '#dc2626' : 'var(--text-muted)' }}>
                            Reliability: {analyzerReliability.label}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary" onClick={() => void checkAnalyzerConnectivity(false)} disabled={loadingAction !== null}>
                            {loadingAction === 'check-analyzer' ? 'Checking...' : 'Check analyzer'}
                        </button>
                        <button className="btn btn-secondary" onClick={() => void runAnalyzerSmoke()} disabled={loadingAction !== null || !benchmarkJsonPath}>
                            {loadingAction === 'smoke-analyzer' ? 'Running smoke...' : 'Run analyzer smoke'}
                        </button>
                        {analyzerConnectivity?.statusPath && (
                            <button className="btn btn-secondary" onClick={() => void handleOpenPath(analyzerConnectivity.statusPath!)} disabled={loadingAction !== null}>
                                Open status file
                            </button>
                        )}
                    </div>
                </div>
                {analyzerConnectivity ? (
                    <div style={{ display: 'grid', gap: '4px' }}>
                        <div style={{ fontSize: '12px', color: analyzerConnectivity.reachable ? 'var(--text-secondary)' : 'var(--warning, #b45309)' }}>
                            {analyzerConnectivity.configured
                                ? analyzerConnectivity.reachable
                                    ? `Ready: ${analyzerConnectivity.provider ?? 'provider'}${analyzerConnectivity.model ? ` / ${analyzerConnectivity.model}` : ''}`
                                    : `Configured but unreachable: ${analyzerConnectivity.provider ?? 'provider'}${analyzerConnectivity.model ? ` / ${analyzerConnectivity.model}` : ''}`
                                : 'No active model profile is configured for analyzer generation'}
                        </div>
                        {(analyzerConnectivity.attemptCount || analyzerConnectivity.statusCode || analyzerConnectivity.proxyUrl || analyzerConnectivity.proxyBypassed) && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {typeof analyzerConnectivity.statusCode === 'number' ? `HTTP ${analyzerConnectivity.statusCode}` : ''}
                                {analyzerConnectivity.attemptCount ? ` - ${analyzerConnectivity.attemptCount} attempt${analyzerConnectivity.attemptCount === 1 ? '' : 's'}` : ''}
                                {analyzerConnectivity.proxyUrl ? ` - Proxy ${analyzerConnectivity.proxyUrl}` : ''}
                                {!analyzerConnectivity.proxyUrl && analyzerConnectivity.proxyBypassed ? ' - Proxy bypassed' : ''}
                            </div>
                        )}
                        {(analyzerConnectivity.checkedAt || analyzerConnectivity.resultSource) && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {analyzerConnectivity.checkedAt ? `Last updated ${analyzerConnectivity.checkedAt}` : ''}
                                {analyzerConnectivity.resultSource ? ` - Source ${analyzerConnectivity.resultSource}` : ''}
                            </div>
                        )}
                        {analyzerConnectivity.error && (
                            <div style={{ fontSize: '12px', color: 'var(--warning, #b45309)' }}>
                                {analyzerConnectivity.error}
                            </div>
                        )}
                        {analyzerHistorySummary.total > 0 && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Recent analyzer health: {analyzerHistorySummary.successes} success{analyzerHistorySummary.successes === 1 ? '' : 'es'}, {analyzerHistorySummary.failures} failure{analyzerHistorySummary.failures === 1 ? '' : 's'} across the last {analyzerHistorySummary.total} event{analyzerHistorySummary.total === 1 ? '' : 's'}
                            </div>
                        )}
                        {analyzerHistory.length > 0 && (
                            <div style={{ display: 'grid', gap: '6px', marginTop: '4px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600 }}>Recent analyzer events</div>
                                    {analyzerHistoryPath && (
                                        <button className="btn btn-secondary" onClick={() => void handleOpenPath(analyzerHistoryPath)} disabled={loadingAction !== null}>
                                            Open history file
                                        </button>
                                    )}
                                </div>
                                {analyzerHistory.slice(0, 5).map((entry) => (
                                    <div key={entry.id} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        {entry.status.checkedAt ?? 'Unknown time'}
                                        {' - '}
                                        {entry.status.resultSource ?? 'unknown'}
                                        {' - '}
                                        {entry.status.reachable ? 'reachable' : 'failed'}
                                        {entry.status.provider ? ` - ${entry.status.provider}` : ''}
                                        {entry.status.model ? ` / ${entry.status.model}` : ''}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Connectivity has not been checked yet.
                    </div>
                )}
            </div>

            <div style={{
                display: 'grid',
                gap: '8px',
                padding: '12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-element)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'grid', gap: '4px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>Analyzer readiness gate</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Summarizes whether this workspace is ready to trust model-backed analyzer output.
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                            className="btn btn-secondary"
                            onClick={() => benchmarkJsonPath ? void assessAnalyzerReadiness(benchmarkJsonPath, false) : undefined}
                            disabled={loadingAction !== null || !benchmarkJsonPath}
                        >
                            Assess readiness
                        </button>
                        {analyzerReadinessPath && (
                            <button className="btn btn-secondary" onClick={() => void handleOpenPath(analyzerReadinessPath)} disabled={loadingAction !== null}>
                                Open readiness file
                            </button>
                        )}
                    </div>
                </div>
                {analyzerReadiness ? (
                    <div style={{ display: 'grid', gap: '6px' }}>
                        <div style={{ fontSize: '12px', color: analyzerReadiness.level === 'ready' ? 'var(--text-secondary)' : analyzerReadiness.level === 'warning' ? 'var(--warning, #b45309)' : '#dc2626' }}>
                            {analyzerReadiness.level.toUpperCase()} - {analyzerReadiness.summary}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Last assessed {analyzerReadiness.assessedAt} - {analyzerReadiness.recentSuccesses} success{analyzerReadiness.recentSuccesses === 1 ? '' : 'es'}, {analyzerReadiness.recentFailures} failure{analyzerReadiness.recentFailures === 1 ? '' : 's'} across {analyzerReadiness.recentEventCount} recent event{analyzerReadiness.recentEventCount === 1 ? '' : 's'}
                        </div>
                        {readinessBudgetSummary && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Failure budget: {analyzerReadiness.recentFailureBudgetRemaining}/{analyzerReadiness.recentFailureBudget} remaining
                                {' - '}
                                Failure rate {readinessBudgetSummary.failureRatePct}%
                                {' - '}
                                Latest event age {readinessBudgetSummary.latestEventAge}
                                {' - '}
                                Latest smoke success age {readinessBudgetSummary.smokeAge}
                            </div>
                        )}
                        {(analyzerReadiness.latestEventStale || analyzerReadiness.smokeSuccessStale || analyzerReadiness.consecutiveFailures > 0) && (
                            <div style={{ fontSize: '12px', color: analyzerReadiness.level === 'blocked' ? '#dc2626' : 'var(--warning, #b45309)' }}>
                                {analyzerReadiness.latestEventStale ? 'Latest event is stale. ' : ''}
                                {analyzerReadiness.smokeSuccessStale ? 'Latest successful smoke is stale. ' : ''}
                                {analyzerReadiness.consecutiveFailures > 0 ? `Consecutive failures: ${analyzerReadiness.consecutiveFailures}.` : ''}
                            </div>
                        )}
                        {analyzerReadiness.reasons.length > 0 && (
                            <div style={{ display: 'grid', gap: '4px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600 }}>Reasons</div>
                                {analyzerReadiness.reasons.map((reason) => (
                                    <div key={reason} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        - {reason}
                                    </div>
                                ))}
                            </div>
                        )}
                        {analyzerReadiness.recommendations.length > 0 && (
                            <div style={{ display: 'grid', gap: '4px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600 }}>Recommendations</div>
                                {analyzerReadiness.recommendations.map((recommendation) => (
                                    <div key={recommendation} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        - {recommendation}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Readiness has not been assessed for this workspace yet.
                    </div>
                )}
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Evals file</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input className="input-field" value={evalsPath} readOnly style={{ width: '100%' }} />
                    <button className="btn btn-secondary" onClick={() => void handleEnsureEvals()} disabled={loadingAction !== null}>
                        {loadingAction === 'evals' ? 'Opening...' : 'Create/Open'}
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Benchmark workspace</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                        className="input-field"
                        value={benchmarkDir}
                        onChange={(event) => setBenchmarkDir(event.target.value)}
                        placeholder="Path to iteration or benchmark workspace containing eval-* runs"
                        style={{ width: '100%' }}
                    />
                    <button className="btn btn-secondary" onClick={() => void handlePickBenchmarkDir()} disabled={loadingAction !== null}>
                        Browse
                    </button>
                    <button className="btn btn-secondary" onClick={() => void handleAggregateBenchmark()} disabled={loadingAction !== null}>
                        {loadingAction === 'benchmark' ? 'Aggregating...' : 'Aggregate'}
                    </button>
                    <button className="btn btn-secondary" onClick={() => void handleLoadBenchmarkPreview()} disabled={loadingAction !== null || !benchmarkJsonPath}>
                        {loadingAction === 'preview' ? 'Loading...' : 'Load summary'}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => void handleOpenPath(benchmarkDir.trim())}
                        disabled={loadingAction !== null || !benchmarkDir.trim()}
                    >
                        Open
                    </button>
                </div>
            </div>

            {benchmarkPreview && (
                <div style={{
                    display: 'grid',
                    gap: '12px',
                    padding: '12px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-element)',
                }}>
                    <div style={{ display: 'grid', gap: '4px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>Benchmark summary</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {benchmarkPreview.metadata?.skill_name ?? skill.manifest.name}
                            {benchmarkPreview.metadata?.timestamp ? ` - ${benchmarkPreview.metadata.timestamp}` : ''}
                            {benchmarkPreview.metadata?.evals_run?.length
                                ? ` - ${benchmarkPreview.metadata.evals_run.length} evals`
                                : ''}
                            {benchmarkPreview.metadata?.runs_per_configuration
                                ? ` - ${benchmarkPreview.metadata.runs_per_configuration} runs/config`
                                : ''}
                        </div>
                    </div>

                    {benchmarkSummaryEntries.length > 0 && (
                        <div style={{ display: 'grid', gap: '8px' }}>
                            {benchmarkSummaryEntries.map(({ key, label, entry }) => (
                                <div key={key} style={{
                                    display: 'grid',
                                    gridTemplateColumns: '120px repeat(3, minmax(0, 1fr))',
                                    gap: '8px',
                                    alignItems: 'center',
                                    padding: '10px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: 'var(--bg-panel)',
                                }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'capitalize' }}>{label}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        Pass rate: {typeof entry.pass_rate?.mean === 'number'
                                            ? `${Math.round(entry.pass_rate.mean * 100)}%`
                                            : '-'}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        Time: {typeof entry.time_seconds?.mean === 'number'
                                            ? `${entry.time_seconds.mean.toFixed(1)}s`
                                            : '-'}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        Tokens: {typeof entry.tokens?.mean === 'number'
                                            ? `${Math.round(entry.tokens.mean)}`
                                            : '-'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {(benchmarkDelta.pass_rate || benchmarkDelta.time_seconds || benchmarkDelta.tokens) && (
                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            <span>Delta pass rate: <strong style={{ color: 'var(--text-primary)' }}>{benchmarkDelta.pass_rate ?? '-'}</strong></span>
                            <span>Delta time: <strong style={{ color: 'var(--text-primary)' }}>{benchmarkDelta.time_seconds ?? '-'}</strong></span>
                            <span>Delta tokens: <strong style={{ color: 'var(--text-primary)' }}>{benchmarkDelta.tokens ?? '-'}</strong></span>
                        </div>
                    )}

                    {(benchmarkPreview.notes?.length || benchmarkRunNotes.length) ? (
                        <div style={{ display: 'grid', gap: '10px' }}>
                            {benchmarkPreview.notes && benchmarkPreview.notes.length > 0 && (
                                <div style={{ display: 'grid', gap: '6px' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600 }}>Analyzer notes</div>
                                    <div style={{ display: 'grid', gap: '6px' }}>
                                        {benchmarkPreview.notes.map((note, index) => (
                                            <div key={`analyzer-${index}`} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                - {note}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {benchmarkRunNotes.length > 0 && (
                                <div style={{ display: 'grid', gap: '6px' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600 }}>Run notes</div>
                                    <div style={{ display: 'grid', gap: '6px' }}>
                                        {benchmarkRunNotes.map((note) => (
                                            <div key={note} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                - {note}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            No analyzer notes are present in this benchmark yet. Per-run notes will appear here once grading or analysis adds them.
                        </div>
                    )}
                </div>
            )}

            <div style={{
                display: 'grid',
                gap: '8px',
                padding: '12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-element)',
            }}>
                <div style={{ display: 'grid', gap: '4px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Analyzer notes</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Write one observation per line. These lines are saved back into top-level <code>benchmark.json</code> notes and will show up in both the live viewer and in-app summary.
                    </div>
                </div>
                <textarea
                    className="input-field"
                    value={analyzerNotesDraft}
                    onChange={(event) => setAnalyzerNotesDraft(event.target.value)}
                    placeholder="Without-skill runs consistently fail on the primary expectation&#10;Skill adds slight latency but improves pass rate"
                    rows={5}
                    style={{ width: '100%', resize: 'vertical', fontFamily: 'var(--font-code)' }}
                />
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary" onClick={() => void handleGenerateBenchmarkNotesDraft()} disabled={loadingAction !== null || !benchmarkJsonPath}>
                        {loadingAction === 'generate-notes' ? 'Generating draft...' : 'Generate draft'}
                    </button>
                    <button className="btn btn-secondary" onClick={() => setAnalyzerNotesDraft((benchmarkRunNotes.length > 0 ? benchmarkRunNotes : benchmarkPreview?.notes ?? []).join('\n'))} disabled={loadingAction !== null || (!benchmarkRunNotes.length && !benchmarkPreview?.notes?.length)}>
                        Seed from existing notes
                    </button>
                    <button className="btn btn-primary" onClick={() => void handleSaveBenchmarkNotes()} disabled={loadingAction !== null || !benchmarkJsonPath}>
                        {loadingAction === 'save-notes' ? 'Saving notes...' : 'Save notes to benchmark'}
                    </button>
                    {analyzerLogPath && (
                        <button className="btn btn-secondary" onClick={() => void handleOpenPath(analyzerLogPath)} disabled={loadingAction !== null}>
                            Open analyzer log
                        </button>
                    )}
                </div>
                {draftStatus && (
                    <div style={{ fontSize: '12px', color: draftSource === 'llm' ? 'var(--text-secondary)' : 'var(--warning, #b45309)' }}>
                        {draftStatus}
                    </div>
                )}
                {draftMetadata && (draftMetadata.proxyUrl || draftMetadata.proxyBypassed || draftMetadata.generatedAt) && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {draftMetadata.generatedAt ? `Generated at ${draftMetadata.generatedAt}` : ''}
                        {draftMetadata.proxyUrl ? ` - Proxy ${draftMetadata.proxyUrl}` : ''}
                        {!draftMetadata.proxyUrl && draftMetadata.proxyBypassed ? ' - Proxy bypassed for this endpoint' : ''}
                    </div>
                )}
            </div>

            {benchmarkJsonPath && (
                <div style={{
                    display: 'grid',
                    gap: '8px',
                    padding: '12px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-element)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'grid', gap: '4px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 600 }}>Saved note history</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Each benchmark-note save appends a snapshot so you can inspect provenance and load an older version back into the editor.
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button className="btn btn-secondary" onClick={() => void loadBenchmarkNotesHistory(benchmarkJsonPath, false)} disabled={loadingAction !== null}>
                                Refresh history
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={() => historyPath ? void handleOpenPath(historyPath) : undefined}
                                disabled={loadingAction !== null || !historyPath}
                            >
                                Open history file
                            </button>
                        </div>
                    </div>

                    {noteHistory.length > 0 ? (
                        <div style={{ display: 'grid', gap: '8px' }}>
                            {noteHistory.map((entry) => (
                                <div key={entry.id} style={{
                                    display: 'grid',
                                    gap: '6px',
                                    padding: '10px',
                                    borderRadius: 'var(--radius-sm)',
                                    background: 'var(--bg-panel)',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            {entry.savedAt}
                                            {entry.source ? ` - ${entry.source}` : ''}
                                            {entry.provider ? ` - ${entry.provider}` : ''}
                                            {entry.model ? ` / ${entry.model}` : ''}
                                        </div>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => {
                                                setAnalyzerNotesDraft(entry.notes.join('\n'));
                                                setDraftSource(entry.source === 'llm' || entry.source === 'heuristic' ? entry.source : null);
                                                setDraftStatus(`Loaded saved snapshot from ${entry.savedAt}`);
                                                setDraftMetadata({
                                                    source: entry.source === 'llm' || entry.source === 'heuristic' ? entry.source : undefined,
                                                    provider: entry.provider,
                                                    model: entry.model,
                                                    warning: entry.warning,
                                                    generatedAt: entry.generatedAt,
                                                });
                                            }}
                                            disabled={loadingAction !== null}
                                        >
                                            Load into editor
                                        </button>
                                    </div>
                                    {entry.notes.length > 0 ? (
                                        <div style={{ display: 'grid', gap: '4px' }}>
                                            {entry.notes.slice(0, 3).map((note) => (
                                                <div key={`${entry.id}-${note}`} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                    - {note}
                                                </div>
                                            ))}
                                            {entry.notes.length > 3 && (
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                                    +{entry.notes.length - 3} more saved note{entry.notes.length - 3 === 1 ? '' : 's'}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                            This snapshot cleared top-level analyzer notes.
                                        </div>
                                    )}
                                    {entry.warning && (
                                        <div style={{ fontSize: '12px', color: 'var(--warning, #b45309)' }}>
                                            {entry.warning}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            No saved note history exists for this benchmark yet.
                        </div>
                    )}
                </div>
            )}

            <div style={{ display: 'grid', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Previous workspace (optional)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                        className="input-field"
                        value={previousWorkspacePath}
                        onChange={(event) => setPreviousWorkspacePath(event.target.value)}
                        placeholder="Optional previous iteration workspace for comparison"
                        style={{ width: '100%' }}
                    />
                    <button className="btn btn-secondary" onClick={() => void handlePickPreviousWorkspace()} disabled={loadingAction !== null}>
                        Browse
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => void handleOpenPath(previousWorkspacePath.trim())}
                        disabled={loadingAction !== null || !previousWorkspacePath.trim()}
                    >
                        Open
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Review feedback</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                        className="input-field"
                        value={workspaceFeedbackPath}
                        readOnly
                        placeholder="feedback.json will live inside the selected benchmark workspace"
                        style={{ width: '100%' }}
                    />
                    <button className="btn btn-secondary" onClick={() => void handleImportFeedback()} disabled={loadingAction !== null}>
                        {loadingAction === 'feedback' ? 'Importing...' : 'Import'}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => void handleOpenPath(workspaceFeedbackPath)}
                        disabled={loadingAction !== null || !workspaceFeedbackPath}
                    >
                        Open
                    </button>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Use this after the human reviewer downloads <code>feedback.json</code> from the static viewer.
                </div>
            </div>

            <div style={{
                display: 'grid',
                gap: '8px',
                padding: '12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-element)',
            }}>
                <div style={{ display: 'grid', gap: '4px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Live review server</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        Launch the official local server mode so feedback auto-saves into the workspace without a download/import step.
                    </div>
                    <div style={{ fontSize: '12px', color: liveReviewUrl ? 'var(--status-success)' : 'var(--text-muted)' }}>
                        Status: {liveReviewUrl ? 'running' : 'stopped'}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" onClick={() => void handleStartLiveReview()} disabled={loadingAction !== null}>
                        {loadingAction === 'live-review' ? 'Starting live viewer...' : 'Launch live viewer'}
                    </button>
                    <button className="btn btn-secondary" onClick={() => void handleStopLiveReview()} disabled={loadingAction !== null || !benchmarkDir.trim()}>
                        {loadingAction === 'stop-live-review' ? 'Stopping...' : 'Stop live viewer'}
                    </button>
                    {liveReviewLogPath && (
                        <button className="btn btn-secondary" onClick={() => void handleOpenPath(liveReviewLogPath)} disabled={loadingAction !== null}>
                            Open server log
                        </button>
                    )}
                </div>
                {liveReviewUrl && (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Live viewer URL: <code>{liveReviewUrl}</code>
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => void handleGenerateReview()} disabled={loadingAction !== null}>
                    {loadingAction === 'review' ? 'Generating viewer...' : 'Generate viewer'}
                </button>
                {generatedBenchmarkJson && (
                    <button className="btn btn-secondary" onClick={() => void handleOpenPath(generatedBenchmarkJson)} disabled={loadingAction !== null}>
                        Open benchmark.json
                    </button>
                )}
                {generatedBenchmarkMarkdown && (
                    <button className="btn btn-secondary" onClick={() => void handleOpenPath(generatedBenchmarkMarkdown)} disabled={loadingAction !== null}>
                        Open benchmark.md
                    </button>
                )}
                {generatedReviewPath && (
                    <button className="btn btn-secondary" onClick={() => void handleOpenPath(generatedReviewPath)} disabled={loadingAction !== null}>
                        Open review.html
                    </button>
                )}
            </div>

            {lastStdout && (
                <pre style={{
                    fontSize: '12px',
                    background: 'var(--bg-element)',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    overflowX: 'auto',
                    fontFamily: 'var(--font-code)',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                }}>
                    {lastStdout}
                </pre>
            )}
        </div>
    );
}

