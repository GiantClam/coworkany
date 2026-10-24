import assert from "node:assert/strict";
import { test } from "node:test";
import { CheapBuddyAccountService } from "../runtime/cheapbuddy-account";
import type { CredentialStore } from "../runtime/credential-store";

const modelList = [{ id: "glm-5.3", capabilities: ["text_generation"] }, { id: "image-fixture", capabilities: ["text_to_image"] }, { id: "video-fixture", capabilities: ["text_to_video"] }];
const managedName = "Coworkany/test-device";
const managedKey = { id: 80, name: managedName, key: "fixture-provider-secret", group_id: 2, status: "active" };
const identity = { id: 7, email: "fixture@example.test", username: "fixture", balance: 9.5 };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { code: 0, data } : { code: 1, message: "fixture-provider-secret fixture-access-secret" }), { status, headers: { "content-type": "application/json" } });

function memoryStore(persistent = true): CredentialStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, get: async (ref) => values.get(ref), set: async (ref, value) => { values.set(ref, value); return persistent; }, delete: async (ref) => { values.delete(ref); } };
}

function fixture(options: {
  keys?: Record<string, unknown>[];
  groups?: unknown[];
  checkout?: unknown;
  hook?: (path: string, init?: RequestInit) => Promise<Response | undefined> | Response | undefined;
  persistent?: boolean;
} = {}) {
  const store = memoryStore(options.persistent ?? true);
  const calls: Array<{ path: string; method: string; body: Record<string, unknown>; authorization?: string }> = [];
  const keys = [...(options.keys ?? [managedKey])];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method: init?.method ?? "GET", body, authorization: new Headers(init?.headers).get("authorization") ?? undefined });
    const custom = await options.hook?.(path, init);
    if (custom) return custom;
    if (path === "/api/v1/auth/login" || path === "/api/v1/auth/login/2fa") return response({ access_token: "fixture-access-secret", refresh_token: "fixture-refresh-secret", user: identity });
    if (path === "/api/v1/auth/refresh") return response({ access_token: "fixture-refreshed-access", refresh_token: "fixture-refreshed-refresh" });
    if (path === "/api/v1/auth/logout") return response({ message: "Logged out" });
    if (path === "/api/v1/auth/me") return response(identity);
    if (path.startsWith("/api/v1/keys?") && init?.method === "GET") return response({ items: keys, total: keys.length, pages: 1 });
    if (path === "/api/v1/keys" && init?.method === "POST") {
      const key = { ...managedKey, id: 80 + calls.length, group_id: body.group_id ?? null };
      keys.push(key);
      return response(key);
    }
    if (path.startsWith("/api/v1/keys/") && init?.method === "DELETE") { const index = keys.findIndex((key) => String(key.id) === path.split("/").at(-1)); if (index >= 0) keys.splice(index, 1); return response({}); }
    if (path === "/api/v1/groups/available") return response(options.groups ?? [{ id: 2, platform: "openai", status: "active", is_exclusive: false, subscription_type: "standard" }]);
    if (path === "/v1/models") return response(modelList);
    if (path === "/api/v1/subscriptions/active") return response([{ id: 3, group: { name: "Fixture member" }, expires_at: "2030-01-01T00:00:00Z" }]);
    if (path === "/api/v1/payment/checkout-info") return response(options.checkout ?? { plans: [] });
    if (path === "/api/v1/payment/plans") return response([]);
    throw new Error(`unexpected fixture route: ${path}`);
  };
  const service = new CheapBuddyAccountService({ store, fetch: fetchImpl, workspacePath: "/fixture/app-data", deviceId: "test-device", requestTimeoutMs: 20, now: () => new Date("2026-10-13T00:00:00Z") });
  return { store, calls, keys, service, fetchImpl };
}

const login = (service: CheapBuddyAccountService) => service.handle("login", { email: "fixture@example.test", password: "fixture-password" });

test("existing managed key configures text/image/video without exposing credentials to React", async () => {
  const { service, calls } = fixture();
  const state = await login(service);
  assert.equal(state.status, "connected");
  assert.equal(state.persistent, true);
  assert.equal(state.provider?.source, "cheapbuddy");
  assert.deepEqual(state.provider?.capabilityModels?.text?.models, ["glm-5.3"]);
  assert.deepEqual(state.provider?.capabilityModels?.image?.models, ["image-fixture"]);
  assert.deepEqual(state.provider?.capabilityModels?.video?.models, ["video-fixture"]);
  assert.equal(state.provider?.apiKey, undefined);
  assert.ok(!JSON.stringify(state).includes("secret"));
  assert.equal(await service.resolveApiKey(state.provider?.credentialRef ?? ""), managedKey.key);
  assert.equal(await service.resolveApiKey("cheapbuddy/account/another-installation"), undefined);
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/api/v1/keys").length, 0);
});

