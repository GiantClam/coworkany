import type { DesktopPreviewData } from "@coworkany/workbench-client";

export type DesktopPreviewContext = {
  readonly messageId: string;
  readonly conversationId?: string;
  readonly runId?: string;
};

export type DesktopPreviewSession = {
  readonly id: string;
  readonly url: string;
  readonly engine?: DesktopPreviewData["engine"];
  readonly context: DesktopPreviewContext;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Accept only explicit-port HTTP(S) endpoints owned by a local preview runtime. */
export function resolveDesktopLoopbackPreviewUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password || !url.port) return null;
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Dashi's local service uses a self-signed TLS certificate; CoworkAny must load its HTTP loopback listener. */
export function resolveDesktopPreviewRuntimeUrl(preview: Pick<DesktopPreviewData, "url" | "engine">): string | null {
  const resolved = resolveDesktopLoopbackPreviewUrl(preview.url);
  if (!resolved || preview.engine !== "dashi-ppt") return resolved;
  const url = new URL(resolved);
  if (url.protocol !== "https:") return resolved;
  url.protocol = "http:";
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString();
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Pick<Response, "ok">>;

/** Tracks reconnectable local preview sessions without granting arbitrary URL access. */
export class DesktopPreviewSessionRegistry {
  readonly #sessions = new Map<string, DesktopPreviewSession>();
  readonly #fetch: FetchLike;
  readonly #diagnostic: (message: string) => void;

  constructor(fetchImpl: FetchLike = globalThis.fetch.bind(globalThis), diagnostic: (message: string) => void = () => undefined) {
    this.#fetch = fetchImpl;
    this.#diagnostic = diagnostic;
  }

  sessions() {
    return [...this.#sessions.values()];
  }

  async reconnect(preview: DesktopPreviewData, context: DesktopPreviewContext, timeoutMs = 2_500): Promise<string | null> {
    const url = resolveDesktopPreviewRuntimeUrl(preview);
    if (!url) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await this.#fetch(url, { method: "GET", mode: "no-cors", cache: "no-store", signal: controller.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
    const id = preview.previewSessionId ?? `${preview.engine ?? "generic-web"}:${url}`;
    const next = { id, url, engine: preview.engine, context };
    const existing = this.#sessions.get(id);
    const replaced = existing && existing.url !== url ? existing : [...this.#sessions.values()].find((session) => session.id !== id
      && session.engine === next.engine
      && session.context.conversationId
      && session.context.conversationId === next.context.conversationId);
    if (replaced) await this.close(replaced.id, "replaced");
    this.#sessions.set(id, next);
    return url;
  }

  async close(id: string, reason = "closed") {
    const session = this.#sessions.get(id);
    if (!session) return;
    this.#sessions.delete(id);
    const endpoint = new URL("/api/shutdown", session.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    try {
      const response = await this.#fetch(endpoint, {
        method: "POST",
        mode: "no-cors",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: `desktop-${reason}` }),
        signal: controller.signal,
      });
      if (session.engine === "ppt-master" && response.ok === false) this.#diagnostic(`preview_cleanup_failed:${id}`);
      if (session.engine === "dashi-ppt") this.#diagnostic(`preview_cleanup_unconfirmed:${id}`);
    } catch {
      this.#diagnostic(`preview_cleanup_failed:${id}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async closeConversation(conversationId: string) {
    await Promise.all(this.sessions().filter((session) => session.context.conversationId === conversationId).map((session) => this.close(session.id, "conversation-closed")));
  }

  async closeAll() {
    await Promise.all(this.sessions().map((session) => this.close(session.id, "desktop-stopped")));
  }
}
