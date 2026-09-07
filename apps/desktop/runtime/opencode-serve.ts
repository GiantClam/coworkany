import { randomBytes, randomInt } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createOpenCodeServeEventState, createOpenCodeServePromptPayload, createOpenCodeServeSessionPayload, normalizeOpenCodeServeEvent, openCodeServePermissionPath, openCodeServeSessionPath, openCodeServeSessionStatusPath, openCodeServeSessionsPath, readOpenCodeServeSessionId, type OpenCodeRuntimeEvent, type OpenCodeServeEventState, type OpenCodeQuestionRequest } from "@coworkany/runtime-contracts/opencode";

type Provider = { readonly id?: string; readonly model?: string; readonly apiKey?: string; readonly reasoningEffort?: string };
type EventSink = (event: OpenCodeRuntimeEvent) => void;
type ActiveRun = {
  readonly runId: string;
  readonly sessionId: string;
  readonly sink: EventSink;
  readonly serveEvents: OpenCodeServeEventState;
  readonly messageIds: Set<string>;
  readonly completion: Promise<void>;
  readonly resolveCompletion: () => void;
  readonly turnStartedAt: number;
  readonly submittedMessageId: string;
  userMessageId?: string;
  readonly userMessageIds: Set<string>;
  readonly ignoredMessageIds: Set<string>;
  readonly questionIds: Set<string>;
  onAccepted?: () => void;
  readonly pendingFrames: Map<string, string[]>;
  promptSubmitted: boolean;
  assistantMessageSeen: boolean;
  assistantFinalMessageSeen: boolean;
  lastAssistantFinish?: string;
  lastMessagePollAt: number;
  busySeen: boolean;
  idleSeen?: boolean;
  streamInterrupted?: boolean;
  activitySeen: boolean;
  completed: boolean;
  failed?: string;
};

function runtimeEnvironmentSignature(environment: Record<string, string | undefined>) {
  const relevant = Object.entries(environment)
    .filter(([key]) => key === "COWORKANY_SKILL_CATALOG_REVISION" || key === "OPENCODE_CONFIG_CONTENT" || key === "OPENCODE_CONFIG_DIR" || key === "HOME" || key === "USERPROFILE" || key.startsWith("XDG_") || key.endsWith("_API_KEY"))
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(relevant);
}

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" ? value as Record<string, unknown> : null; }
function stringValue(...values: unknown[]) { return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? ""; }
// eslint-disable-next-line no-control-regex -- remove control bytes from diagnostic text
function safe(value: unknown) { return stringValue(value).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1024); }
function modelParts(model: string | undefined) { const separator = model?.indexOf("/") ?? -1; return separator > 0 ? { providerID: model!.slice(0, separator), modelID: model!.slice(separator + 1) } : undefined; }
function deepSeekVariant(model: string | undefined, reasoningEffort: string | undefined) {
  if (model !== "deepseek-v4-flash") return undefined;
  const normalized = reasoningEffort?.trim().toLowerCase();
  if (normalized === "none") return "none";
  if (normalized === "low" || normalized === "high") return normalized;
  return "max";
}

function statusType(value: unknown) {
  if (typeof value === "string") return value;
  return record(value)?.type;
}

async function terminateProcessTree(child: ChildProcess) {
  if (child.exitCode !== null) return;
  if (!child.pid) {
    child.kill();
    return;
  }
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); }
    catch { child.kill(); }
    return;
  }
  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("close", () => resolve());
    killer.once("error", () => resolve());
  });
  if (child.exitCode === null) child.kill();
}

