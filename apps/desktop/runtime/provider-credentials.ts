import { CHEAPBUDDY } from "../src/cheapbuddy";
import type { DesktopProviderConfig } from "../src/provider-config";

export type ProviderCredentialResolver = (reference: string) => Promise<string | undefined>;

/** Resolve only within the Host, and prevent a saved reference from exporting a key to another origin. */
export async function resolveProviderCredentials<T extends DesktopProviderConfig>(provider: T | undefined, resolveKey: ProviderCredentialResolver): Promise<T | undefined> {
  if (!provider?.credentialRef) return provider;
  if (!/^cheapbuddy\/account\/[a-f0-9]{24}$/u.test(provider.credentialRef)) throw new Error("provider_credential_reference_invalid");
  if (provider.id !== CHEAPBUDDY.id || provider.source !== CHEAPBUDDY.id || provider.baseUrl?.replace(/\/$/u, "") !== CHEAPBUDDY.apiBaseUrl) {
    throw new Error("cheapbuddy_provider_address_invalid");
  }
  const key = await resolveKey(provider.credentialRef);
  if (!key) throw new Error("cheapbuddy_sign_in_required");
  return { ...provider, apiKey: key };
}

/** Preserve slash-containing Relay model IDs when OpenCode expects provider/model. */
export function qualifiedOpenCodeModel(provider: DesktopProviderConfig | undefined, modelHint?: string): string | undefined {
  if (provider?.source !== CHEAPBUDDY.id) return modelHint;
  const model = (provider.model || modelHint || "").trim().replace(/^cheapbuddy\//u, "");
  return model ? `${CHEAPBUDDY.id}/${model}` : undefined;
}

/** Transport libraries can truncate echoed keys before Host redaction, so discard upstream detail. */
export function managedProviderFailure(error: unknown, phase: "media" | "download"): Error {
  const message = error instanceof Error ? error.message : "";
  if (["cheapbuddy_request_superseded", "media_cancelled"].includes(message)) return new Error(message);
  const status = /^media_provider_http_(\d{3})(?:[:\s]|$)/u.exec(message)?.[1];
  if (status) return new Error(`cheapbuddy_${phase}_http_${status}`);
  if (message === "media_provider_request_timeout") return new Error(`cheapbuddy_${phase}_timeout`);
  return new Error(`cheapbuddy_${phase}_request_failed`);
}

/** Redact complete stderr lines so a key split across pipe chunks cannot leak. */
export function createRedactedLogWriter(redact: (value: string) => string, output: (value: string) => void) {
  let pending = "";
  let droppingOversizedLine = false;
  const write = (chunk: string) => {
    if (droppingOversizedLine) {
      const newline = chunk.indexOf("\n");
      if (newline < 0) return;
      chunk = chunk.slice(newline + 1);
      droppingOversizedLine = false;
    }
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline + 1);
      pending = pending.slice(newline + 1);
      output(line.length > 64_000 ? "[runtime diagnostic line omitted]\n" : redact(line));
    }
    if (pending.length > 64_000) { pending = ""; droppingOversizedLine = true; }
  };
  return { write, flush() { if (pending) output(redact(pending)); pending = ""; droppingOversizedLine = false; } };
}

/** Account changes invalidate launches synchronously, before any async daemon cleanup. */
export class ManagedProviderRuntime {
  private generation = 0;
  private changingAccount = false;
  private readonly clients = new Set<{ retire(): Promise<void> }>();
  private readonly cancellations = new Set<() => void>();
  private readonly recentKeys: string[] = [];

  snapshot(): number { return this.generation; }

  capture(provider: DesktopProviderConfig | undefined): number | undefined {
    return provider?.credentialRef ? this.generation : undefined;
  }

  current(generation: number | undefined): boolean {
    return generation === undefined || generation === this.generation && !this.changingAccount;
  }

  assertCurrent(generation: number | undefined): void {
    if (!this.current(generation)) throw new Error("cheapbuddy_request_superseded");
  }

  remember(provider: DesktopProviderConfig | undefined): void {
    if (!provider?.credentialRef || !provider.apiKey) return;
    const key = provider.apiKey;
    const previous = this.recentKeys.indexOf(key);
    if (previous >= 0) this.recentKeys.splice(previous, 1);
    this.recentKeys.push(key);
    // Retired processes can still emit their last error. Keep a bounded recent history for redaction.
    if (this.recentKeys.length > 8) this.recentKeys.shift();
  }

  trackClient(client: { retire(): Promise<void> }, generation: number | undefined): void {
    this.assertCurrent(generation);
    if (generation !== undefined) this.clients.add(client);
  }

  trackCancellation(cancel: () => void, generation: number | undefined): () => void {
    this.assertCurrent(generation);
    if (generation !== undefined) this.cancellations.add(cancel);
    return () => { this.cancellations.delete(cancel); };
  }

  async invalidate(): Promise<number> {
    this.generation += 1;
    this.changingAccount = true;
    const generation = this.generation;
    for (const cancel of this.cancellations) { try { cancel(); } catch { /* Continue clearing every managed run. */ } }
    this.cancellations.clear();
    const clients = [...this.clients];
    this.clients.clear();
    await Promise.all(clients.map(async (client) => { await client.retire().catch(() => undefined); }));
    return generation;
  }

  assertAccountChange(generation: number): void {
    if (generation !== this.generation) throw new Error("cheapbuddy_request_superseded");
  }

  finishAccountChange(generation: number): void {
    if (generation === this.generation) this.changingAccount = false;
  }

  redactText(value: string): string {
    let result = value;
    for (const key of this.recentKeys) {
      result = result.split(key).join("[redacted]");
      const encoded = JSON.stringify(key).slice(1, -1);
      if (encoded !== key) result = result.split(encoded).join("[redacted]");
    }
    return result;
  }

  redact<T>(value: T): T {
    if (typeof value === "string") return this.redactText(value) as T;
    if (Array.isArray(value)) return value.map((entry) => this.redact(entry)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, this.redact(entry)])) as T;
    return value;
  }
}
