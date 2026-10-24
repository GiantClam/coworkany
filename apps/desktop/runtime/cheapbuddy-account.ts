import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { CHEAPBUDDY, createCheapBuddyProvider } from "../src/cheapbuddy";
import { SIGNED_OUT_CHEAPBUDDY_STATE, type CheapBuddyAccountAction, type CheapBuddyAccountState, type CheapBuddyProduct } from "../src/cheapbuddy-contract";
import { normalizeProviderModelsForCapability } from "../src/provider-model-discovery";
import { setProviderCapabilityModels, type DesktopProviderConfig } from "../src/provider-config";
import { createCredentialStore, type CredentialStore } from "./credential-store";

type JsonObject = Record<string, unknown>;
type SessionRecord = {
  version: 1;
  accessToken: string;
  refreshToken?: string;
  apiKey?: string;
  keyId?: number | string;
  accountId?: number | string;
  state: CheapBuddyAccountState;
};

class AccountApiError extends Error {
  constructor(readonly status: number, readonly reason: "http" | "network" | "timeout" | "invalid_response" = "http") {
    // Arbitrary server/fetch errors may echo credentials. Only a fixed code crosses IPC.
    super(`cheapbuddy_${reason}${status ? `_${status}` : ""}`);
  }
}

const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const string = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const numeric = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const id = (value: unknown): string | number | undefined => typeof value === "number" && Number.isFinite(value) || typeof value === "string" && Boolean(value.trim()) ? value : undefined;
function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = object(value);
  for (const field of ["items", "data", "plans", "subscriptions", "groups"]) if (Array.isArray(record[field])) return record[field] as unknown[];
  return [];
}

function account(value: unknown): CheapBuddyAccountState["account"] {
  const record = object(value);
  const accountId = id(record.id);
  const email = string(record.email);
  if (accountId === undefined || !email) return undefined;
  return { id: accountId, email, ...(string(record.username) ? { username: string(record.username) } : {}), ...(numeric(record.balance) !== undefined ? { balance: numeric(record.balance) } : {}) };
}

function products(value: unknown, kind: CheapBuddyProduct["kind"]): CheapBuddyProduct[] {
  return items(value).flatMap((entry) => {
    const record = object(entry);
    const productId = id(record.id);
    const name = string(record.name);
    const amount = numeric(kind === "recharge" ? record.amount : record.price);
    if (productId === undefined || !name || record.enabled === false || kind === "membership" && record.for_sale === false || amount !== undefined && amount < 0) return [];
    const duration = numeric(record.validity_days) ?? numeric(record.duration_days);
    const declaredUnit = string(record.validity_unit)?.toLowerCase().replace(/s$/u, "");
    const unit = declaredUnit === "month" ? "months" : declaredUnit === "week" ? "weeks" : "days";
    const period = string(record.period) ?? (duration !== undefined ? `${duration} ${unit}` : undefined);
    return [{ id: String(productId), kind, name, ...(amount !== undefined ? { amount } : {}), ...(string(record.currency) ? { currency: string(record.currency) } : {}), ...(string(record.description) ? { description: string(record.description) } : {}), ...(period ? { period } : {}) }];
  });
}

function memberships(value: unknown): CheapBuddyAccountState["memberships"] {
  return items(value).flatMap((entry) => {
    const record = object(entry);
    const subscriptionId = id(record.id);
    if (subscriptionId === undefined) return [];
    const group = object(record.group);
    const plan = object(record.plan);
    const expiresAt = string(record.expires_at) ?? string(record.end_date) ?? string(record.expiresAt);
    return [{ id: String(subscriptionId), name: string(record.name) ?? string(plan.name) ?? string(group.name) ?? "Membership", ...(expiresAt ? { expiresAt } : {}) }];
  });
}