test("status restores a protected record locally and never makes network requests", async () => {
  const { service, store, fetchImpl, calls } = fixture();
  const state = await login(service);
  const count = calls.length;
  const restored = new CheapBuddyAccountService({ store, fetch: fetchImpl, workspacePath: "/fixture/app-data", deviceId: "test-device" });
  assert.equal((await restored.handle("status")).account?.id, 7);
  assert.equal(await restored.resolveApiKey(state.provider?.credentialRef ?? ""), managedKey.key);
  assert.equal(calls.length, count);
});

test("missing recharge_options is distinct from an empty catalog and prices are never invented", async () => {
  const { service } = fixture();
  const state = await login(service);
  assert.equal(state.rechargeCatalogAvailable, false);
  assert.deepEqual(state.products, []);
  const empty = await login(fixture({ checkout: { recharge_options: [], plans: [] } }).service);
  assert.equal(empty.rechargeCatalogAvailable, true);
});

test("real recharge and membership products keep separate semantics", async () => {
  const state = await login(fixture({ checkout: { recharge_options: [{ id: "r1", name: "Actual recharge", amount: 32, currency: "CNY" }], plans: [{ id: 4, name: "Actual membership", price: 12, currency: "USD", validity_days: 30 }] } }).service);
  assert.deepEqual(state.products.map((p) => [p.kind, p.amount, p.currency]), [["recharge", 32, "CNY"], ["membership", 12, "USD"]]);
  assert.equal(state.products[1].period, "30 days");
});

test("network failures preserve valid cached products and members", async () => {
  let fail = false;
  const { service } = fixture({ checkout: { recharge_options: [{ id: "r1", name: "Actual", amount: 32, currency: "CNY" }], plans: [] }, hook: (path) => { if (fail && path === "/api/v1/payment/checkout-info") throw new Error("fixture-access-secret"); return undefined; } });
  const before = await login(service);
  fail = true;
  const after = await service.handle("refresh");
  assert.deepEqual(after.products, before.products);
  assert.equal(after.rechargeCatalogAvailable, true);
  assert.equal(after.warning, "cheapbuddy_catalog_refresh_failed");
});

test("key pagination recovers the managed key without reusing another application's key", async () => {
  const pageOne = Array.from({ length: 100 }, (_, index) => ({ id: index, name: `Other/${index}`, key: "other-secret", status: "active" }));
  const { service, calls } = fixture({ keys: [], hook: (path) => path === "/api/v1/keys?page=1&page_size=100" ? response({ items: pageOne, total: 101, pages: 2 }) : path === "/api/v1/keys?page=2&page_size=100" ? response({ items: [managedKey], total: 101, pages: 2 }) : undefined });
  const state = await login(service);
  assert.equal(await service.resolveApiKey(state.provider?.credentialRef ?? ""), managedKey.key);
  assert.equal(calls.filter((call) => call.path === "/api/v1/keys").length, 0);
});

test("group-less default failure is cleaned before a unique permitted OpenAI fallback", async () => {
  const { service, calls, keys } = fixture({ keys: [], hook: (path) => path === "/v1/models" && keys.at(-1)?.group_id === null ? response({}, 502) : undefined });
  const state = await login(service);
  assert.equal(state.status, "connected");
  const creates = calls.filter((call) => call.path === "/api/v1/keys" && call.method === "POST");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0].body, { name: managedName });
  assert.deepEqual(creates[1].body, { name: managedName, group_id: 2 });
  assert.equal(keys.length, 1);
  await login(service);
  assert.equal(calls.filter((call) => call.path === "/api/v1/keys" && call.method === "POST").length, 2);
});

test("ambiguous groups fail clearly without hardcoded group IDs or an orphaned default key", async () => {
  const groups = [2, 9].map((groupId) => ({ id: groupId, platform: "openai", status: "active", is_exclusive: false }));
  const { service, keys, calls } = fixture({ keys: [], groups, hook: (path) => path === "/v1/models" ? response({}, 502) : undefined });
  await assert.rejects(login(service), /cheapbuddy_group_selection_ambiguous/u);
  assert.equal(keys.length, 0);
  assert.equal(calls.filter((call) => call.path === "/api/v1/keys" && call.method === "POST").length, 1);
});

