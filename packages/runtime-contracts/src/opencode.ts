const MAX_LINE_BYTES = 2 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 1024;
const MAX_TOOL_NAME_LENGTH = 80;

export type OpenCodeCommandInput = { readonly modelHint?: string | null };
export type OpenCodeQuestion = { readonly question: string; readonly header: string; readonly options: readonly { readonly label: string; readonly description: string }[]; readonly multiple?: boolean; readonly custom?: boolean };
export type OpenCodeQuestionRequest = { readonly id: string; readonly sessionID: string; readonly questions: readonly OpenCodeQuestion[] };

export type OpenCodeRuntimeEvent =
  | { readonly event: "text_delta"; readonly delta: string; readonly runId: string }
  | { readonly event: "reasoning_delta"; readonly delta: string; readonly runId: string }
  | { readonly event: "tool_event"; readonly tool: string; readonly toolCallId?: string; readonly phase: "started" | "progress" | "completed" | "failed"; readonly message?: string; readonly paths?: readonly string[]; readonly runId: string }
  | { readonly event: "artifact"; readonly artifact: { readonly id: string; readonly relativePath: string; readonly title: string; readonly mimeType: string; readonly byteLength: number; readonly sha256: string }; readonly runId: string }
  | { readonly event: "preview"; readonly preview: { readonly kind: "web" | "ppt" | "image" | "video" | "audio" | "document"; readonly title: string; readonly url?: string; readonly relativePath?: string; readonly artifactId?: string; readonly mimeType?: string; readonly previewSessionId?: string; readonly engine?: "ppt-master" | "dashi-ppt" | "generic-web"; readonly interactive?: boolean; readonly status?: "loading" | "ready" | "unavailable"; readonly error?: string }; readonly runId: string }
  | { readonly event: "usage"; readonly usageId: string; readonly provider?: string; readonly model?: string; readonly inputTokens?: number; readonly outputTokens?: number; readonly cachedInputTokens?: number; readonly reasoningTokens?: number; readonly costUsd?: number; readonly aggregation: "delta" | "snapshot"; readonly scope: "step" | "run"; readonly runId: string }
  | { readonly event: "runtime_warning"; readonly code: string; readonly message: string; readonly runId: string }
  | { readonly event: "permission_request"; readonly permissionId: string; readonly sessionId: string; readonly toolName: string; readonly input?: unknown; readonly title?: string; readonly callId?: string; readonly runId: string }
  | { readonly event: "permission_response"; readonly permissionId: string; readonly sessionId: string; readonly response: "once" | "always" | "reject"; readonly callId?: string; readonly runId: string }
  | { readonly event: "question_request"; readonly requestId: string; readonly sessionId: string; readonly questions: readonly OpenCodeQuestion[]; readonly runId: string }
  | { readonly event: "question_response"; readonly requestId: string; readonly sessionId: string; readonly rejected: boolean; readonly runId: string }
  | { readonly event: "runtime_error"; readonly code: string; readonly message: string; readonly retryable: boolean; readonly runId: string }
  | { readonly event: "done"; readonly runId: string };

function safeDiagnostic(value: unknown, fallback: string) {
  const text = typeof value === "string"
    ? [...value].map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? " " : character;
      }).join("").trim()
    : "";
  return (text || fallback).slice(0, MAX_DIAGNOSTIC_BYTES);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || null;
}

/** Preserve whitespace for streamed model content; block boundaries are data. */
function readText(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
}

function readFiniteNumber(...values: unknown[]) {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? null;
}

function usageEventId(explicitId: unknown, sessionId: string | null | undefined, messageId: string | null | undefined, inputTokens: number | null, outputTokens: number | null, costUsd: number | null) {
  return readString(explicitId) ?? `${sessionId ?? "session"}:${messageId ?? "message"}:step:${inputTokens ?? "x"}:${outputTokens ?? "x"}:${costUsd ?? "x"}`;
}