/** Existing account APIs, one managed key and one protected record per desktop installation. */
export class CheapBuddyAccountService {
  readonly credentialRef: string;
  readonly managedKeyName: string;
  private readonly store: CredentialStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeout: number;
  private generation = 0;
  private controllers = new Set<AbortController>();
  private record?: SessionRecord;
  private pendingVerification?: string;
  private state: CheapBuddyAccountState = SIGNED_OUT_CHEAPBUDDY_STATE;
  private restored = false;
  private restoreOperation?: Promise<void>;
  private storeQueue: Promise<unknown> = Promise.resolve();
  private refreshOperation?: Promise<CheapBuddyAccountState>;

  constructor(options: {
    readonly store?: CredentialStore;
    readonly fetch?: typeof fetch;
    readonly workspacePath?: string;
    readonly deviceId?: string;
    readonly credentialRef?: string;
    readonly now?: () => Date;
    readonly requestTimeoutMs?: number;
  } = {}) {
    const installation = createHash("sha256").update(options.workspacePath ?? "coworkany-desktop").digest("hex").slice(0, 24);
    this.credentialRef = options.credentialRef ?? `cheapbuddy/account/${installation}`;
    if (!/^cheapbuddy\/account\/[a-zA-Z0-9._-]{1,128}$/u.test(this.credentialRef)) throw new Error("credential_reference_invalid");
    const device = options.deviceId ?? createHash("sha256").update(`${hostname()}/${installation}`).digest("hex").slice(0, 16);
    if (!/^[a-zA-Z0-9._-]{1,80}$/u.test(device)) throw new Error("cheapbuddy_device_id_invalid");
    this.managedKeyName = `Coworkany/${device}`;
    this.store = options.store ?? createCredentialStore();
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeout = options.requestTimeoutMs ?? 20_000;
  }

  async handle(action: CheapBuddyAccountAction, payload: Record<string, unknown> = {}): Promise<CheapBuddyAccountState> {
    await this.restore();
    if (action === "status") return this.state;
    if (action === "login") return this.login(payload);
    if (action === "verify") return this.verify(payload);
    if (action === "logout") return this.logout();
    if (action === "refresh") {
      if (!this.record) return this.state;
      if (this.refreshOperation) return this.refreshOperation;
      const operation = this.refresh(this.generation);
      this.refreshOperation = operation;
      try { return await operation; } finally { if (this.refreshOperation === operation) this.refreshOperation = undefined; }
    }
    throw new Error("cheapbuddy_action_invalid");
  }

  async resolveApiKey(reference: string): Promise<string | undefined> {
    if (reference !== this.credentialRef) return undefined;
    await this.restore();
    return this.record?.apiKey;
  }

  private async restore(): Promise<void> {
    if (this.restoreOperation) return this.restoreOperation;
    if (this.restored) return;
    const operation = this.restoreSaved();
    this.restoreOperation = operation;
    try { await operation; } finally { this.restoreOperation = undefined; }
  }

  private async restoreSaved(): Promise<void> {
    this.restored = true;
    const generation = this.generation;
    let saved: string | undefined;
    try { saved = await this.store.get(this.credentialRef); } catch { return; }
    if (generation !== this.generation || !saved) return;
    try {
      const parsed = object(JSON.parse(saved));
      const accessToken = string(parsed.accessToken);
      const savedState = object(parsed.state);
      const savedAccount = account(savedState.account);
      if (parsed.version !== 1 || !accessToken || !savedAccount) return;
      // Rebuild from an allowlist, even for locally stored JSON. No token can enter the UI DTO.
      const provider = this.safeProvider(savedState.provider);
      const restoredStatus = savedState.status === "session_expired" ? "session_expired" : provider?.model && string(parsed.apiKey) ? "connected" : "no_models";
      this.state = { status: restoredStatus, persistent: true, account: savedAccount, products: [...products(items(savedState.products).filter((p) => object(p).kind === "recharge"), "recharge"), ...products(items(savedState.products).filter((p) => object(p).kind === "membership").map((p) => ({ ...object(p), price: object(p).amount })), "membership")], rechargeCatalogAvailable: savedState.rechargeCatalogAvailable === true, memberships: memberships(savedState.memberships), ...(provider ? { provider } : {}), ...(string(savedState.updatedAt) ? { updatedAt: string(savedState.updatedAt) } : {}), ...(restoredStatus === "session_expired" ? { warning: "cheapbuddy_session_expired" } : {}) };
      this.record = { version: 1, accessToken, ...(string(parsed.refreshToken) ? { refreshToken: string(parsed.refreshToken) } : {}), ...(string(parsed.apiKey) ? { apiKey: string(parsed.apiKey) } : {}), ...(id(parsed.keyId) !== undefined ? { keyId: id(parsed.keyId) } : {}), accountId: savedAccount.id, state: this.state };
    } catch { /* A damaged OS record is never forwarded to React. */ }
  }