export class OpenCodeServeClient {
  private child: ChildProcess | undefined;
  private port = 0;
  private username = "";
  private password = "";
  private baseUrl = "";
  private stopping = false;
  private streamAbort: AbortController | undefined;
  private startPromise: Promise<void> | undefined;
  private runtimeEnvironment: Record<string, string | undefined> = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  private runtimeEnvironmentSignature = "";
  private runtimeWorkspace = "";
  private readonly active = new Map<string, ActiveRun>();
  private readonly selectedSkills = new Map<string, string>();
  // OpenCode Serve can be healthy before its session repository is ready for
  // concurrent POSTs. Serialize only the control-plane session handshake;
  // prompts remain fully concurrent once their session IDs exist.
  private sessionCreateQueue: Promise<void> = Promise.resolve();

  /** Extra arguments make the supervised executable testable without changing production invocation. */
  constructor(private readonly executable: string, private readonly runtimeDirectory: string, private readonly executableArgs: readonly string[] = [], private readonly promptTimeoutMs?: number) {}

  private auth() { return `Basic ${Buffer.from(`${this.username}:${this.password}`, "utf8").toString("base64")}`; }

  private async request(path: string, init: RequestInit = {}, timeoutMs: number | false = 30_000, externalSignal?: AbortSignal) {
    // Long-running prompt requests must remain under OpenCode's own provider
    // and chunk timeout settings. The optional timeout is only for bounded
    // control-plane calls and explicit test coverage.
    const controller = typeof timeoutMs === "number" ? new AbortController() : undefined;
    const forwardAbort = () => controller?.abort();
    if (externalSignal?.aborted) controller?.abort();
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    let timedOut = false;
    const timer = typeof timeoutMs === "number" ? setTimeout(() => { timedOut = true; controller?.abort(); }, timeoutMs) : undefined;
    try {
      const signal = controller?.signal ?? externalSignal ?? init.signal;
      return await fetch(`${this.baseUrl}${path}`, { ...init, headers: { accept: "application/json", authorization: this.auth(), ...(init.headers ?? {}) }, ...(signal ? { signal } : {}) });
    } catch (error) {
      if (timedOut) throw new Error(`opencode_request_timeout:${timeoutMs}`, { cause: error });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener("abort", forwardAbort);
    }
  }

  async ensureStarted(workspacePath: string, environment: Record<string, string | undefined>) {
    // OpenCode loads OPENCODE_CONFIG_CONTENT and provider credentials only at
    // process start. Reuse the process while its effective config is stable,
    // but restart it before a turn that selects a different model/provider.
    const requestedSignature = runtimeEnvironmentSignature(environment);
    if (this.child && this.child.exitCode === null && this.runtimeWorkspace === workspacePath && this.runtimeEnvironmentSignature === requestedSignature) return;
    if (this.startPromise) {
      await this.startPromise;
      if (this.child && this.child.exitCode === null && this.runtimeWorkspace === workspacePath && this.runtimeEnvironmentSignature === requestedSignature) return;
    }
    if (this.child && this.child.exitCode === null) await this.stop();
    const startPromise = this.startServe(workspacePath, environment);
    this.startPromise = startPromise;
    try { await startPromise; }
    finally { if (this.startPromise === startPromise) this.startPromise = undefined; }
  }