function sanitizeToolName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return "tool";
  return name.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, MAX_TOOL_NAME_LENGTH) || "tool";
}

const TOOL_FILE_PATH_KEYS = ["filePath", "file_path", "filename", "fileName", "path"] as const;

function toolFilePaths(...values: unknown[]) {
  const paths = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || value === null || value === undefined) return;
    if (Array.isArray(value)) { value.slice(0, 16).forEach((item) => visit(item, depth + 1)); return; }
    const record = readRecord(value);
    if (!record) return;
    for (const key of TOOL_FILE_PATH_KEYS) {
      const path = record[key];
      if (typeof path === "string" && path.trim()) paths.add(path.trim().slice(0, 2048));
    }
    for (const key of ["input", "output", "result", "metadata"] as const) visit(record[key], depth + 1);
  };
  values.forEach((value) => visit(value, 0));
  return [...paths].slice(0, 16);
}

function nestedStrings(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.slice(0, 24).flatMap((item) => nestedStrings(item, depth + 1));
  const record = readRecord(value);
  return record ? Object.values(record).slice(0, 32).flatMap((item) => nestedStrings(item, depth + 1)) : [];
}

function loopbackPreviewUrl(values: readonly string[]) {
  const candidates = values.flatMap((value) => value.match(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:\/[^\s"'<>]*)?/giu) ?? []);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/u, ""));
      const port = Number(url.port);
      if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.port && Number.isInteger(port) && port > 0 && port <= 65535) return url.toString();
    } catch { /* ignore malformed tool output */ }
  }
  return undefined;
}

/** Extract a healthy local web/PPT preview announced by a completed preview-server tool call. */
export function extractOpenCodePreviewDescriptor(partValue: unknown) {
  const part = readRecord(partValue);
  const state = readRecord(part?.state);
  const status = readString(state?.status, part?.status)?.toLowerCase();
  if (!part || !["completed", "success"].includes(status ?? "")) return undefined;
  const inputStrings = nestedStrings(state?.input ?? part.input);
  const outputStrings = nestedStrings(state?.output ?? part.output);
  const commandText = [...nestedStrings(part.tool), ...nestedStrings(part.name), ...inputStrings].join("\n");
  const engine = /start-preview-server\.mjs|preview:start|render_goal_deck/iu.test(commandText)
    ? "dashi-ppt" as const
    : /(?:svg_editor|confirm_ui|spec_review)[\\/]server\.py|ppt-master/iu.test(commandText)
      ? "ppt-master" as const
      : /(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:dev|preview|start)(?:\s|$)|(?:^|\s)(?:vite|next\s+dev|python(?:3)?\s+-m\s+http\.server|npx\s+serve)(?:\s|$)/iu.test(commandText)
        ? "generic-web" as const
        : undefined;
  if (!engine) return undefined;
  const url = loopbackPreviewUrl(outputStrings);
  if (!url) return undefined;
  const toolCallId = readString(part.id);
  const port = new URL(url).port || (url.startsWith("https:") ? "443" : "80");
  return {
    kind: engine === "generic-web" ? "web" as const : "ppt" as const,
    title: engine === "ppt-master" ? "PPT Master preview" : engine === "dashi-ppt" ? "Dashi PPT preview" : "Website preview",
    url,
    previewSessionId: `${engine}:${toolCallId ?? port}`,
    engine,
    interactive: true,
    status: "ready" as const,
  };
}

export interface OpenCodeServeModel {
  readonly providerID: string;
  readonly modelID: string;
}

export interface OpenCodeServeSessionPayloadInput {
  readonly title: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly agent?: string;
}

export interface OpenCodeServePromptPayloadInput {
  readonly prompt: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly variant?: string;
  readonly systemPrompt?: string;
  readonly agent?: string;
}

function openCodeServeModel(input: { readonly providerId?: string; readonly modelId?: string }): OpenCodeServeModel | undefined {
  const providerID = readString(input.providerId);
  const modelID = readString(input.modelId);
  return providerID && modelID ? { providerID, modelID } : undefined;
}