test("exclusive, disabled, subscription and non-OpenAI groups are excluded from fallback", async () => {
  const groups = [{ id: 1, platform: "openai", status: "inactive", is_exclusive: false }, { id: 2, platform: "openai", status: "active", is_exclusive: true }, { id: 3, platform: "openai", status: "active", is_exclusive: false, subscription_type: "subscription" }, { id: 4, platform: "anthropic", status: "active", is_exclusive: false }];
  const { service, keys } = fixture({ keys: [], groups, hook: (path) => path === "/v1/models" ? response({}, 502) : undefined });
  await assert.rejects(login(service), /cheapbuddy_compatible_group_unavailable/u);
  assert.equal(keys.length, 0);
});

test("bound managed-key outages never delete the key or create more keys", async () => {
  const { service, keys, calls } = fixture({ hook: (path) => path === "/v1/models" ? response({}, 502) : undefined });
  await assert.rejects(login(service), /cheapbuddy_http_502/u);
  assert.equal(keys.length, 1);
  assert.equal(calls.filter((call) => call.path.startsWith("/api/v1/keys/") || call.path === "/api/v1/keys").length, 0);
});

test("timed-out creation reconciles by managed name before any retry", async () => {
  let created = false;
  const { service, calls } = fixture({ keys: [], hook: (path, init) => {
    if (path === "/api/v1/keys" && init?.method === "POST") { created = true; throw new Error("connection dropped after commit"); }
    if (path.startsWith("/api/v1/keys?") && created) return response({ items: [managedKey], total: 1 });
    return undefined;
  } });
  assert.equal((await login(service)).status, "connected");
  assert.equal(calls.filter((call) => call.path === "/api/v1/keys").length, 1);
});

test("unreconciled timed-out creation does not automatically retry", async () => {
  const { service, calls } = fixture({ keys: [], hook: (path, init) => { if (path === "/api/v1/keys" && init?.method === "POST") throw new Error("fixture-access-secret"); return undefined; } });
  await assert.rejects(login(service), /cheapbuddy_key_creation_uncertain/u);
  assert.equal(calls.filter((call) => call.path === "/api/v1/keys").length, 1);
});

test("2FA keeps temp_token Host-only and maps UI code to totp_code", async () => {
  const { service, calls } = fixture({ hook: (path) => path === "/api/v1/auth/login" ? response({ requires_2fa: true, temp_token: "fixture-temp-secret" }) : undefined });
  const pending = await login(service);
  assert.equal(pending.status, "verification_required");
  assert.ok(!JSON.stringify(pending).includes("fixture-temp-secret"));
  const state = await service.handle("verify", { code: "654321" });
  assert.equal(state.status, "connected");
  assert.deepEqual(calls.find((call) => call.path === "/api/v1/auth/login/2fa")?.body, { temp_token: "fixture-temp-secret", totp_code: "654321" });
});

test("expired access rotates the session once, re-reads data and never replays execution", async () => {
  let expire = false;
  const { service, calls } = fixture({ hook: (path, init) => path === "/api/v1/auth/me" && expire && new Headers(init?.headers).get("authorization") === "Bearer fixture-access-secret" ? response({}, 401) : undefined });
  await login(service);
  expire = true;
  assert.equal((await service.handle("refresh")).status, "connected");
  assert.equal(calls.filter((call) => call.path === "/api/v1/auth/refresh").length, 1);
  assert.ok(calls.every((call) => !call.path.includes("chat/completions")));
});

test("invalid refresh expires account and prevents resolving the saved API key", async () => {
  let expire = false;
  const { service } = fixture({ hook: (path) => expire && ["/api/v1/auth/me", "/api/v1/auth/refresh"].includes(path) ? response({}, 401) : undefined });
  const state = await login(service);
  expire = true;
  assert.equal((await service.handle("refresh")).status, "session_expired");
  assert.equal(await service.resolveApiKey(state.provider?.credentialRef ?? ""), undefined);
});

test("logout clears local credentials and revokes only this session's refresh token", async () => {
  const { service, store, calls } = fixture();
  const state = await login(service);
  assert.equal((await service.handle("logout")).status, "signed_out");
  assert.equal(store.values.size, 0);
  assert.equal(await service.resolveApiKey(state.provider?.credentialRef ?? ""), undefined);
  assert.deepEqual(calls.find((call) => call.path === "/api/v1/auth/logout")?.body, { refresh_token: "fixture-refresh-secret" });
  assert.ok(!calls.some((call) => call.path.includes("revoke-all")));
});

