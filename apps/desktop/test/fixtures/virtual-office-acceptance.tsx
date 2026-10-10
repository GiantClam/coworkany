import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { OfficeCapabilities, OfficeClock, OfficeStore, OfficeWorkItem } from "../../src/virtual-office/types";
import { createOfficeProjector } from "../../src/virtual-office/projector";
import { enabledOfficeRoles, OFFICE_ROLE_REGISTRY } from "../../src/virtual-office/role-registry";
import { buildOfficeCapabilities } from "../../src/virtual-office/capabilities";
import { officeAssetManifestPath } from "../../src/virtual-office/asset-registry";
import { VirtualOfficeHome } from "../../src/virtual-office/VirtualOfficeHome";
import "../../src/virtual-office/virtual-office.css";
import "../../src/styles.css";
import "../../src/tailwind.css";
import "@coworkany/workbench-ui/styles.css";

const ROLE_IDS = OFFICE_ROLE_REGISTRY.map((role) => role.roleId);
const statuses: OfficeWorkItem["status"][] = ["running", "waiting", "queued", "completed", "failed", "cancelled", "running", "completed"];
const clock: OfficeClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function fixtureCapabilities(): OfficeCapabilities {
  return buildOfficeCapabilities({
    routes: new Set([
      "/dashboard/ai", "/dashboard/agent-platform", "/dashboard/workflows", "/dashboard/writer",
      "/dashboard/image-assistant", "/dashboard/video", "/dashboard/assets",
    ]),
    featureFlags: new Set(["ppt_generate"]),
    runtime: { text: true, agents: true, workflows: true },
    providers: { image: "configured", video: "configured" },
    agentDirectoryReady: true,
  });
}

function fixtureItems(): OfficeWorkItem[] {
  return Array.from({ length: 50 }, (_, index) => {
    const roleId = ROLE_IDS[index % ROLE_IDS.length]!;
    const role = OFFICE_ROLE_REGISTRY.find((candidate) => candidate.roleId === roleId)!;
    const status = statuses[index % statuses.length]!;
    return {
      sourceAdapterId: role.sourceAdapterId,
      workItemId: `fixture-${index + 1}`,
      roleId,
      status,
      ...(status === "waiting" ? { attention: "user" as const } : {}),
      statusVersion: `fixture-${index}-${status}`,
      title: `${role.label.en} fixture item ${String(index + 1).padStart(2, "0")}`,
      updatedAt: new Date(Date.now() - index * 1_000).toISOString(),
      routeTarget: `${role.homeRoute}${role.homeRoute.includes("?") ? "&" : "?"}fixtureItem=${index + 1}`,
      artifactIds: [],
    };
  });
}

function createFixtureStore(items: readonly OfficeWorkItem[]): OfficeStore & { updateStatuses(next: OfficeWorkItem["status"]): void; reset(): void } {
  const roles = enabledOfficeRoles(fixtureCapabilities());
  const projector = createOfficeProjector({ clock, roles });
  let current = [...items];
  const applyHealth = () => roles.flatMap((role) => role.healthSourceIds).forEach((sourceId) => projector.apply({ kind: "source-health", health: { sourceId, status: "ready", observedAt: new Date().toISOString() } }));
  const hydrate = () => { projector.hydrate(current); applyHealth(); };
  hydrate();
  return {
    start: async () => undefined,
    stop: () => projector.dispose(),
    getSnapshot: () => projector.getSnapshot(),
    subscribe: (listener) => projector.subscribe(listener),
    updateStatuses: (status) => {
      current = current.map((item, index) => ({ ...item, status, statusVersion: `${item.statusVersion}-${status}-${Date.now()}-${index}` }));
      current.forEach((item) => projector.apply({ kind: "upsert", item }));
    },
    reset: () => { current = [...items]; hydrate(); },
  };
}