/** Build a directory-scoped OpenCode Serve session path without host URLs. */
export function openCodeServeSessionPath(sessionId: string, directory?: string, operation?: string) {
  const suffix = operation ? `/${encodeURIComponent(operation)}` : "";
  const query = directory === undefined ? "" : `?directory=${encodeURIComponent(directory)}`;
  return `/session/${encodeURIComponent(sessionId)}${suffix}${query}`;
}

/** Build the v1 OpenCode Serve permission reply endpoint. */
export function openCodeServePermissionPath(sessionId: string, permissionId: string, directory?: string) {
  const query = directory === undefined ? "" : `?directory=${encodeURIComponent(directory)}`;
  return `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}${query}`;
}

/** Build the OpenCode Serve collection path for session creation/listing. */
export function openCodeServeSessionsPath(directory: string) {
  return `/session?directory=${encodeURIComponent(directory)}`;
}

/** Build the directory-scoped OpenCode Serve session status endpoint. */
export function openCodeServeSessionStatusPath(directory: string) {
  return `/session/status?directory=${encodeURIComponent(directory)}`;
}

export function createOpenCodeServeSessionPayload(input: OpenCodeServeSessionPayloadInput) {
  // OpenCode 1.17.x validates session creation strictly. Agent/model selection
  // belongs to the prompt payload; sending those fields (or platform metadata)
  // to POST /session makes the real server reject the request with HTTP 400.
  return { title: input.title };
}

export function createOpenCodeServePromptPayload(input: OpenCodeServePromptPayloadInput) {
  const model = openCodeServeModel(input);
  return {
    agent: input.agent || "build",
    ...(model ? { model } : {}),
    ...(readString(input.variant) ? { variant: readString(input.variant) } : {}),
    ...(input.systemPrompt === undefined ? {} : { system: input.systemPrompt }),
    parts: [{ type: "text" as const, text: input.prompt }],
  };
}

/** Read OpenCode's current and older `{ id }` / `{ data: { id } }` responses. */
export function readOpenCodeServeSessionId(payload: unknown) {
  const record = readRecord(payload);
  return readString(record?.id, readRecord(record?.data)?.id) ?? "";
}

export function buildOpenCodeCommand(input: OpenCodeCommandInput): { command: "opencode"; args: string[] } {
  const args = ["run", "--format", "json"];
  const modelHint = typeof input.modelHint === "string" ? input.modelHint.trim() : "";
  const normalizedModel = modelHint.includes("/")
    ? modelHint
    : /^deepseek(?:[-_.]|$)/iu.test(modelHint)
      ? `deepseek/${modelHint}`
      : modelHint === "gpt-5.4" || modelHint === "grok-4.5"
        ? `pptoken/${modelHint}`
        : /^minimax[-_]/iu.test(modelHint)
          ? `minimax/${modelHint}`
          : modelHint;
  if (normalizedModel) args.push("--model", normalizedModel.slice(0, 200));
  return { command: "opencode", args };
}

