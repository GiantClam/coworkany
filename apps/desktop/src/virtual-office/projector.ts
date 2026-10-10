import type { OfficeClock, OfficeProjectionChange, OfficeProjector, OfficeRoleDefinition, OfficeRoleId, OfficeRoleState, OfficeSnapshot, OfficeWorkItem, OfficeWorkItemKey } from "./types";
import { DEVICE_LIMIT, RECENT_ITEM_LIMIT, TERMINAL_DISPLAY_MS } from "./types";

const keyOf = (key: OfficeWorkItemKey) => JSON.stringify([key.sourceAdapterId, key.workItemId]);
const terminal = (status: OfficeWorkItem["status"]) => status === "completed" || status === "failed" || status === "cancelled";
const active = (status: OfficeWorkItem["status"]) => status === "queued" || status === "running" || status === "waiting";
const rank: Record<string, number> = { failed: 8, cancelled: 7, completed: 6, running: 5, waiting: 4, queued: 3, unknown: 0 };

type ExtendedProjector = OfficeProjector & { subscribe(listener: () => void): () => void };

export function createOfficeProjector({ clock, roles, unavailableRoleIds = new Set<OfficeRoleId>() }: { clock: OfficeClock; roles: readonly OfficeRoleDefinition[]; unavailableRoleIds?: ReadonlySet<OfficeRoleId> }): ExtendedProjector {
  const items = new Map<string, OfficeWorkItem>();
  const expiry = new Map<string, unknown>();
  const health = new Map<string, "ready" | "unknown" | "offline">();
  const listeners = new Set<() => void>();
  let revision = 0;
  let disposed = false;
  let cached: OfficeSnapshot | null = null;

  const roleStatus = (role: OfficeRoleDefinition, roleItems: readonly OfficeWorkItem[]) => {
    if (unavailableRoleIds.has(role.roleId)) return "offline" as const;
    const states = role.healthSourceIds.map((source) => health.get(`${role.roleId}:${source}`) ?? "unknown");
    const healthStatus = states.includes("offline") ? "offline" : states.includes("unknown") ? "unknown" : "ready";
    const terminalDisplay = roleItems.filter((item) => terminal(item.status) && expiry.has(keyOf(item)));
    if (terminalDisplay.length) return terminalDisplay.reduce((current, item) => rank[item.status] > rank[current] ? item.status : current, "unknown");
    const live = roleItems.filter((item) => active(item.status));
    if (healthStatus === "offline") return "offline";
    if (healthStatus === "unknown") return "unknown";
    if (live.length === 0) return "idle";
    return live.reduce((current, item) => rank[item.status] > rank[current] ? item.status : current, "unknown");
  };
  const build = (): OfficeSnapshot => {
    if (cached && cached.revision === revision) return cached;
    const roleStates = roles.map((role) => {
      const roleItems = [...items.values()].filter((item) => item.roleId === role.roleId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const busy = roleItems.filter((item) => active(item.status));
      const terminalDisplay = roleItems.filter((item) => terminal(item.status) && expiry.has(keyOf(item)));
      const displayItems = [...busy, ...terminalDisplay];
      const devices = displayItems.slice(0, role.deviceLimit || DEVICE_LIMIT).map((item) => ({ deviceId: keyOf(item), workItemKey: { sourceAdapterId: item.sourceAdapterId, workItemId: item.workItemId }, visualStatus: item.status }));
      const recentItems = roleItems.filter((item) => terminal(item.status) && !expiry.has(keyOf(item))).slice(0, RECENT_ITEM_LIMIT);
      return { roleId: role.roleId, status: roleStatus(role, roleItems), activeCount: roleItems.filter((item) => item.status === "running").length, queuedCount: roleItems.filter((item) => item.status === "queued").length, waitingUserCount: roleItems.filter((item) => item.status === "waiting" && item.attention === "user").length, failedCount: roleItems.filter((item) => item.status === "failed").length, recentItems, devices, overflowCount: Math.max(0, displayItems.length - devices.length), available: healthStatus(role, health) !== "offline" } as OfficeRoleState;
    });
    cached = { roles: roleStates, workItems: [...items.values()], revision };
    return cached;
  };
  const healthStatus = (role: OfficeRoleDefinition, map: Map<string, "ready" | "unknown" | "offline">) => {
    if (unavailableRoleIds.has(role.roleId)) return "offline" as const;
    const states = role.healthSourceIds.map((source) => map.get(`${role.roleId}:${source}`) ?? "unknown");
    return states.includes("offline") ? "offline" : states.includes("unknown") ? "unknown" : "ready";
  };
  const notify = () => listeners.forEach((listener) => listener());
  const bump = () => { revision += 1; cached = null; notify(); return build(); };
  const clearExpiry = (key: string) => { const timer = expiry.get(key); if (timer !== undefined) clock.clearTimeout(timer); expiry.delete(key); };
  const scheduleExpiry = (key: string) => {
    clearExpiry(key);
    const due = TERMINAL_DISPLAY_MS;
    expiry.set(key, clock.setTimeout(() => { expiry.delete(key); bump(); }, due));
  };
  const hydrate = (next: readonly OfficeWorkItem[]) => { items.clear(); expiry.forEach((timer) => clock.clearTimeout(timer)); expiry.clear(); next.forEach((item) => items.set(keyOf(item), item)); return bump(); };
  return {
    hydrate,
    apply(change: OfficeProjectionChange) {
      if (disposed) return build();
      if (change.kind === "source-health") {
        let changed = false;
        for (const role of roles) if (role.healthSourceIds.includes(change.health.sourceId)) {
          const key = `${role.roleId}:${change.health.sourceId}`;
          if (health.get(key) !== change.health.status) { health.set(key, change.health.status); changed = true; }
        }
        return changed ? bump() : build();
      }
      const key = keyOf(change.kind === "remove" ? change.key : change.item);
      if (change.kind === "remove") { const changed = items.delete(key); clearExpiry(key); return changed ? bump() : build(); }
      const previous = items.get(key);
      if (previous && previous.status === change.item.status && previous.statusVersion === change.item.statusVersion) return build();
      if (!active(change.item.status)) {
        if (terminal(change.item.status) && previous && active(previous.status)) scheduleExpiry(key);
        else if (!terminal(change.item.status)) clearExpiry(key);
      } else clearExpiry(key);
      items.set(key, change.item);
      return bump();
    },
    getSnapshot: build,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { if (disposed) return; disposed = true; expiry.forEach((timer) => clock.clearTimeout(timer)); expiry.clear(); listeners.clear(); items.clear(); cached = null; },
  };
}