  private async startServe(workspacePath: string, environment: Record<string, string | undefined>) {
    await mkdir(this.runtimeDirectory, { recursive: true });
    this.port = await this.findFreePort();
    this.username = `coworkany-${randomBytes(8).toString("hex")}`;
    this.password = randomBytes(32).toString("base64url");
    this.baseUrl = `http://127.0.0.1:${this.port}`;
    // Keep the supervised runtime independent from the user's OpenCode
    // installation. The host supplies the desktop config content, while
    // these guards prevent project/global skill and plugin discovery from
    // reintroducing user-level entries such as superpowers.
    const isolatedEnvironment = {
      ...environment,
      NODE_ENV: environment.NODE_ENV ?? process.env.NODE_ENV ?? "production",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    };
    this.runtimeEnvironment = isolatedEnvironment;
    this.runtimeEnvironmentSignature = runtimeEnvironmentSignature(isolatedEnvironment);
    this.runtimeWorkspace = workspacePath;
    this.stopping = false;
    // The desktop host is the explicit authority boundary for this local
    // runtime. Permissions are supplied through OPENCODE_CONFIG_CONTENT;
    // this bundled OpenCode version does not support `--auto` on `serve`.
    const child = spawn(this.executable, [...this.executableArgs, "serve", "--pure", "--hostname", "127.0.0.1", "--port", String(this.port), "--print-logs", "--log-level", "INFO"], {
      cwd: workspacePath,
      env: { ...isolatedEnvironment, OPENCODE_SERVER_USERNAME: this.username, OPENCODE_SERVER_PASSWORD: this.password, OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true" } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    }) as ChildProcess;
    this.child = child;
    child.stderr?.on("data", (chunk: Buffer) => {
      const diagnostic = chunk.toString("utf8");
      process.stderr.write(`[opencode-serve] ${diagnostic.slice(-2048)}`);
    });
    child.once("close", () => { this.streamAbort?.abort(); this.streamAbort = undefined; if (!this.stopping) for (const active of this.active.values()) this.reportServeExit(active); });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try { const response = await this.request("/global/health", {}, 2_000); if (response.ok) { this.startEventStream(workspacePath); return; } } catch { /* retry until the bounded deadline */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("opencode_serve_health_timeout");
  }

  async createOrResumeSession(workspacePath: string, requestedId: string | undefined, provider: Provider, environment: Record<string, string | undefined>) {
    await this.ensureStarted(workspacePath, environment);
    const previous = this.sessionCreateQueue;
    let release: (() => void) | undefined;
    this.sessionCreateQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      if (requestedId) {
        const existing = await this.request(openCodeServeSessionPath(requestedId, workspacePath, "message")).catch((error) => {
          throw new Error(`opencode_session_lookup_failed:${error instanceof Error ? error.message : String(error)}`);
        });
        if (existing.ok) return { sessionId: requestedId, recovered: false };
        if (existing.status !== 404) throw new Error(`opencode_session_lookup_failed:${existing.status}`);
      }
      const model = modelParts(provider.model);
      const body = createOpenCodeServeSessionPayload({ title: "CoworkAny Desktop", ...(model ? { providerId: model.providerID, modelId: model.modelID } : {}) });
      const response = await this.request(openCodeServeSessionsPath(workspacePath), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 30_000);
      const payload = await response.json().catch(() => null);
      const id = readOpenCodeServeSessionId(payload);
      if (!response.ok || !id) {
        const detail = safe(payload?.message ?? payload?.error ?? payload?.detail ?? (payload ? JSON.stringify(payload) : ""));
        throw new Error(`opencode_session_create_failed:${detail || response.statusText}`);
      }
      return { sessionId: id, recovered: Boolean(requestedId) };
    } finally {
      release?.();
    }
  }

  async attachSession(workspacePath: string, requestedId: string, _provider: Provider, environment: Record<string, string | undefined>) {
    await this.ensureStarted(workspacePath, environment);
    const previous = this.sessionCreateQueue;
    let release: (() => void) | undefined;
    this.sessionCreateQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const response = await this.request(openCodeServeSessionPath(requestedId, workspacePath, "message")).catch((error) => {
        throw new Error(`opencode_session_attach_failed:${error instanceof Error ? error.message : String(error)}`);
      });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`opencode_session_attach_failed:${response.status}`);
      return { sessionId: requestedId };
    } finally {
      release?.();
    }
  }

  async prompt(sessionId: string, workspacePath: string, runId: string, prompt: string, provider: Provider, sink: EventSink, signal?: AbortSignal, agent?: string, beforeDone?: () => Promise<void>, skillId?: string) {
    await this.ensureStarted(workspacePath, this.runtimeEnvironment);
    if ([...this.active.values()].some(run => run.sessionId === sessionId)) {
      sink({ event: "runtime_error", code: "opencode_session_busy", message: "This OpenCode session is already running.", retryable: true, runId });
      return;
    }
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    const model = modelParts(provider.model);
    const turnStartedAt = Date.now();
    // Native message IDs use a 48-bit timestamp/counter prefix and a random
    // suffix. Supplying one ties the persisted user to this request even when
    // the server's wall clock is a millisecond behind the desktop's.
    const submittedMessageId = `msg_${(BigInt(turnStartedAt) * BigInt(0x1000) + BigInt(1)).toString(16).slice(-12).padStart(12, "0")}${randomBytes(7).toString("hex")}`;
    const active: ActiveRun = { runId, sessionId, sink, serveEvents: createOpenCodeServeEventState(), messageIds: new Set(), userMessageIds: new Set(), ignoredMessageIds: new Set(), questionIds: new Set(), pendingFrames: new Map(), completion, resolveCompletion, turnStartedAt, submittedMessageId, promptSubmitted: false, assistantMessageSeen: false, assistantFinalMessageSeen: false, lastMessagePollAt: 0, busySeen: false, activitySeen: false, completed: false };
    this.active.set(runId, active);
    const abort = () => { void this.abort(sessionId); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new Error("opencode_aborted");
      const selectedSkill = skillId?.trim() && skillId !== "auto" ? skillId.trim() : undefined;
      const useCommand = selectedSkill && this.selectedSkills.get(sessionId) !== selectedSkill;
      active.onAccepted = () => {
        if (selectedSkill) this.selectedSkills.set(sessionId, selectedSkill);
        else this.selectedSkills.delete(sessionId);
      };
      if (useCommand) {
        const commandsResponse = await this.request(`/command?directory=${encodeURIComponent(workspacePath)}`, {}, 30_000, signal);
        const commands = await commandsResponse.json();
        if (!commandsResponse.ok || !Array.isArray(commands) || !commands.some(item => item.name === selectedSkill && item.source === "skill")) throw new Error(`opencode_skill_unavailable:${selectedSkill}`);
      }
      const variant = model?.modelID === "deepseek-v4-flash" ? deepSeekVariant(model.modelID, provider.reasoningEffort) : undefined;
      const body = useCommand
        ? { command: selectedSkill, arguments: prompt, ...(agent ? { agent } : {}), ...(model ? { model: `${model.providerID}/${model.modelID}` } : {}), ...(variant ? { variant } : {}) }
        : createOpenCodeServePromptPayload({ prompt, ...(model ? { providerId: model.providerID, modelId: model.modelID } : {}), ...(variant ? { variant } : {}), ...(agent ? { agent } : {}) });
      // Native command requests can stay open for the whole Skill. Ordinary
      // prompts use prompt_async. Neither path imposes a task timeout.
      active.promptSubmitted = true;
      const completionWait = this.waitForCompletion(active, workspacePath, signal);
      const promptSubmission = this.request(openCodeServeSessionPath(sessionId, workspacePath, useCommand ? "command" : "prompt_async"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, messageID: submittedMessageId }),
      }, this.promptTimeoutMs ?? false, signal)
        .then((response) => ({ kind: "response" as const, response }))
        .catch((error) => ({ kind: "error" as const, error }));
      const first = await Promise.race([
        promptSubmission,
        completionWait.then(() => ({ kind: "completed" as const })),
      ]);
      if (first.kind === "error") throw first.error;
      if (first.kind === "response" && !first.response.ok && first.response.status !== 204) {
        const detail = safe(await first.response.text().catch(() => ""));
        throw new Error(`opencode_prompt_failed_${first.response.status}${detail ? `:${detail}` : ""}`);
      }
      if (first.kind === "response") active.onAccepted?.();
      if (signal?.aborted) throw new Error("opencode_aborted");
      if (active.failed) throw new Error(active.failed);
      await completionWait;
      if (active.failed) throw new Error(active.failed);
      await beforeDone?.();
      if (signal?.aborted) throw new Error("opencode_aborted");
      if (active.failed) throw new Error(active.failed);
      sink({ event: "done", runId });
    } catch (error) {
      // A Skill can finish writing a usable artifact just before OpenCode
      // reports a failed turn (for example, after a late preview check). Give
      // the host one last chance to attach files, without masking the original
      // runtime error or emitting process details as assistant content.
      try { await beforeDone?.(); } catch { /* preserve the original failure */ }
      const timedOut = error instanceof Error && error.message.startsWith("opencode_request_timeout:");
      if (timedOut) {
        const message = "Text provider request timed out. Check the Provider base URL, API key, or select another model.";
        active.failed = message;
        sink({ event: "runtime_error", code: "opencode_prompt_timeout", message, retryable: true, runId });
        void this.abort(sessionId);
        return;
      }
      if (!active.failed && error instanceof TypeError) await new Promise((resolve) => setTimeout(resolve, 100));
      if (!active.failed && this.child?.exitCode !== null) this.reportServeExit(active);
      if (active.failed) return;
      sink({ event: "runtime_error", code: signal?.aborted ? "opencode_aborted" : "opencode_prompt_failed", message: safe(error instanceof Error ? error.message : error), retryable: !signal?.aborted, runId });
    } finally { this.complete(active); signal?.removeEventListener("abort", abort); this.active.delete(runId); }
  }

  private reportServeExit(active: ActiveRun) {
    if (active.failed) return;
    active.failed = "OpenCode serve exited before the turn completed.";
    active.sink({ event: "runtime_error", code: "opencode_serve_exited", message: active.failed, retryable: true, runId: active.runId });
    this.complete(active);
  }

  async abort(sessionId: string) { await this.request(openCodeServeSessionPath(sessionId, this.runtimeWorkspace, "abort"), { method: "POST" }, 2_000).catch(() => undefined); }

  async replyPermission(sessionId: string, permissionId: string, response: "once" | "always" | "reject", workspacePath: string) {
    const result = await this.request(openCodeServePermissionPath(sessionId, permissionId, workspacePath), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response }),
    }, 30_000);
    if (!result.ok) {
      const detail = safe(await result.text().catch(() => ""));
      throw new Error(`opencode_permission_reply_failed_${result.status}${detail ? `:${detail}` : ""}`);
    }
  }

  async listQuestions(sessionId: string, workspacePath: string): Promise<OpenCodeQuestionRequest[]> {
    if (this.child && this.child.exitCode !== null) await this.ensureStarted(workspacePath, this.runtimeEnvironment);
    const response = await this.request(`/question?directory=${encodeURIComponent(workspacePath)}`);
    if (!response.ok) throw new Error(`opencode_questions_failed_${response.status}`);
    const questions = await response.json();
    return Array.isArray(questions) ? questions.filter((item): item is OpenCodeQuestionRequest => item?.sessionID === sessionId && typeof item.id === "string" && Array.isArray(item.questions)) : [];
  }

  async replyQuestion(sessionId: string, requestId: string, answers: string[][] | undefined, workspacePath: string) {
    const pending = await this.listQuestions(sessionId, workspacePath);
    if (!pending.some(question => question.id === requestId)) throw new Error("opencode_question_not_found");
    const operation = answers === undefined ? "reject" : "reply";
    const response = await this.request(`/question/${encodeURIComponent(requestId)}/${operation}?directory=${encodeURIComponent(workspacePath)}`, {
      method: "POST", headers: { "content-type": "application/json" }, ...(answers === undefined ? {} : { body: JSON.stringify({ answers }) }),
    });
    if (!response.ok) throw new Error(`opencode_question_reply_failed_${response.status}`);
  }

  async cancelRun(runId: string) {
    const active = this.active.get(runId);
    if (!active) return false;
    if (!active.failed) {
      active.failed = "OpenCode run cancelled.";
      active.sink({ event: "runtime_error", code: "opencode_aborted", message: active.failed, retryable: false, runId });
    }
    this.complete(active);
    // The prompt request is cancelled by the per-run AbortSignal owned by the
    // host. Do not wait for OpenCode's abort endpoint here: older Serve builds
    // can keep that control-plane request open while the model is unwinding.
    void this.abort(active.sessionId);
    return true;
  }

  async stop() {
    this.stopping = true;
    this.streamAbort?.abort();
    for (const active of this.active.values()) {
      active.failed = "OpenCode serve stopped.";
      active.sink({ event: "runtime_error", code: "opencode_serve_stopped", message: active.failed, retryable: true, runId: active.runId });
      this.complete(active);
    }
    this.active.clear();
    this.selectedSkills.clear();
    const child = this.child;
    this.child = undefined;
    this.runtimeWorkspace = "";
    this.runtimeEnvironmentSignature = "";
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        child.once("close", () => { clearTimeout(timer); resolve(); });
        void terminateProcessTree(child);
      });
    }
  }

  private complete(active: ActiveRun) {
    if (active.completed) return;
    active.completed = true;
    active.resolveCompletion();
  }

  private async waitForCompletion(active: ActiveRun, workspacePath: string, signal?: AbortSignal) {
    const pollController = new AbortController();
    const abortPoll = () => pollController.abort();
    signal?.addEventListener("abort", abortPoll, { once: true });
    try {
      await Promise.race([active.completion, this.pollSessionStatus(active, workspacePath, pollController.signal)]);
    } finally {
      pollController.abort();
      signal?.removeEventListener("abort", abortPoll);
    }
  }

  private async pollSessionStatus(active: ActiveRun, workspacePath: string, signal: AbortSignal) {
    while (!active.completed && !active.failed && !signal.aborted) {
      let idle = Boolean(active.idleSeen);
      try {
        const response = await this.request(openCodeServeSessionStatusPath(workspacePath), {}, 2_000, signal);
        if (response.ok) {
          const payload = await response.json().catch(() => null);
          const sessions = record(payload);
          const session = sessions?.[active.sessionId];
          const type = statusType(session);
          if (type === "busy") { active.busySeen = true; active.idleSeen = false; idle = false; }
          if ((type === "idle" || session === undefined) && active.promptSubmitted) {
            idle = true;
          }
        }
      } catch {
        if (signal.aborted) return;
      }
      // Only reconcile text after OpenCode is idle. A busy snapshot can be
      // ahead of queued SSE deltas, whose protocol has no replay offset.
      if (Date.now() - active.lastMessagePollAt >= 1_000) {
        active.lastMessagePollAt = Date.now();
        try {
          if (idle) await this.reconcileCompletedMessage(active, workspacePath, signal, true);
          if (!active.completed) await this.restoreQuestions(active, workspacePath);
        } catch { if (signal.aborted) return; }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private async reconcileCompletedMessage(active: ActiveRun, workspacePath: string, signal: AbortSignal, idle: boolean) {
    if (!idle) return;
    const response = await this.request(openCodeServeSessionPath(active.sessionId, workspacePath, "message"), {}, 2_000, signal);
    if (!response.ok) return;
    const payload = await response.json().catch(() => null);
    const payloadRecord = record(payload);
    const messages: unknown[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payloadRecord?.messages)
        ? payloadRecord.messages
        : [];
    // Replay authoritative snapshots after reconnect. Parent IDs establish
    // ownership; a completed tool step is not a completed user turn.
    for (const entry of messages) {
      const message = record(record(entry)?.info) ?? record(entry);
      if (!message) continue;
      this.handleEvent(`data: ${JSON.stringify({ type: "message.updated", properties: { sessionID: active.sessionId, info: message } })}`, true);
      const parts = record(entry)?.parts;
      if (Array.isArray(parts)) for (const part of parts) this.handleEvent(`data: ${JSON.stringify({ type: "message.part.updated", properties: { sessionID: active.sessionId, part } })}`, true);
    }
    if (idle && active.assistantFinalMessageSeen) this.complete(active);
  }

  private async restoreQuestions(active: ActiveRun, workspacePath: string) {
    const pending = await this.listQuestions(active.sessionId, workspacePath);
    if (active.completed || active.failed) return;
    for (const question of pending) {
      if (active.questionIds.has(question.id)) continue;
      this.handleEvent(`data: ${JSON.stringify({ type: "question.asked", properties: question })}`);
    }
  }

  private async findFreePort() {
    const { createServer } = await import("node:net");
    return await new Promise<number>((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : randomInt(40_000, 60_000); server.close((error) => error ? reject(error) : resolve(port)); }); });
  }

  private startEventStream(workspacePath: string) {
    if (this.streamAbort) return;
    this.streamAbort = new AbortController();
    void (async () => {
      while (!this.stopping && this.streamAbort) {
        try {
          const response = await fetch(`${this.baseUrl}/event?directory=${encodeURIComponent(workspacePath)}`, { headers: { accept: "text/event-stream", authorization: this.auth() }, signal: this.streamAbort.signal });
          if (!response.ok || !response.body) throw new Error(`opencode_event_http_${response.status}`);
          const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
          while (!this.stopping) {
            const next = await reader.read(); if (next.done) break;
            buffer += decoder.decode(next.value, { stream: true });
            // SSE servers commonly use CRLF, while the test fixture and some
            // proxies use LF. Accept either separator so events are dispatched
            // as soon as a complete frame arrives.
            while (true) {
              const lfBoundary = buffer.indexOf("\n\n");
              const crlfBoundary = buffer.indexOf("\r\n\r\n");
              const useCrlf = crlfBoundary >= 0 && (lfBoundary < 0 || crlfBoundary < lfBoundary);
              const boundary = useCrlf ? crlfBoundary : lfBoundary;
              if (boundary < 0) break;
              const separatorLength = useCrlf ? 4 : 2;
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + separatorLength);
              this.handleEvent(frame);
            }
          }
        } catch { /* reconnect; do not synthesize model input */ }
        // SSE deltas have no resume offset. Keep the last contiguous text
        // prefix when disconnected, then recover from the final snapshot.
        for (const active of this.active.values()) active.streamInterrupted = true;
        if (!this.stopping) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    })();
  }

  private handleEvent(frame: string, snapshot = false) {
    const data = frame.split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    let payload: unknown; try { payload = JSON.parse(data); } catch { return; }
    const routing = normalizeOpenCodeServeEvent("pending", payload, createOpenCodeServeEventState());
    const sessionId = routing.sessionId;
    if (!sessionId) return;
    const sessionRuns = [...this.active.values()].filter((item) => item.sessionId === sessionId && !item.failed && !item.completed);
    if (routing.sessionStatus === "busy") {
      for (const item of sessionRuns) { item.busySeen = true; item.activitySeen = true; item.idleSeen = false; }
    }
    if (routing.sessionIdle) for (const item of sessionRuns) item.idleSeen = true;
    // Idle is a trigger for the poller's final snapshot, not permission to
    // finish before any text missed during disconnection has been recovered.
    const active = sessionRuns.length === 1 ? sessionRuns[0] : undefined;
    if (!active) return;
    const raw = record(payload);
    const properties = record(raw?.properties);
    const info = record(properties?.info);
    const questionEvent = typeof raw?.type === "string" && raw.type.startsWith("question.");
    if (questionEvent) {
      if (raw?.type === "question.asked") {
        const requestId = stringValue(properties?.id);
        if (active.questionIds.has(requestId)) return;
        active.questionIds.add(requestId);
      }
      for (const event of normalizeOpenCodeServeEvent(active.runId, payload, active.serveEvents).events) active.sink(event);
      return;
    }
    const part = record(properties?.part);
    if (active.streamInterrupted && !snapshot && (part?.type === "text" || part?.type === "reasoning" || raw?.type === "message.part.delta")) return;
    if (routing.messageRole === "user") {
      if (routing.messageId && (routing.messageId === active.submittedMessageId || (routing.messageCreated !== undefined && routing.messageCreated >= active.turnStartedAt))) {
        // OpenCode may create compaction/replay users within this exclusive
        // session turn. They are native history, never extra desktop prompts.
        if (!active.userMessageId) { active.userMessageId = routing.messageId; active.onAccepted?.(); }
        if (!active.userMessageIds.has(routing.messageId)) active.assistantFinalMessageSeen = false;
        active.userMessageIds.add(routing.messageId);
      }
      // Record user roles so echoed parts cannot become assistant text.
      normalizeOpenCodeServeEvent(active.runId, payload, active.serveEvents);
      return;
    }
    if (routing.messageRole === "assistant" && (info?.summary === true || !routing.parentId || !active.userMessageIds.has(routing.parentId))) {
      if (routing.messageId) { active.ignoredMessageIds.add(routing.messageId); active.pendingFrames.delete(routing.messageId); }
      return;
    }
    if (routing.messageRole === "assistant" && routing.messageId) active.ignoredMessageIds.delete(routing.messageId);
    if (routing.messageId && active.ignoredMessageIds.has(routing.messageId)) return;
    if (routing.messageId && !routing.messageRole && !active.messageIds.has(routing.messageId)) {
      if (active.serveEvents.messageRoles.get(routing.messageId) === "user") return;
      const queue = active.pendingFrames.get(routing.messageId) ?? [];
      queue.push(frame);
      active.pendingFrames.set(routing.messageId, queue);
      return;
    }
    const isNewAssistantMessage = routing.messageRole === "assistant" && Boolean(routing.messageId) && !active.messageIds.has(routing.messageId!);
    if (isNewAssistantMessage) active.assistantFinalMessageSeen = false;
    // A single desktop run can contain several OpenCode assistant messages:
    // one reports a tool-call turn and a later one continues after the tool
    // result. The desktop transcript intentionally renders one Message for
    // the run, so preserve that message boundary as a Markdown paragraph
    // break instead of concatenating progress sentences into one paragraph.
    if (isNewAssistantMessage && active.lastAssistantFinish === "tool-calls" && (!active.streamInterrupted || snapshot)) {
      active.sink({ event: "text_delta", delta: "\n\n", runId: active.runId });
    }
    if (routing.messageRole === "assistant") { active.assistantMessageSeen = true; active.activitySeen = true; }
    // Only message.updated events with an explicit role identify a message.
    // session.updated also exposes `info.id` (the session ID), which must not
    // consume the run's empty-message routing slot.
    if (routing.messageId && routing.messageRole && routing.messageRole !== "user") active.messageIds.add(routing.messageId);
    const normalized = normalizeOpenCodeServeEvent(active.runId, payload, active.serveEvents);
    if (normalized.events.length) active.activitySeen = true;
    if (normalized.messageCompleted && normalized.messageFinish) {
      active.lastAssistantFinish = normalized.messageFinish;
      active.assistantFinalMessageSeen = normalized.messageFinish !== "tool-calls";
    } else if (normalized.messageCompleted) {
      active.assistantFinalMessageSeen = true;
    }
    for (const runtimeEvent of normalized.events) active.sink(runtimeEvent);
    if (routing.messageRole === "assistant" && routing.messageId) {
      const queued = active.pendingFrames.get(routing.messageId) ?? [];
      active.pendingFrames.delete(routing.messageId);
      for (const pending of queued) this.handleEvent(pending);
    }
    if (normalized.terminalError) {
      active.failed = normalized.terminalError.message;
      active.sink({ event: "runtime_error", ...normalized.terminalError, runId: active.runId });
      this.complete(active);
    }
  }
}