function parseEvent(runId: string, value: unknown): OpenCodeRuntimeEvent[] {
  const record = readRecord(value);
  if (!record) return [{ event: "runtime_warning", code: "unknown_event", message: "OpenCode emitted a non-object event.", runId }];

  const type = readString(record.type) || "unknown";
  const part = readRecord(record.part);
  const state = readRecord(part?.state);
  const error = readRecord(record.error);
  const partType = readString(part?.type)?.toLowerCase();

  const thinkingText = readText(part?.thinking, record.thinking, record.reasoning_content);
  if (type === "reasoning" || type === "thinking" || partType === "reasoning" || partType === "thinking" || thinkingText) {
    const text = thinkingText ?? readText(part?.text, part?.reasoning, record.text, record.delta);
    return text ? [{ event: "reasoning_delta", delta: text, runId }] : [];
  }

  if (type === "text") {
    const text = readText(part?.text, record.text, record.delta);
    return text ? [{ event: "text_delta", delta: text, runId }] : [];
  }

  if (type === "tool_use") {
    const phaseValue = readString(state?.status, part?.status, record.status)?.toLowerCase();
    const phase = phaseValue === "error" || phaseValue === "failed"
      ? "failed"
      : phaseValue === "completed" || phaseValue === "success"
        ? "completed"
        : "started";
    const message = readString(state?.title, state?.message, part?.message, record.message);
    const paths = toolFilePaths(state?.input, state?.output, part?.input, part?.output, record.input, record.output);
    return [{
      event: "tool_event",
      tool: sanitizeToolName(readString(part?.tool, part?.name, record.tool, record.toolName)),
      phase,
      ...(message ? { message: safeDiagnostic(message, "") } : {}),
      ...(paths.length ? { paths } : {}),
      runId,
    }];
  }

  if (type === "step_finish") {
    const tokens = readRecord(part?.tokens) || readRecord(record.tokens);
    const cache = readRecord(tokens?.cache);
    const costUsd = readFiniteNumber(part?.cost, record.cost, part?.costUsd, record.costUsd);
    const inputTokens = readFiniteNumber(tokens?.input, tokens?.inputTokens, part?.inputTokens, record.inputTokens);
    const outputTokens = readFiniteNumber(tokens?.output, tokens?.outputTokens, part?.outputTokens, record.outputTokens);
    const cachedInputTokens = readFiniteNumber(tokens?.cachedInput, tokens?.cached_input, tokens?.cacheRead, tokens?.cache_read, tokens?.cache, cache?.read);
    const reasoningTokens = readFiniteNumber(tokens?.reasoning, tokens?.reasoningTokens, tokens?.reasoning_tokens);
    if (inputTokens === null && outputTokens === null && cachedInputTokens === null && reasoningTokens === null && costUsd === null) return [];
    return [{
      event: "usage",
      usageId: usageEventId(part?.id, runId, readString(part?.messageID, part?.messageId, record.messageID, record.messageId), inputTokens, outputTokens, costUsd),
      ...(inputTokens === null ? {} : { inputTokens }),
      ...(outputTokens === null ? {} : { outputTokens }),
      ...(cachedInputTokens === null ? {} : { cachedInputTokens }),
      ...(reasoningTokens === null ? {} : { reasoningTokens }),
      ...(costUsd === null ? {} : { costUsd }),
      aggregation: "delta",
      scope: "step",
      runId,
    }];
  }

  if (type === "error") {
    const errorData = readRecord(error?.data);
    const message = safeDiagnostic(readString(error?.message, errorData?.message, record.message, error?.name), "OpenCode runtime failed.");
    return [{ event: "runtime_error", code: "opencode_error", message, retryable: true, runId }];
  }

  if (type === "step_start") return [];
  return [{ event: "runtime_warning", code: "unknown_event", message: `Ignored OpenCode event type: ${safeDiagnostic(type, "unknown")}`, runId }];
}

