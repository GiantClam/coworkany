import type { AgentDirectoryEntry, AgentDirectoryReadResult, AgentDirectoryReader, AgentDirectorySnapshot, AgentRuntimeProbe } from "./types";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Catalog = { skills?: unknown[]; agents?: unknown[] } | unknown[];

function entriesFromCatalog(catalog: Catalog): AgentDirectoryEntry[] {
  const values = Array.isArray(catalog) ? catalog : Array.isArray(catalog.skills) ? catalog.skills : Array.isArray(catalog.agents) ? catalog.agents : [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const agentId = typeof item.id === "string" ? item.id : typeof item.agentId === "string" ? item.agentId : null;
    if (!agentId) return [];
    return [{ agentId, label: typeof item.title === "string" ? item.title : typeof item.label === "string" ? item.label : agentId, installed: item.installed !== false, availability: item.available === false ? "unavailable" as const : "available" as const }];
  });
}

export function createAgentDirectoryReader(invoke: Invoke): AgentDirectoryReader {
  let cache: AgentDirectoryReadResult | undefined;
  let flight: Promise<AgentDirectoryReadResult> | undefined;
  let generation = 0;
  const read = async ({ refresh = false } = {}) => {
    if (!refresh && cache) return cache;
    if (!flight) {
      const requestGeneration = generation;
      flight = Promise.all([invoke<Catalog>("list_local_skill_catalog"), invoke<AgentRuntimeProbe>("runtime_status")]).then(([catalog, runtime]) => {
        const snapshot: AgentDirectorySnapshot = { entries: entriesFromCatalog(catalog), runtime: runtime.ready && runtime.skills !== false ? "ready" : "unavailable", observedAt: new Date().toISOString() };
        const result: AgentDirectoryReadResult = snapshot.runtime === "ready" ? { status: "ready", snapshot } : { status: "offline", snapshot, reason: "runtime_unavailable" };
        if (requestGeneration === generation) cache = result;
        return result;
      }).catch((error) => {
        const result: AgentDirectoryReadResult = { status: "unknown", ...(cache && "snapshot" in cache ? { snapshot: cache.snapshot } : {}), reason: error instanceof Error ? error.message : String(error) };
        if (requestGeneration === generation) cache = result;
        return result;
      }).finally(() => { if (requestGeneration === generation) flight = undefined; });
    }
    return flight;
  };
  return { read, getSnapshot: () => cache, clear() { generation += 1; cache = undefined; flight = undefined; } };
}