test("session-only store is clearly reported", async () => {
  const state = await login(fixture({ persistent: false }).service);
  assert.equal(state.persistent, false);
  assert.equal(state.warning, "cheapbuddy_credentials_session_only");
});

test("credential write failures fall back to the active process without leaking the runner error", async () => {
  const { store, fetchImpl } = fixture();
  store.set = async () => { throw new Error("fixture-provider-secret could not persist"); };
  const service = new CheapBuddyAccountService({ store, fetch: fetchImpl, workspacePath: "/fixture/app-data", deviceId: "test-device" });
  const state = await login(service);
  assert.equal(state.persistent, false);
  assert.equal(state.warning, "cheapbuddy_credentials_session_only");
  assert.equal(await service.resolveApiKey(state.provider?.credentialRef ?? ""), managedKey.key);
  assert.equal(store.values.size, 0);
});

test("masked managed keys are never recovered from unrelated account keys or duplicated", async () => {
  const { service, calls } = fixture({ keys: [{ ...managedKey, key: "sk-...masked" }, { ...managedKey, id: 90, name: "OtherApp", key: "unrelated-secret" }] });
  await assert.rejects(login(service), /cheapbuddy_managed_key_unavailable/u);
  assert.ok(!calls.some((call) => call.path === "/api/v1/keys" && call.method === "POST"));
  assert.equal(await service.resolveApiKey(service.credentialRef), undefined);
});

test("a failed cleanup prevents fallback creation", async () => {
  const { service, calls, keys } = fixture({ keys: [], hook: (path, init) => path === "/v1/models" ? response({}, 502) : path.startsWith("/api/v1/keys/") && init?.method === "DELETE" ? response({}, 403) : undefined });
  await assert.rejects(login(service), /cheapbuddy_http_403/u);
  assert.equal(keys.length, 1);
  assert.equal(calls.filter((call) => call.path === "/api/v1/keys" && call.method === "POST").length, 1);
});

test("protected restore strips unexpected apiKey and session fields from the UI provider", async () => {
  const { service, store, fetchImpl } = fixture();
  await login(service);
  const record = JSON.parse(store.values.get(service.credentialRef) ?? "{}");
  record.state.provider.apiKey = "must-never-reach-react";
  record.state.provider.access_token = "also-host-only";
  record.state.access_token = "another-secret";
  store.values.set(service.credentialRef, JSON.stringify(record));
  const restored = new CheapBuddyAccountService({ store, fetch: fetchImpl, workspacePath: "/fixture/app-data", deviceId: "test-device" });
  const state = await restored.handle("status");
  assert.ok(!JSON.stringify(state).includes("must-never-reach-react"));
  assert.ok(!JSON.stringify(state).includes("host-only"));
  assert.ok(!JSON.stringify(state).includes("another-secret"));
});

test("restoring an expired session remains expired and has no execution credential", async () => {
  let expire = false;
  const { service, store, fetchImpl } = fixture({ hook: (path) => expire && ["/api/v1/auth/me", "/api/v1/auth/refresh"].includes(path) ? response({}, 401) : undefined });
  await login(service);
  expire = true;
  await service.handle("refresh");
  const restored = new CheapBuddyAccountService({ store, fetch: fetchImpl, workspacePath: "/fixture/app-data", deviceId: "test-device" });
  assert.equal((await restored.handle("status")).status, "session_expired");
  assert.equal(await restored.resolveApiKey(service.credentialRef), undefined);
});

test("arbitrary server response messages never become IPC errors", async () => {
  const { service } = fixture({ hook: (path) => path === "/api/v1/auth/login" ? response({}, 403) : undefined });
  await assert.rejects(login(service), /^Error: cheapbuddy_http_403$/u);
});

test("logout invalidates stale login responses before they can save credentials", async () => {
  let release!: (value: Response) => void;
  const deferred = new Promise<Response>((resolve) => { release = resolve; });
  const { service, store } = fixture({ hook: (path) => path === "/api/v1/auth/login" ? deferred : undefined });
  const loginOperation = login(service);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await service.handle("logout");
  release(response({ access_token: "stale-secret", refresh_token: "stale-refresh" }));
  await assert.rejects(loginOperation, /cheapbuddy_request_superseded/u);
  assert.equal(store.values.size, 0);
  assert.equal((await service.handle("status")).status, "signed_out");
});