export function createOpenCodeEventParser(runId: string) {
  let buffer = "";
  let malformedLines = 0;
  let finished = false;
  let fatal = false;

  const parseLine = (line: string): OpenCodeRuntimeEvent[] => {
    const normalized = line.trim();
    if (!normalized) return [];
    if (new TextEncoder().encode(normalized).byteLength > MAX_LINE_BYTES) {
      malformedLines += 1;
      const warning: OpenCodeRuntimeEvent = {
        event: "runtime_warning",
        code: malformedLines >= 3 ? "fatal_parse_error" : "oversized_line",
        message: "OpenCode emitted an oversized event line.",
        runId,
      };
      if (warning.code === "fatal_parse_error") fatal = true;
      return [warning];
    }

    try {
      const events = parseEvent(runId, JSON.parse(normalized));
      malformedLines = 0;
      return events;
    } catch {
      malformedLines += 1;
      const event: OpenCodeRuntimeEvent = malformedLines >= 3
        ? { event: "runtime_error", code: "fatal_parse_error", message: "OpenCode emitted too many malformed event lines.", retryable: false, runId }
        : { event: "runtime_warning", code: "malformed_json_line", message: "OpenCode emitted a malformed event line.", runId };
      if (event.event === "runtime_error") fatal = true;
      return [event];
    }
  };

  return {
    push(chunk: string) {
      if (finished || !chunk) return [] as OpenCodeRuntimeEvent[];
      buffer += chunk;
      if (new TextEncoder().encode(buffer).byteLength > MAX_LINE_BYTES * 2) {
        buffer = "";
        malformedLines += 1;
        const event: OpenCodeRuntimeEvent = malformedLines >= 3
          ? { event: "runtime_error", code: "fatal_parse_error", message: "OpenCode emitted too many malformed event lines.", retryable: false, runId }
          : { event: "runtime_warning", code: "oversized_line", message: "OpenCode emitted an oversized incomplete event line.", runId };
        if (event.event === "runtime_error") fatal = true;
        return [event];
      }

      const events: OpenCodeRuntimeEvent[] = [];
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        events.push(...parseLine(line));
        newlineIndex = buffer.indexOf("\n");
      }
      return events;
    },
    finish() {
      if (finished) return [] as OpenCodeRuntimeEvent[];
      finished = true;
      const events = buffer.trim() ? parseLine(buffer) : [];
      buffer = "";
      if (fatal || events.some((event) => event.event === "runtime_error" && event.code === "fatal_parse_error")) return events;
      events.push({ event: "done", runId });
      return events;
    },
  };
}

/** Mutable per-run state used while normalizing OpenCode's serve SSE schema. */
export interface OpenCodeServeEventState {
  readonly messageRoles: Map<string, string>;
  /** OpenCode may send a part snapshot before its streaming deltas. */
  readonly partTypes: Map<string, string>;
  readonly textByPartId: Map<string, string>;
  readonly permissionCallIds: Map<string, string>;
  readonly usagePartIds: Set<string>;
}