  private safeProvider(value: unknown): DesktopProviderConfig | undefined {
    const record = object(value);
    if (record.credentialRef !== this.credentialRef) return undefined;
    let result: DesktopProviderConfig = { ...createCheapBuddyProvider(), credentialRef: this.credentialRef };
    const capabilities = object(record.capabilityModels);
    for (const capability of ["text", "image", "video"] as const) {
      const selection = object(capabilities[capability]);
      const modelList = Array.isArray(selection.models) ? selection.models.filter((item): item is string => typeof item === "string").slice(0, 2000) : [];
      result = setProviderCapabilityModels(result, capability, modelList, string(selection.model));
    }
    return result;
  }

  private invalidate(): number {
    this.generation += 1;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.pendingVerification = undefined;
    this.record = undefined;
    this.state = SIGNED_OUT_CHEAPBUDDY_STATE;
    this.refreshOperation = undefined;
    return this.generation;
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new Error("cheapbuddy_request_superseded");
  }

  private async save(generation: number): Promise<void> {
    const record = this.record;
    if (!record) return;
    const operation = this.storeQueue.then(async () => {
      this.assertCurrent(generation);
      let persistent = false;
      try { persistent = await this.store.set(this.credentialRef, JSON.stringify({ ...record, state: this.state })); }
      catch { /* Credentials remain in this service only; no plaintext fallback. */ }
      this.assertCurrent(generation);
      this.state = { ...this.state, persistent, ...(!persistent ? { warning: this.state.warning ?? "cheapbuddy_credentials_session_only" } : {}) };
      this.record = { ...record, state: this.state };
    });
    this.storeQueue = operation.catch(() => {});
    await operation;
  }

  private async clearStored(generation: number): Promise<void> {
    const operation = this.storeQueue.then(async () => {
      this.assertCurrent(generation);
      try { await this.store.delete(this.credentialRef); } catch { throw new Error("cheapbuddy_credentials_clear_failed"); }
      this.assertCurrent(generation);
    });
    this.storeQueue = operation.catch(() => {});
    await operation;
  }

