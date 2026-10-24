import type { WorkbenchClient, WorkbenchConversation, WorkbenchRun, WorkbenchRunDetail, WorkbenchRunAttemptSummary } from "@coworkany/workbench-client";
import { readDesktopTaskMetadata } from "../desktop-task-metadata";
import type { OfficeClock, OfficeSourceHealth, RunRecord, RunRecordSnapshot, RunRecordSource } from "./types";

export interface RunRecordSourceDeps { readonly client: WorkbenchClient; readonly clock: OfficeClock; readonly reportDiagnostic: (code: string, detail?: string) => void }

function health(sourceId: OfficeSourceHealth["sourceId"], status: OfficeSourceHealth["status"], observedAt: string, lastSuccessfulAt?: string, reason?: string): OfficeSourceHealth { return { sourceId, status, observedAt, ...(lastSuccessfulAt ? { lastSuccessfulAt } : {}), ...(reason ? { reason } : {}) }; }

export function createRunRecordSource(deps: RunRecordSourceDeps): RunRecordSource {
  let conversations: readonly WorkbenchConversation[] | undefined;
  let runs: readonly WorkbenchRun[] | undefined;
  let attempts: readonly WorkbenchRunAttemptSummary[] | undefined;
  let flight: Promise<RunRecordSnapshot> | undefined;
  let generation = 0;
  let lastRecords: readonly RunRecord[] = [];
  let conversationLastSuccessfulAt: string | undefined;
  let runsLastSuccessfulAt: string | undefined;
  let attemptsLastSuccessfulAt: string | undefined;
  let detailsLastSuccessfulAt: string | undefined;
  const detailCache = new Map<string, { key: string; detail: WorkbenchRunDetail }>();
  const metadataCache = new Map<string, ReturnType<typeof readDesktopTaskMetadata>>();
  const unsubs = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  const observedAt = () => new Date(deps.clock.now()).toISOString();

  const syncSubscriptions = (nextRuns: readonly WorkbenchRun[], expectedGeneration: number) => {
    const active = new Set(nextRuns.filter((run) => run.status === "queued" || run.status === "running").map((run) => run.id));
    for (const [runId, unsubscribe] of unsubs) if (!active.has(runId)) { unsubscribe(); unsubs.delete(runId); }
    for (const runId of active) {
      if (expectedGeneration !== generation) return;
      if (unsubs.has(runId)) continue;
      const unsubscribe = deps.client.runs.subscribe(runId, () => { for (const listener of listeners) listener(); });
      // subscribe() may synchronously re-enter clear(). Do not repopulate the
      // cleared map, and tear down the just-created listener immediately.
      if (expectedGeneration !== generation) { unsubscribe(); return; }
      unsubs.set(runId, unsubscribe);
    }
  };

  async function load(): Promise<RunRecordSnapshot> {
    const loadGeneration = generation;
    const stamp = observedAt();
    const results = await Promise.allSettled([
      deps.client.conversations.list(),
      deps.client.runs.list(),
      deps.client.runs.recoverableAttempts?.() ?? Promise.resolve<readonly WorkbenchRunAttemptSummary[]>([]),
    ]);
    const conversationResult = results[0];
    const runsResult = results[1];
    const attemptsResult = results[2];
    const conversationReady = conversationResult.status === "fulfilled";
    const runsReady = runsResult.status === "fulfilled";
    const attemptsReady = attemptsResult.status === "fulfilled";
    if (loadGeneration !== generation) return { records: lastRecords, health: [], observedAt: stamp };
    if (conversationReady) { conversations = conversationResult.value; conversationLastSuccessfulAt = stamp; }
    if (runsReady) { runs = runsResult.value; syncSubscriptions(runs, loadGeneration); }
    if (runsReady) runsLastSuccessfulAt = stamp;
    if (attemptsReady) { attempts = attemptsResult.value; attemptsLastSuccessfulAt = stamp; }
    if (!runs) return { records: lastRecords, health: [health("conversations", conversationReady ? "ready" : "unknown", stamp, conversationLastSuccessfulAt), health("runs", "unknown", stamp, runsLastSuccessfulAt), health("run-details", "unknown", stamp, detailsLastSuccessfulAt), health("attempts", attemptsReady ? "ready" : "unknown", stamp, attemptsLastSuccessfulAt)], observedAt: stamp };
    if (!runsReady) return { records: lastRecords, health: [health("conversations", conversationReady ? "ready" : "unknown", stamp, conversationLastSuccessfulAt), health("runs", "unknown", stamp, runsLastSuccessfulAt), health("run-details", "unknown", stamp, detailsLastSuccessfulAt), health("attempts", attemptsReady ? "ready" : "unknown", stamp, attemptsLastSuccessfulAt)], observedAt: stamp };
    const records: RunRecord[] = [];
    let detailHealthFailed = false;
    for (const run of runs) {
      const key = run.finishedAt ? `${run.id}:${run.finishedAt}` : run.id;
      let detail = detailCache.get(run.id)?.key === key ? detailCache.get(run.id)!.detail : undefined;
      const shouldInspect = !run.finishedAt || !detail;
      let inspectFailed = false;
      if (shouldInspect) {
        try { detail = await deps.client.runs.inspect(run.id); if (loadGeneration !== generation) return { records: lastRecords, health: [], observedAt: stamp }; detailCache.set(run.id, { key, detail }); const parsed = readDesktopTaskMetadata(detail); if (parsed) metadataCache.set(run.id, parsed); }
        catch (error) { inspectFailed = true; deps.reportDiagnostic("virtual_office_run_detail_failed", String(error)); detail = detailCache.get(run.id)?.detail; }
      }
      if (!detail) continue;
      const conversation = conversations?.find((item) => item.id === run.conversationId);
      if (!conversationReady && !conversation && !metadataCache.get(run.id)?.kind) continue;
      records.push({ run, detail, conversation, metadata: metadataCache.get(run.id) ?? readDesktopTaskMetadata(detail), attempts: attempts?.filter((item) => item.runId === run.id) ?? [] });
      if (inspectFailed) detailHealthFailed = true;
    }
    const current = new Set(runs.map((run) => run.id));
    for (const runId of detailCache.keys()) if (!current.has(runId)) { detailCache.delete(runId); metadataCache.delete(runId); }
    if (!detailHealthFailed) detailsLastSuccessfulAt = stamp;
    if (runsReady) lastRecords = records;
    const outputRecords = runsReady ? records : lastRecords;
    return { records: outputRecords, health: [health("conversations", conversationReady ? "ready" : "unknown", stamp, conversationLastSuccessfulAt), health("runs", runsReady ? "ready" : "unknown", stamp, runsLastSuccessfulAt), health("run-details", detailHealthFailed ? "unknown" : "ready", stamp, detailsLastSuccessfulAt), health("attempts", attemptsReady ? "ready" : "unknown", stamp, attemptsLastSuccessfulAt)], observedAt: stamp };
  }

  return {
    snapshot() {
      if (!flight) {
        const current = load();
        const wrapped = current.finally(() => { if (flight === wrapped) flight = undefined; });
        flight = wrapped;
      }
      return flight;
    },
    subscribeInvalidation(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    clear() { generation += 1; for (const unsubscribe of unsubs.values()) unsubscribe(); unsubs.clear(); listeners.clear(); detailCache.clear(); metadataCache.clear(); conversations = undefined; runs = undefined; attempts = undefined; lastRecords = []; conversationLastSuccessfulAt = undefined; runsLastSuccessfulAt = undefined; attemptsLastSuccessfulAt = undefined; detailsLastSuccessfulAt = undefined; flight = undefined; },
  };
}