export interface OpenCodeServeEventResult {
  readonly sessionId: string;
  readonly messageId?: string;
  readonly messageRole?: string;
  readonly parentId?: string;
  readonly messageCreated?: number;
  readonly messageCompleted?: boolean;
  readonly messageFinish?: string;
  readonly sessionStatus?: "idle" | "busy" | "retry";
  readonly sessionIdle?: boolean;
  readonly events: readonly OpenCodeRuntimeEvent[];
  readonly terminalError?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export function createOpenCodeServeEventState(): OpenCodeServeEventState {
  return { messageRoles: new Map(), partTypes: new Map(), textByPartId: new Map(), permissionCallIds: new Map(), usagePartIds: new Set() };
}

/**
 * Normalize one `opencode serve` SSE JSON payload. Hosts own transport and
 * run/session lookup; this shared code owns event shape, assistant deltas,
 * user-echo suppression, usage, tool lifecycle and terminal errors.
 */
export function normalizeOpenCodeServeEvent(
  runId: string,
  payload: unknown,
  state: OpenCodeServeEventState,
): OpenCodeServeEventResult {
  const envelope = readRecord(payload);
  const record = readRecord(envelope?.payload) ?? envelope;
  const properties = readRecord(record?.properties);
  const part = readRecord(properties?.part);
  const tool = readRecord(properties?.tool);
  const info = readRecord(properties?.info);
  // OpenCode has emitted both `sessionID` and `sessionId`, with the session
  // occasionally nested under the message metadata. Keep host routing tied to
  // this normalized value instead of duplicating a narrower parser per host.
  const sessionId = readString(properties?.sessionID, properties?.sessionId, part?.sessionID, part?.sessionId, info?.sessionID, info?.sessionId, tool?.sessionID, tool?.sessionId) ?? "";
  const messageId = readString(info?.id, properties?.messageID, properties?.messageId, part?.messageID, part?.messageId, tool?.messageID, tool?.messageId) ?? undefined;
  const messageRole = readString(info?.role) ?? undefined;
  const parentId = readString(info?.parentID) ?? undefined;
  const messageCreated = readFiniteNumber(readRecord(info?.time)?.created) ?? undefined;
  const identity = { sessionId, ...(messageId ? { messageId } : {}), ...(messageRole ? { messageRole } : {}), ...(parentId ? { parentId } : {}), ...(messageCreated === undefined ? {} : { messageCreated }) };
  const type = readString(record?.type) ?? "";
  if (type === "question.asked") {
    const requestId = readString(properties?.id);
    const questions = properties?.questions;
    if (!requestId || !sessionId || !Array.isArray(questions)) return { ...identity, events: [] };
    return { ...identity, events: [{ event: "question_request", requestId, sessionId, questions: questions as OpenCodeQuestion[], runId }] };
  }
  if (type === "question.replied" || type === "question.rejected") {
    const requestId = readString(properties?.requestID);
    return { ...identity, events: requestId && sessionId ? [{ event: "question_response", requestId, sessionId, rejected: type === "question.rejected", runId }] : [] };
  }
  if (type === "session.status") {
    const status = readRecord(properties?.status);
    const value = readString(status?.type);
    if (value === "idle" || value === "busy" || value === "retry") {
      return { ...identity, sessionStatus: value, sessionIdle: value === "idle", events: [] };
    }
    return { ...identity, events: [] };
  }
  if (type === "session.idle") return { ...identity, sessionStatus: "idle", sessionIdle: true, events: [] };
  if (type === "permission.updated" || type === "permission.asked") {
    const permission = readRecord(record?.properties) ?? readRecord(record?.permission) ?? record;
    const permissionId = readString(permission?.id, permission?.permissionID);
    const permissionSessionId = readString(permission?.sessionID, permission?.sessionId, sessionId);
    if (!permissionId || !permissionSessionId) return { ...identity, events: [] };
    const metadata = readRecord(permission?.metadata);
    const toolInfo = readRecord(permission?.tool);
    const toolName = sanitizeToolName(readString(permission?.permission, permission?.type, permission?.action, metadata?.toolName, metadata?.tool, toolInfo?.name, "permission"));
    const input = metadata?.input ?? metadata?.args ?? metadata?.command ?? permission?.patterns ?? permission?.pattern;
    const title = readString(permission?.title, metadata?.title);
    const callId = readString(permission?.callID, permission?.callId, toolInfo?.callID, toolInfo?.callId, metadata?.callID, metadata?.callId);
    if (callId) state.permissionCallIds.set(permissionId, callId);
    return {
      ...identity,
      sessionId: permissionSessionId,
      events: [{ event: "permission_request", permissionId, sessionId: permissionSessionId, toolName, ...(input === undefined ? {} : { input }), ...(title ? { title } : {}), ...(callId ? { callId } : {}), runId }],
    };
  }
  if (type === "permission.replied") {
    const permission = readRecord(record?.properties) ?? record;
    const permissionId = readString(permission?.permissionID, permission?.permissionId, permission?.requestID);
    const permissionSessionId = readString(permission?.sessionID, permission?.sessionId, sessionId);
    const response = readString(permission?.response, permission?.reply)?.toLowerCase();
    const callId = readString(permission?.callID, permission?.callId, readRecord(permission?.tool)?.callID, readRecord(permission?.tool)?.callId, state.permissionCallIds.get(permissionId ?? ""));
    if (!permissionId || !permissionSessionId || !["once", "always", "reject"].includes(response ?? "")) return { ...identity, events: [] };
    return { ...identity, sessionId: permissionSessionId, events: [{ event: "permission_response", permissionId, sessionId: permissionSessionId, response: response as "once" | "always" | "reject", ...(callId ? { callId } : {}), runId }] };
  }
  if (type === "message.updated") {
    const messageId = readString(info?.id);
    const role = readString(info?.role);
    if (messageId && role) state.messageRoles.set(messageId, role);
    const time = readRecord(info?.time);
    const completed = readFiniteNumber(time?.completed, info?.completed);
    const finish = readString(info?.finish, info?.finishReason, info?.reason);
    return { ...identity, messageCompleted: role === "assistant" && completed !== null, ...(finish ? { messageFinish: finish } : {}), events: [] };
  }
  if (type === "session.error") {
    const error = readRecord(properties?.error);
    return {
      ...identity,
      events: [],
      terminalError: {
        code: "opencode_error",
        message: safeDiagnostic(readString(error?.message, properties?.error), "OpenCode session error."),
        retryable: true,
      },
    };
  }
  if (type === "message.part.delta") {
    // OpenCode streams visible text and model reasoning through the same event
    // type. Keep reasoning separate from the assistant response so the UI can
    // show it as process context without leaking it into the transcript.
    const deltaPart = readRecord(properties?.part) ?? part;
    const field = readString(properties?.field, deltaPart?.field, deltaPart?.type)?.toLowerCase();
    const delta = readText(properties?.delta, deltaPart?.delta, deltaPart?.thinking, deltaPart?.reasoning, deltaPart?.reasoning_content, record?.delta, record?.thinking, record?.reasoning_content);
    const deltaMessageId = readString(properties?.messageID, properties?.messageId, deltaPart?.messageID, deltaPart?.messageId);
    const deltaPartId = readString(properties?.partID, properties?.partId, deltaPart?.id) ?? deltaMessageId ?? "text";
    const knownPartType = state.partTypes.get(deltaPartId);
    const deltaPartType = readString(deltaPart?.type)?.toLowerCase();
    if (deltaPartType) state.partTypes.set(deltaPartId, deltaPartType);
    if (!delta || (deltaMessageId && state.messageRoles.get(deltaMessageId) === "user")) return { ...identity, events: [] };
    if (field === "reasoning" || field === "thinking" || field === "reasoning_content" || knownPartType === "reasoning" || knownPartType === "thinking" || deltaPartType === "reasoning" || deltaPartType === "thinking") {
      state.textByPartId.set(deltaPartId, `${state.textByPartId.get(deltaPartId) ?? ""}${delta}`);
      return { ...identity, ...(deltaMessageId ? { messageId: deltaMessageId } : {}), events: [{ event: "reasoning_delta", delta, runId }] };
    }
    if (field && field !== "text") return { ...identity, events: [] };
    const previous = state.textByPartId.get(deltaPartId) ?? "";
    const accumulated = `${previous}${delta}`;
    state.textByPartId.set(deltaPartId, accumulated);
    return {
      ...identity,
      ...(deltaMessageId ? { messageId: deltaMessageId } : {}),
      events: [{ event: "text_delta", delta, runId }],
    };
  }
  if (type !== "message.part.updated" || !part) return { ...identity, events: [] };
  const partMessageId = readString(part.messageID, part.messageId);
  if (partMessageId && state.messageRoles.get(partMessageId) === "user") return { ...identity, events: [] };
  const partType = readString(part.type)?.toLowerCase();
  const partId = readString(part.id, partMessageId) ?? "text";
  if (partType) state.partTypes.set(partId, partType);
  const reasoningText = readText(part.thinking, part.reasoning, part.reasoning_content, part.reasoningText);
  // Snapshots may only extend emitted content; stale/conflicting snapshots
  // cannot replace it in a delta-only stream. The host reconciles at idle to
  // avoid snapshots that overlap later SSE deltas.
  if (partType === "text" && !reasoningText) {
    const text = typeof part.text === "string" ? part.text : "";
    const previous = state.textByPartId.get(partId) ?? "";
    if (!text.startsWith(previous)) return { ...identity, events: [] };
    const delta = text.slice(previous.length);
    state.textByPartId.set(partId, text);
    return { ...identity, events: delta ? [{ event: "text_delta", delta, runId }] : [] };
  }
  if (partType === "reasoning" || partType === "thinking" || reasoningText) {
    const text = reasoningText ?? (typeof part.text === "string" ? part.text : "");
    const previous = state.textByPartId.get(partId) ?? "";
    if (!text.startsWith(previous)) return { ...identity, events: [] };
    const delta = text.slice(previous.length);
    state.textByPartId.set(partId, text);
    if (!delta) return { ...identity, events: [] };
    return { ...identity, events: [{ event: "reasoning_delta", delta, runId }] };
  }
  if (partType === "tool") {
    const partState = readRecord(part.state);
    const status = readString(partState?.status, part.status)?.toLowerCase();
    const phase = status === "error" || status === "failed"
      ? "failed"
      : status === "completed" || status === "success"
        ? "completed"
        : "started";
    const toolCallId = readString(part.id);
    const message = readString(partState?.title, partState?.message);
    const paths = toolFilePaths(partState?.input, partState?.output, part?.input, part?.output);
    const preview = extractOpenCodePreviewDescriptor(part);
    return {
      ...identity,
      events: [{
        event: "tool_event",
        tool: sanitizeToolName(readString(part.tool, part.name)),
        ...(toolCallId ? { toolCallId } : {}),
        phase,
        ...(message ? { message: safeDiagnostic(message, "") } : {}),
        ...(paths.length ? { paths } : {}),
        runId,
      }, ...(preview ? [{ event: "preview" as const, preview, runId }] : [])],
    };
  }
  if (partType === "step-finish" || partType === "step_finish") {
    const tokens = readRecord(part.tokens);
    const cache = readRecord(tokens?.cache);
    const inputTokens = readFiniteNumber(tokens?.input, tokens?.inputTokens, part.inputTokens);
    const outputTokens = readFiniteNumber(tokens?.output, tokens?.outputTokens, part.outputTokens);
    const cachedInputTokens = readFiniteNumber(tokens?.cachedInput, tokens?.cached_input, tokens?.cacheRead, tokens?.cache_read, tokens?.cache, cache?.read);
    const reasoningTokens = readFiniteNumber(tokens?.reasoning, tokens?.reasoningTokens, tokens?.reasoning_tokens);
    const costUsd = readFiniteNumber(part.cost, part.costUsd);
    if (inputTokens === null && outputTokens === null && cachedInputTokens === null && reasoningTokens === null && costUsd === null) return { ...identity, events: [] };
    const usagePartId = usageEventId(part.id, sessionId, partMessageId ?? messageId, inputTokens, outputTokens, costUsd);
    if (state.usagePartIds.has(usagePartId)) return { ...identity, events: [] };
    state.usagePartIds.add(usagePartId);
    return {
      ...identity,
      events: [{
        event: "usage",
        usageId: usagePartId,
        ...(inputTokens === null ? {} : { inputTokens }),
        ...(outputTokens === null ? {} : { outputTokens }),
        ...(cachedInputTokens === null ? {} : { cachedInputTokens }),
        ...(reasoningTokens === null ? {} : { reasoningTokens }),
        ...(costUsd === null ? {} : { costUsd }),
        aggregation: "delta",
        scope: "step",
        runId,
      }],
    };
  }
  return { ...identity, events: [] };
}

export const opencodeRuntimeDefinition = {
  provider: "opencode" as const,
  executableNames: ["opencode-cli", "opencode"] as const,
  stdinMode: "text" as const,
  buildArgs(input: OpenCodeCommandInput) {
    return buildOpenCodeCommand(input).args;
  },
  capabilities: { streaming: true, cancellation: true, artifacts: true, nativeSessionResume: true },
};
