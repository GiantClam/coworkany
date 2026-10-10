import type { OfficeHealthSource, OfficeProjector, OfficeSnapshot, OfficeStoreOptions } from "./types";

export interface OfficeStore { start(): Promise<void>; stop(): void; getSnapshot(): OfficeSnapshot; subscribe(listener: () => void): () => void }
type SubscribableProjector = OfficeProjector & { subscribe?: (listener: () => void) => () => void };

export function createOfficeStore(options: OfficeStoreOptions): OfficeStore {
  let projector: SubscribableProjector | null = null;
  let started = false;
  let generation = 0;
  let flight: Promise<void> | null = null;
  let pending = false;
  let timer: unknown;
  let unsubscribeSource: (() => void) | null = null;
  let unsubscribeProjector: (() => void) | null = null;
  const listeners = new Set<() => void>();
  let snapshot: OfficeSnapshot = { roles: [], workItems: [], revision: 0 };
  const notify = () => { if (!started) return; snapshot = projector?.getSnapshot() ?? snapshot; listeners.forEach((listener) => listener()); };
  const unknownHealth = (id: OfficeHealthSource["id"], reason: string) => ({ sourceId: id, status: "unknown" as const, observedAt: new Date().toISOString(), reason });
  const refresh = async (token: number) => {
    if (!started || token !== generation || !projector) return;
    const results = await Promise.allSettled([options.source.snapshot(), ...options.healthSources.map((source) => source.snapshot())]);
    if (!started || token !== generation || !projector) return;
    const sourceResult = results[0];
    if (sourceResult.status === "fulfilled") {
      const next = sourceResult.value.records.flatMap((record) => options.adapters.flatMap((adapter) => { const item = adapter.toWorkItem(record); return item ? [item] : []; }));
      const previous = new Map(snapshot.workItems.map((item) => [JSON.stringify([item.sourceAdapterId, item.workItemId]), item]));
      const current = new Map(next.map((item) => [JSON.stringify([item.sourceAdapterId, item.workItemId]), item]));
      if (snapshot.workItems.length === 0 && snapshot.revision === 0) projector.hydrate(next);
      else {
        previous.forEach((item, key) => { if (!current.has(key)) projector?.apply({ kind: "remove", key: { sourceAdapterId: item.sourceAdapterId, workItemId: item.workItemId } }); });
        current.forEach((item) => projector?.apply({ kind: "upsert", item }));
      }
      sourceResult.value.health.forEach((health) => projector?.apply({ kind: "source-health", health }));
    } else {
      options.healthSources.forEach((source) => projector?.apply({ kind: "source-health", health: unknownHealth(source.id, "source_snapshot_failed") }));
    }
    results.slice(1).forEach((result, index) => {
      const source = options.healthSources[index];
      if (result.status === "fulfilled") projector?.apply({ kind: "source-health", health: result.value as Awaited<ReturnType<OfficeHealthSource["snapshot"]>> });
      else projector?.apply({ kind: "source-health", health: unknownHealth(source.id, "health_snapshot_failed") });
    });
    notify();
  };
  const requestRefresh = () => {
    if (!started) return Promise.resolve();
    if (flight) { pending = true; return flight; }
    pending = false;
    const token = generation;
    const current = refresh(token).finally(() => {
      if (flight !== current) return;
      flight = null;
      if (pending && started && token === generation) void requestRefresh();
    });
    flight = current;
    return current;
  };
  const schedule = () => { if (started) timer = options.scheduler.setTimeout(() => { void requestRefresh().finally(schedule); }, options.discoveryRefreshMs); };
  return {
    async start() {
      if (started) return;
      started = true;
      generation += 1;
      projector = options.createProjector();
      snapshot = projector.getSnapshot();
      unsubscribeProjector = projector.subscribe?.(notify) ?? null;
      unsubscribeSource = options.source.subscribeInvalidation(() => { void requestRefresh(); });
      await requestRefresh();
      schedule();
    },
    stop() {
      if (!started) return;
      started = false;
      generation += 1;
      pending = false;
      if (timer !== undefined) options.scheduler.clearTimeout(timer);
      timer = undefined;
      unsubscribeSource?.(); unsubscribeSource = null;
      unsubscribeProjector?.(); unsubscribeProjector = null;
      options.source.clear();
      options.healthSources.forEach((source) => source.clear?.());
      projector?.dispose(); projector = null;
      flight = null;
      listeners.clear();
    },
    getSnapshot() { return projector?.getSnapshot() ?? snapshot; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