function ManifestFetchScope({ invalid, children }: { readonly invalid: boolean; readonly children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const originalFetch = globalThis.fetch;
    const target = new URL(officeAssetManifestPath(), globalThis.location.href).href;
    globalThis.fetch = (async (input, init) => {
      const requested = typeof input === "string" ? new URL(input, globalThis.location.href).href : input instanceof URL ? input.href : input.url;
      if (invalid && requested === target) return new Response(JSON.stringify({ schemaVersion: 1, assets: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return originalFetch(input, init);
    }) as typeof fetch;
    setReady(true);
    return () => { globalThis.fetch = originalFetch; setReady(false); };
  }, [invalid]);
  return ready ? <>{children}</> : null;
}

function AcceptanceFixture() {
  const seed = useMemo(() => fixtureItems(), []);
  const [store] = useState(() => createFixtureStore(seed));
  const [locale, setLocale] = useState<"en" | "zh">("en");
  const [invalidManifest, setInvalidManifest] = useState(new URLSearchParams(globalThis.location.search).get("invalidManifest") === "1");
  const [sceneKey, setSceneKey] = useState(0);
  const [route, setRoute] = useState("No route selected");
  useEffect(() => () => store.stop(), [store]);
  const capabilities = fixtureCapabilities();
  const navigation = { go: (next: string) => setRoute(next), replace: (next: string) => setRoute(next), current: () => route };
  const remountScene = (invalid: boolean) => { setInvalidManifest(invalid); setSceneKey((key) => key + 1); };
  return <main className="office-fixture-shell">
    <style>{`.office-fixture-shell{height:100%;overflow:auto;padding:14px 20px 40px;background:#fdfdfb;color:#171713}.office-fixture-banner{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:10px 14px;border:1px solid #e7d58a;border-radius:10px;background:#fff8d8;font-size:12px}.office-fixture-banner span,.office-fixture-counts{color:#777;font-size:11px}.office-fixture-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0 8px}.office-fixture-controls button{border:1px solid #d8d8ce;border-radius:7px;padding:6px 9px;background:#fff;color:#171713;font-size:11px}.office-fixture-controls button:hover{border-color:#c49d00;background:#fff9d9}.office-fixture-controls span{font-size:11px;color:#777}.office-fixture-route{margin:8px 0;color:#777;font-size:12px}.office-fixture-route code{color:#171713}.office-fixture-counts{margin-bottom:10px}`}</style>
    <header className="office-fixture-banner"><strong>TEST FIXTURE · Virtual Office acceptance</strong><span>Click a character to inspect its live status card · Local seeded data only · no Tauri, network API, or user data</span></header>
    <section className="office-fixture-controls" aria-label="Fixture controls">
      <button type="button" onClick={() => setLocale((value) => value === "en" ? "zh" : "en")}>Language: {locale}</button>
      <button type="button" onClick={() => store.updateStatuses("running")}>Set all running</button>
      <button type="button" onClick={() => store.updateStatuses("completed")}>Set all completed</button>
      <button type="button" onClick={() => store.updateStatuses("failed")}>Set all failed</button>
      <button type="button" onClick={() => store.reset()}>Reset 50 items</button>
      <button type="button" onClick={() => remountScene(true)}>Mount invalid manifest</button>
      <button type="button" onClick={() => remountScene(false)}>Restore valid manifest</button>
      <span role="status">Manifest: {invalidManifest ? "invalid (scene fallback expected)" : "valid"}</span>
    </section>
    <p className="office-fixture-route" role="status">Last route: <code>{route}</code></p>
    <div className="office-fixture-counts">Seeded 50 items · 7 roles · 21 device slots + overflow (+N). Scene key: {sceneKey}</div>
    <ManifestFetchScope invalid={invalidManifest}>
      <VirtualOfficeHome key={sceneKey} store={store} capabilities={capabilities} navigation={navigation} locale={locale} sceneEnabled standalone />
    </ManifestFetchScope>
  </main>;
}

const fixtureRoot = createRoot(document.getElementById("root")!);
fixtureRoot.render(<AcceptanceFixture />);
import.meta.hot?.dispose(() => fixtureRoot.unmount());