  private async request(path: string, generation: number, options: { method?: string; body?: unknown; token?: string; relay?: boolean } = {}): Promise<unknown> {
    this.assertCurrent(generation);
    const controller = new AbortController();
    this.controllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeout);
    try {
      const response = await this.fetchImpl(`${options.relay ? CHEAPBUDDY.apiBaseUrl : CHEAPBUDDY.accountApiBaseUrl}${path}`, { method: options.method ?? "GET", headers: { accept: "application/json", ...(options.body !== undefined ? { "content-type": "application/json" } : {}), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}), signal: controller.signal, redirect: "error" });
      this.assertCurrent(generation);
      const raw = await response.text();
      this.assertCurrent(generation);
      if (raw.length > 8_000_000) throw new AccountApiError(0, "invalid_response");
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new AccountApiError(response.status, "invalid_response"); }
      const envelope = object(value);
      if (!response.ok || typeof envelope.code === "number" && envelope.code !== 0) throw new AccountApiError(response.status);
      return Object.prototype.hasOwnProperty.call(envelope, "data") ? envelope.data : value;
    } catch (error) {
      this.assertCurrent(generation);
      if (error instanceof AccountApiError) throw error;
      throw new AccountApiError(0, timedOut ? "timeout" : "network");
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }

  private async login(payload: JsonObject): Promise<CheapBuddyAccountState> {
    const email = string(payload.email);
    const password = typeof payload.password === "string" ? payload.password : undefined;
    if (!email || !password) throw new Error("cheapbuddy_login_fields_required");
    const generation = this.invalidate();
    await this.clearStored(generation);
    const result = object(await this.request("/auth/login", generation, { method: "POST", body: { email, password, ...(string(payload.turnstileToken) ? { turnstile_token: string(payload.turnstileToken) } : {}) } }));
    if (result.requires_2fa === true) {
      this.pendingVerification = string(result.temp_token);
      if (!this.pendingVerification) throw new Error("cheapbuddy_verification_session_missing");
      this.state = { ...SIGNED_OUT_CHEAPBUDDY_STATE, status: "verification_required" };
      return this.state;
    }
    return this.establish(result, generation);
  }

  private async verify(payload: JsonObject): Promise<CheapBuddyAccountState> {
    const code = string(payload.code);
    if (!this.pendingVerification) throw new Error("cheapbuddy_verification_session_missing");
    if (!code || !/^\d{6}$/u.test(code)) throw new Error("cheapbuddy_verification_code_invalid");
    const generation = this.generation;
    const result = object(await this.request("/auth/login/2fa", generation, { method: "POST", body: { temp_token: this.pendingVerification, totp_code: code } }));
    this.pendingVerification = undefined;
    return this.establish(result, generation);
  }

  private async establish(result: JsonObject, generation: number): Promise<CheapBuddyAccountState> {
    const accessToken = string(result.access_token);
    if (!accessToken) throw new Error("cheapbuddy_session_invalid");
    this.assertCurrent(generation);
    this.record = { version: 1, accessToken, ...(string(result.refresh_token) ? { refreshToken: string(result.refresh_token) } : {}), state: SIGNED_OUT_CHEAPBUDDY_STATE };
    return this.loadAccount(generation);
  }

  private async sessionRequest(path: string, generation: number): Promise<unknown> {
    try { return await this.request(path, generation, { token: this.record?.accessToken }); }
    catch (error) {
      if (!(error instanceof AccountApiError) || error.status !== 401 || !this.record?.refreshToken) throw error;
      await this.rotateSession(generation);
      return this.request(path, generation, { token: this.record?.accessToken });
    }
  }

  private async rotateSession(generation: number): Promise<void> {
    const refreshToken = this.record?.refreshToken;
    if (!refreshToken) throw new AccountApiError(401);
    const result = object(await this.request("/auth/refresh", generation, { method: "POST", body: { refresh_token: refreshToken } }));
    const accessToken = string(result.access_token);
    if (!accessToken || !this.record) throw new Error("cheapbuddy_session_invalid");
    this.record = { ...this.record, accessToken, refreshToken: string(result.refresh_token) ?? refreshToken };
    await this.save(generation);
  }

  private async refresh(generation: number): Promise<CheapBuddyAccountState> {
    try { return await this.loadAccount(generation); }
    catch (error) {
      this.assertCurrent(generation);
      if (error instanceof AccountApiError && error.status === 401) {
        this.state = { ...this.state, status: "session_expired", warning: "cheapbuddy_session_expired" };
        if (this.record) { this.record = { ...this.record, apiKey: undefined, state: this.state }; await this.save(generation); }
        return this.state;
      }
      this.state = { ...this.state, warning: "cheapbuddy_refresh_failed" };
      return this.state;
    }
  }

  private async loadAccount(generation: number): Promise<CheapBuddyAccountState> {
    const identity = account(await this.sessionRequest("/auth/me", generation));
    if (!identity || !this.record) throw new Error("cheapbuddy_account_invalid");
    if (this.record.accountId !== undefined && this.record.accountId !== identity.id) throw new Error("cheapbuddy_account_changed");
    this.record = { ...this.record, accountId: identity.id };
    this.state = { ...this.state, account: identity, warning: undefined };
    let keyError: unknown;
    try {
      const managed = await this.ensureManagedKey(generation);
      this.record = { ...this.record, apiKey: managed.key, keyId: managed.id };
      let provider: DesktopProviderConfig = { ...createCheapBuddyProvider(), credentialRef: this.credentialRef };
      const endpoint = `${CHEAPBUDDY.apiBaseUrl}/models`;
      for (const capability of ["text", "image", "video"] as const) {
        const modelList = normalizeProviderModelsForCapability({ data: managed.models }, { ...provider, capability }, endpoint);
        const previous = this.state.provider?.capabilityModels?.[capability]?.model;
        const preferred = capability === "text" && modelList.includes(CHEAPBUDDY.preferredTextModel) ? CHEAPBUDDY.preferredTextModel : modelList[0];
        provider = setProviderCapabilityModels(provider, capability, modelList, previous ?? preferred);
      }
      this.state = { ...this.state, status: provider.model ? "connected" : "no_models", provider };
    } catch (error) {
      this.assertCurrent(generation);
      keyError = error;
      const transient = error instanceof AccountApiError && (error.reason === "network" || error.reason === "timeout" || error.status >= 500);
      if (!transient && this.record) this.record = { ...this.record, apiKey: undefined };
      this.state = { ...this.state, status: transient && this.state.provider?.model ? "connected" : "no_models", warning: error instanceof Error && /^cheapbuddy_[a-z_]+(?:_\d+)?$/u.test(error.message) ? error.message : "cheapbuddy_key_configuration_failed" };
    }

    // Optional display reads are isolated: a failed catalog must not erase a valid cache.
    const reads = await Promise.allSettled([this.request("/subscriptions/active", generation, { token: this.record.accessToken }), this.request("/payment/checkout-info", generation, { token: this.record.accessToken })]);
    this.assertCurrent(generation);
    if (reads[0].status === "fulfilled") this.state = { ...this.state, memberships: memberships(reads[0].value) };
    if (reads[1].status === "fulfilled") {
      const checkout = object(reads[1].value);
      const rechargeCatalogAvailable = Array.isArray(checkout.recharge_options);
      let plans = Array.isArray(checkout.plans) ? checkout.plans : undefined;
      if (!plans) { try { plans = items(await this.request("/payment/plans", generation, { token: this.record.accessToken })); } catch { /* retain cached memberships */ } }
      this.state = { ...this.state, rechargeCatalogAvailable, products: [...products(checkout.recharge_options, "recharge"), ...(plans ? products(plans, "membership") : this.state.products.filter((product) => product.kind === "membership"))] };
    } else this.state = { ...this.state, warning: this.state.warning ?? "cheapbuddy_catalog_refresh_failed" };
    this.state = { ...this.state, updatedAt: this.now().toISOString() };
    await this.save(generation);
    if (keyError) throw keyError;
    return this.state;
  }

  private async listManagedKeys(generation: number): Promise<JsonObject[]> {
    const matches: JsonObject[] = [];
    for (let page = 1; page <= 100; page++) {
      const result = await this.sessionRequest(`/keys?page=${page}&page_size=100`, generation);
      const list = items(result);
      matches.push(...list.map(object).filter((key) => key.name === this.managedKeyName));
      const pagination = object(result);
      const total = numeric(pagination.total);
      const pages = numeric(pagination.pages);
      if (pages !== undefined && page >= pages || total !== undefined && page * 100 >= total || list.length < 100) return matches;
    }
    throw new Error("cheapbuddy_key_list_too_large");
  }

  private fullKey(record: JsonObject): string | undefined {
    const value = string(record.key);
    return value && !/[*.…]/u.test(value) && value.length >= 8 ? value : undefined;
  }

  private async ensureManagedKey(generation: number): Promise<{ key: string; id: string | number; models: unknown[] }> {
    const candidates = await this.listManagedKeys(generation);
    const existing = candidates.find((key) => (key.status === "active" || key.status === undefined) && (!string(key.expires_at) || Date.parse(String(key.expires_at)) > this.now().getTime()));
    let key = existing;
    if (key && !this.fullKey(key)) throw new Error("cheapbuddy_managed_key_unavailable");
    if (!key) key = await this.createManagedKey(generation);
    const keyId = id(key.id);
    const value = this.fullKey(key);
    if (keyId === undefined || !value) throw new Error("cheapbuddy_managed_key_unavailable");
    try { return { key: value, id: keyId, models: items(await this.request("/models", generation, { token: value, relay: true })) }; }
    catch (error) {
      this.assertCurrent(generation);
      // Compatibility only for the verified group-less creation defect. Never replace a bound key on a network outage.
      if (key.group_id !== null && key.group_id !== undefined || !(error instanceof AccountApiError) || ![400, 401, 403, 502].includes(error.status)) throw error;
      await this.request(`/keys/${encodeURIComponent(String(keyId))}`, generation, { method: "DELETE", token: this.record?.accessToken });
      const groups = items(await this.sessionRequest("/groups/available", generation)).map(object).filter((group) => group.platform === "openai" && group.status === "active" && group.is_exclusive === false && (group.subscription_type === undefined || group.subscription_type === null || group.subscription_type === "standard") && id(group.id) !== undefined);
      if (groups.length !== 1) throw new Error(groups.length ? "cheapbuddy_group_selection_ambiguous" : "cheapbuddy_compatible_group_unavailable", { cause: error });
      const fallback = await this.createManagedKey(generation, id(groups[0].id));
      const fallbackKey = this.fullKey(fallback);
      const fallbackId = id(fallback.id);
      if (!fallbackKey || fallbackId === undefined) throw new Error("cheapbuddy_managed_key_unavailable", { cause: error });
      try { return { key: fallbackKey, id: fallbackId, models: items(await this.request("/models", generation, { token: fallbackKey, relay: true })) }; }
      catch (failure) {
        this.assertCurrent(generation);
        await this.request(`/keys/${encodeURIComponent(String(fallbackId))}`, generation, { method: "DELETE", token: this.record?.accessToken });
        throw failure;
      }
    }
  }

  private async createManagedKey(generation: number, groupId?: number | string): Promise<JsonObject> {
    try { return object(await this.request("/keys", generation, { method: "POST", token: this.record?.accessToken, body: { name: this.managedKeyName, ...(groupId !== undefined ? { group_id: groupId } : {}) } })); }
    catch (error) {
      if (!(error instanceof AccountApiError) || !["timeout", "network"].includes(error.reason)) throw error;
      // The server may have committed a timed-out POST. Recover by stable name before permitting another create.
      const recovered = (await this.listManagedKeys(generation)).find((key) => key.status === "active" || key.status === undefined);
      if (recovered) return recovered;
      throw new Error("cheapbuddy_key_creation_uncertain", { cause: error });
    }
  }

  private async logout(): Promise<CheapBuddyAccountState> {
    const session = this.record;
    const generation = this.invalidate();
    await this.clearStored(generation);
    if (session?.refreshToken) {
      try { await this.request("/auth/logout", generation, { method: "POST", token: session.accessToken, body: { refresh_token: session.refreshToken } }); }
      catch { this.assertCurrent(generation); this.state = { ...this.state, warning: "cheapbuddy_remote_logout_failed" }; }
    }
    return this.state;
  }
}
