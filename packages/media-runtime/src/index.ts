export type MediaTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type MediaProviderId = string & { readonly __mediaProviderId: unique symbol };

export class ProviderConfigurationRequiredError extends Error {
  readonly code = "provider_configuration_required";
  constructor(readonly provider: MediaProviderId, readonly capability: string) {
    super(`Provider configuration required for ${capability} (${provider})`);
    this.name = "ProviderConfigurationRequiredError";
  }
}

export function requireMediaProvider<T>(provider: MediaProviderAdapter | undefined, providerId: MediaProviderId, capability: string): MediaProviderAdapter {
  if (!provider) throw new ProviderConfigurationRequiredError(providerId, capability);
  return provider;
}

export interface MediaRequest<TInput = Record<string, unknown>> {
  readonly provider: MediaProviderId;
  readonly modelId: string;
  readonly input: TInput;
  readonly idempotencyKey?: string;
}

export interface MediaTask {
  readonly providerTaskId: string;
  readonly status: MediaTaskStatus;
  readonly providerStatus?: string;
  /** Bounded provider diagnostic retained for node status and retry decisions. */
  readonly error?: string;
  readonly outputs: readonly Record<string, unknown>[];
  readonly usage?: MediaUsage;
}

export interface MediaUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly requestCount?: number;
  readonly durationSeconds?: number;
  readonly providerCost?: number;
  readonly estimatedCost?: number;
}

export interface CancellationPort {
  readonly signal?: AbortSignal;
  readonly throwIfCancelled: () => void;
}

export interface MediaProviderAdapter {
  readonly provider: MediaProviderId;
  readonly execute: (request: MediaRequest, cancellation: CancellationPort) => Promise<MediaTask>;
  readonly query?: (providerTaskId: string, cancellation: CancellationPort) => Promise<MediaTask>;
  readonly cancel?: (providerTaskId: string, cancellation: CancellationPort) => Promise<MediaTask>;
}

export interface MediaPollingOptions { readonly pollIntervalMs?: number; readonly timeoutMs?: number; readonly initialTask?: MediaTask; readonly onSubmitted?: (task: MediaTask) => Promise<void> | void; readonly onUpdate?: (task: MediaTask) => Promise<void> | void; }

export interface MediaHttpAdapterOptions {
  readonly provider: MediaProviderId;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly submitPath: string;
  readonly queryPath?: (providerTaskId: string) => string;
  readonly cancelPath?: (providerTaskId: string) => string;
  readonly fetchImpl?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly requestTimeoutMs?: number;
}

function isHttpEndpoint(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function requireInjectedProviderConfig(
  options: Pick<MediaHttpAdapterOptions, "provider" | "baseUrl" | "apiKey">,
  capability: string,
) {
  const provider = String(options.provider ?? "").trim() as MediaProviderId;
  if (!provider || !isHttpEndpoint(options.baseUrl) || !options.apiKey?.trim()) {
    throw new ProviderConfigurationRequiredError(provider, capability);
  }
}

/** OpenAI-compatible and simple async JSON provider adapter. No SaaS transport is involved. */
export function createHttpMediaAdapter(options: MediaHttpAdapterOptions): MediaProviderAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveUrl = (path: string) => {
    const relativePath = path.replace(/^\/+/u, "");
    const baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    return new URL(relativePath, baseUrl).toString();
  };
  const request = async (path: string, init: RequestInit, cancellation: CancellationPort) => {
    requireInjectedProviderConfig(options, "media");
    cancellation.throwIfCancelled();
    const requestAbort = requestAbortSignal(cancellation.signal, options.requestTimeoutMs);
    let response: Response;
    let body: string;
    try {
      response = await fetchImpl(resolveUrl(path), {
        ...init,
        headers: {
          accept: "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          ...options.headers,
          ...(init.headers ?? {}),
        },
        signal: requestAbort.signal,
      });
      body = await response.text();
    } catch (error) {
      if (requestAbort.didTimeout()) throw new Error("media_provider_request_timeout");
      if (cancellation.signal?.aborted) cancellation.throwIfCancelled();
      throw error;
    } finally {
      requestAbort.cleanup();
    }
    let parsed: unknown = null;
    try { parsed = body ? JSON.parse(body) : null; } catch { throw new Error("media_provider_invalid_response"); }
    if (!response.ok) {
      const error = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      const nested = error.error && typeof error.error === "object" ? error.error as Record<string, unknown> : undefined;
      const detail = text(nested?.message ?? nested?.msg ?? error.message ?? error.msg ?? error.code).slice(0, 180);
      throw new Error(`media_provider_http_${response.status}${detail ? `:${detail}` : ""}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("media_provider_invalid_response");
    return parsed as Record<string, unknown>;
  };
  const toTask = (value: Record<string, unknown>, fallbackId?: string): MediaTask => {
    const providerTaskId = String(value.id ?? value.request_id ?? value.requestId ?? value.task_id ?? value.taskId ?? fallbackId ?? `sync-${Date.now()}`);
    const statusText = String(value.status ?? value.state ?? (value.request_id || value.requestId ? "queued" : "succeeded")).toLowerCase();
    const status: MediaTaskStatus = statusText.includes("fail") || statusText.includes("error") ? "failed" : statusText.includes("queue") || statusText.includes("pending") || statusText.includes("submitted") ? "queued" : statusText.includes("run") || statusText.includes("process") ? "running" : "succeeded";
    const outputValues = Array.isArray(value.data) ? value.data : Array.isArray(value.output) ? value.output : Array.isArray(value.outputs) ? value.outputs : [];
    const outputs = outputValues.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item) => ({ ...item }));
    const nestedOutput = value.output && typeof value.output === "object" ? value.output as Record<string, unknown> : undefined;
    const video = value.video && typeof value.video === "object" ? value.video as Record<string, unknown> : undefined;
    const directUrl = value.video_url ?? value.videoUrl ?? value.audio_url ?? value.audioUrl ?? value.url ?? value.file_url ?? value.fileUrl ?? value.download_url ?? value.downloadUrl;
    if (typeof directUrl === "string" && directUrl.trim()) outputs.push({ url: directUrl.trim() });
    const nestedUrl = video?.url ?? nestedOutput?.url;
    if (outputs.length === 0 && typeof nestedUrl === "string" && nestedUrl.trim()) outputs.push({ url: nestedUrl.trim() });
    const usage = normalizeUsage(value.usage ?? value.usage_info ?? nestedOutput?.usage);
    return { providerTaskId, status, ...(typeof value.status === "string" ? { providerStatus: value.status } : {}), outputs, ...(usage ? { usage } : {}) };
  };
  return {
    provider: options.provider,
    execute: async (requestInput, cancellation) => toTask(await request(options.submitPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: requestInput.modelId, ...requestInput.input, ...(requestInput.idempotencyKey ? { idempotency_key: requestInput.idempotencyKey } : {}) }) }, cancellation)),
    ...(options.queryPath ? { query: async (providerTaskId, cancellation) => toTask(await request(options.queryPath!(providerTaskId), { method: "GET" }, cancellation), providerTaskId) } : {}),
    ...(options.cancelPath ? { cancel: async (providerTaskId, cancellation) => toTask(await request(options.cancelPath!(providerTaskId), { method: "POST" }, cancellation), providerTaskId) } : {}),
  };
}

export interface DirectProviderOptions {
  readonly provider: MediaProviderId;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  /** Optional per-request override used by tests and constrained hosts. */
  readonly requestTimeoutMs?: number;
  /** Use curl for gateways whose Node fetch connection is closed early. */
  readonly imageTransport?: "fetch" | "curl";
  readonly curlRunner?: (args: readonly string[], options: { readonly signal?: AbortSignal }) => Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number | null }>;
  /** Workspace root used for provider-side uploads initiated by local adapters. */
  readonly workspacePath?: string;
}

export const IMAGE_GENERATION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

type WorkflowLocalMediaFile = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
};

async function readWorkflowLocalMediaFile(
  value: string,
  options: DirectProviderOptions,
  cancellation: CancellationPort,
  workflowLocalAttachments: boolean,
  allowedContentType: RegExp,
  maxBytes: number,
): Promise<WorkflowLocalMediaFile> {
  if (!workflowLocalAttachments) throw new Error("image_reference_path_unsafe");
  cancellation.throwIfCancelled();
  const workspacePath = text(options.workspacePath);
  if (!workspacePath) throw new Error("image_reference_workspace_required");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(workspacePath);
  const absoluteValue = path.isAbsolute(value);
  const candidate = absoluteValue && workflowLocalAttachments ? path.resolve(value) : path.resolve(root, value);
  if ((!absoluteValue || !workflowLocalAttachments) && (candidate === root || !candidate.startsWith(`${root}${path.sep}`))) throw new Error("image_reference_path_unsafe");
  const metadata = await fs.stat(candidate).catch(() => undefined);
  if (!metadata?.isFile()) throw new Error("image_reference_file_missing");
  if (metadata.size > maxBytes) throw new Error(`image_reference_too_large:${maxBytes}`);
  const contentType = mediaContentTypeForExtension(path.extname(candidate));
  if (!contentType || !allowedContentType.test(contentType)) throw new Error("image_reference_type_unsupported");
  return { bytes: new Uint8Array(await fs.readFile(candidate)), contentType, fileName: path.basename(candidate) };
}

async function resolveProviderImageReference(value: string, options: DirectProviderOptions, cancellation: CancellationPort, workflowLocalAttachments: boolean, maxBytes: number) {
  let parsed: URL | undefined;
  try { parsed = new URL(value); } catch { parsed = undefined; }
  if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "data:")) return value;
  const local = await readWorkflowLocalMediaFile(value, options, cancellation, workflowLocalAttachments, /^image\//u, maxBytes);
  return `data:${local.contentType};base64,${Buffer.from(local.bytes).toString("base64")}`;
}

function isDashScopeTemporaryUrl(value: string) {
  return value.trim().toLowerCase().startsWith("oss://");
}

async function uploadDashScopeMediaReference(value: string, model: string, options: DirectProviderOptions, cancellation: CancellationPort, allowedContentType: RegExp, maxBytes: number) {
  let parsed: URL | undefined;
  try { parsed = new URL(value); } catch { parsed = undefined; }
  if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "data:" || parsed.protocol === "oss:")) return value;
  const local = await readWorkflowLocalMediaFile(value, options, cancellation, true, allowedContentType, maxBytes);
  const policy = await jsonRequest(options, "/api/v1/uploads", { method: "POST" }, cancellation, { action: "getPolicy", model });
  const data = policy.data && typeof policy.data === "object" ? policy.data as Record<string, unknown> : {};
  const uploadHost = text(data.upload_host ?? data.uploadHost);
  const uploadDirectory = text(data.upload_dir ?? data.uploadDir);
  const accessKeyId = text(data.oss_access_key_id ?? data.ossAccessKeyId);
  const policyToken = text(data.policy);
  const signature = text(data.signature);
  if (!isHttpEndpoint(uploadHost) || !uploadDirectory || !accessKeyId || !policyToken || !signature) throw new Error("media_provider_upload_invalid_policy");
  const key = `${uploadDirectory.replace(/\/+$/u, "")}/${Date.now()}-${local.fileName}`;
  const form = new FormData();
  form.set("OSSAccessKeyId", accessKeyId);
  form.set("Signature", signature);
  form.set("policy", policyToken);
  form.set("x-oss-object-acl", text(data.x_oss_object_acl ?? data.xOssObjectAcl) || "private");
  form.set("x-oss-forbid-overwrite", text(data.x_oss_forbid_overwrite ?? data.xOssForbidOverwrite) || "true");
  form.set("key", key);
  form.set("success_action_status", "200");
  form.set("file", new Blob([local.bytes as unknown as BlobPart], { type: local.contentType }), local.fileName);
  const requestAbort = requestAbortSignal(cancellation.signal, options.requestTimeoutMs);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(uploadHost, { method: "POST", body: form, signal: requestAbort.signal });
    await response.text();
  } catch (error) {
    if (requestAbort.didTimeout()) throw new Error("media_provider_request_timeout");
    if (cancellation.signal?.aborted) cancellation.throwIfCancelled();
    throw error;
  } finally {
    requestAbort.cleanup();
  }
  if (!response.ok) throw new Error(`media_provider_upload_http_${response.status}`);
  return `oss://${key}`;
}

async function resolveDashScopeMediaReference(value: string, model: string, options: DirectProviderOptions, cancellation: CancellationPort, kind: "image" | "video" | "audio") {
  if (kind === "image") return resolveProviderImageReference(value, options, cancellation, true, 20 * 1024 * 1024);
  return uploadDashScopeMediaReference(value, model, options, cancellation, new RegExp(`^${kind}/`, "u"), 100 * 1024 * 1024);
}

function providerUrl(baseUrl: string, path: string, query?: Record<string, string>) {
  // Treat provider paths as relative to the configured base path. A leading
  // slash would make URL() discard a `/v1` prefix used by OpenAI-compatible
  // gateways.
  const relativePath = path.replace(/^\/+/u, "");
  const url = new URL(relativePath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url;
}

/** Uploads a local media artifact to RunningHub's documented binary media
 * endpoint and returns the provider file name accepted by LoadAudio/LoadImage. */
export async function uploadRunningHubMedia(
  options: DirectProviderOptions,
  sourcePath: string,
  cancellation: CancellationPort,
) {
  const asset = await uploadRunningHubMediaAsset(options, sourcePath, cancellation);
  return asset.fileName;
}

/** Uploads a local media artifact and keeps both provider references. Older
 * workflows consume `fileName`; newer LoadAudioFromUrl/LoadImageFromUrl
 * workflows consume the returned `downloadUrl` instead. */
export async function uploadRunningHubMediaAsset(
  options: DirectProviderOptions,
  sourcePath: string,
  cancellation: CancellationPort,
) {
  requireInjectedProviderConfig(options, "runninghub-media-upload");
  cancellation.throwIfCancelled();
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const metadata = await fs.stat(sourcePath).catch(() => undefined);
  if (!metadata?.isFile()) throw new Error("runninghub_media_source_missing");
  const bytes = await fs.readFile(sourcePath);
  const form = new FormData();
  form.set("file", new Blob([bytes as unknown as BlobPart]), path.basename(sourcePath));
  const response = await (options.fetchImpl ?? fetch)(providerUrl(options.baseUrl, "/openapi/v2/media/upload/binary"), {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${options.apiKey}` },
    body: form,
    signal: cancellation.signal,
  });
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { throw new Error("runninghub_media_upload_invalid_response"); }
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
  const providerFileName = text(data.fileName ?? data.file_name);
  const downloadUrl = text(data.download_url ?? data.downloadUrl ?? data.url);
  const code = Number(payload.code ?? 0);
  if (!response.ok || (Number.isFinite(code) && code !== 0) || !providerFileName) {
    const detail = text(payload.message ?? payload.msg ?? payload.code).slice(0, 180);
    throw new Error(`runninghub_media_upload_failed${detail ? `:${detail}` : ""}`);
  }
  return { fileName: providerFileName, ...(downloadUrl ? { downloadUrl } : {}) };
}

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
function numberValue(value: unknown, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function finiteNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeUsage(value: unknown): MediaUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const inputTokens = finiteNumber(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens);
  const outputTokens = finiteNumber(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens);
  const requestCount = finiteNumber(usage.request_count ?? usage.requestCount ?? usage.requests);
  const durationSeconds = finiteNumber(usage.duration_seconds ?? usage.durationSeconds ?? (finiteNumber(usage.duration_ms) !== undefined ? Number(usage.duration_ms) / 1000 : undefined));
  const providerCost = finiteNumber(usage.provider_cost ?? usage.providerCost ?? usage.cost_usd ?? usage.costUsd ?? usage.cost);
  const estimatedCost = finiteNumber(usage.estimated_cost ?? usage.estimatedCost);
  const normalized = { inputTokens, outputTokens, requestCount, durationSeconds, providerCost, estimatedCost };
  return Object.values(normalized).some((entry) => entry !== undefined) ? Object.fromEntries(Object.entries(normalized).filter(([, entry]) => entry !== undefined)) as MediaUsage : undefined;
}

function mapProviderStatus(value: unknown): MediaTaskStatus {
  const status = text(value).toLowerCase();
  if (status.includes("fail") || status.includes("error")) return "failed";
  if (status.includes("cancel")) return "cancelled";
  if (status.includes("queue") || status.includes("pending") || status.includes("submitted")) return "queued";
  if (status.includes("process") || status.includes("run") || status.includes("doing")) return "running";
  return "succeeded";
}

const mediaUrlKeys = ["url", "uri", "image_url", "imageUrl", "video_url", "videoUrl", "audio_url", "audioUrl", "file_url", "fileUrl", "download_url", "downloadUrl", "image"] as const;
const mediaEncodedKeys = ["b64_json", "base64", "base64_json", "image_base64", "imageBase64"] as const;
const mediaContainerKeys = new Set(["data", "output", "outputs", "result", "results", "images", "image", "audio", "video", "assets", "files", "content"]);

function normalizeMediaOutput(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    const url = text(value);
    return url ? { url } : undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const url = text(mediaUrlKeys.map((key) => record[key]).find((entry) => typeof entry === "string" && Boolean(entry.trim())));
  const encoded = text(mediaEncodedKeys.map((key) => record[key]).find((entry) => typeof entry === "string" && Boolean(entry.trim())));
  if (!url && !encoded) return { ...record };
  return {
    ...record,
    ...(url && !text(record.url) ? { url } : {}),
    ...(encoded && !text(record.b64_json) && (record.image_base64 !== undefined || record.imageBase64 !== undefined) ? { b64_json: encoded } : {}),
  };
}

function hasMediaOutput(value: Record<string, unknown>) {
  return mediaUrlKeys.some((key) => typeof value[key] === "string" && Boolean((value[key] as string).trim()))
    || mediaEncodedKeys.some((key) => typeof value[key] === "string" && Boolean((value[key] as string).trim()));
}

/**
 * Providers commonly wrap an image URL several levels deep (for example
 * `data.result.images[0].image.url`). Keep the adapter tolerant of those
 * equivalent response envelopes instead of making the host guess at them.
 */
function collectMediaOutputs(value: unknown, parentKey = "", depth = 0): Record<string, unknown>[] {
  if (depth > 8 || value === undefined || value === null) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return mediaContainerKeys.has(parentKey) && /^(?:https?:\/\/|data:)/iu.test(trimmed) ? [{ url: trimmed }] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectMediaOutputs(item, parentKey, depth + 1));
  if (typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = hasMediaOutput(record) ? normalizeMediaOutput(record) : undefined;
  if (direct) return [direct];
  return Object.entries(record).flatMap(([key, nested]) => collectMediaOutputs(nested, key, depth + 1));
}

function asTask(provider: MediaProviderId, payload: Record<string, unknown>, fallbackId?: string): MediaTask {
  const output = payload.output && typeof payload.output === "object" ? payload.output as Record<string, unknown> : payload;
  const providerTaskId = text(output.task_id) || text(output.taskId) || text(payload.task_id) || text(payload.taskId) || text(payload.id) || fallbackId || `sync-${Date.now()}`;
  const providerStatus = output.task_status ?? output.taskStatus ?? output.status ?? payload.task_status ?? payload.taskStatus ?? payload.status ?? payload.state;
  const values: Array<readonly [string, unknown]> = [];
  const addValue = (parentKey: string, value: unknown) => {
    if (value === undefined || value === null || values.some(([, existing]) => existing === value)) return;
    values.push([parentKey, value]);
  };
  const hasDirectMedia = (source: Record<string, unknown>) => mediaUrlKeys.some((key) => typeof source[key] === "string" && Boolean((source[key] as string).trim())) || mediaEncodedKeys.some((key) => typeof source[key] === "string" && Boolean((source[key] as string).trim()));
  for (const [parentKey, value] of [
    ["audio", output.audio], ["result", output.result], ["results", output.results], ["images", output.images], ["data", output.data],
    ["output", payload.output], ["data", payload.data], ["result", payload.result], ["results", payload.results], ["outputs", payload.outputs], ["images", payload.images],
  ] as const) addValue(parentKey, value);
  if (hasDirectMedia(output)) addValue("output", output);
  if (output !== payload && hasDirectMedia(payload)) addValue("output", payload);
  for (const source of [output, payload]) {
    for (const key of mediaEncodedKeys) {
      if (typeof source[key] === "string" && source[key].trim()) addValue(key, { [key]: source[key] });
    }
  }
  const seen = new Set<string>();
  const outputs = values.flatMap(([parentKey, value]) => collectMediaOutputs(value, parentKey)).filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const usage = normalizeUsage(output.usage ?? output.usage_info ?? payload.usage ?? payload.usage_info);
  const status = mapProviderStatus(providerStatus);
  const failedReason = payload.failedReason && typeof payload.failedReason === "object" ? payload.failedReason as Record<string, unknown> : undefined;
  const failedNode = text(failedReason?.node_name ?? failedReason?.nodeName);
  const error = text(
    failedReason?.exception_message ?? failedReason?.errorMessage ?? failedReason?.message ??
    output.errorMessage ?? output.error_message ?? output.exception_message ?? output.message ??
    payload.errorMessage ?? payload.error_message ?? payload.exception_message ?? payload.message ??
    undefined,
  ).slice(0, 220);
  const diagnostic = error ? `${failedNode ? `${failedNode}: ` : ""}${error}`.slice(0, 240) : "";
  return { providerTaskId, status, ...(providerStatus ? { providerStatus: String(providerStatus) } : {}), ...(status === "failed" && diagnostic ? { error: diagnostic } : {}), outputs, ...(usage ? { usage } : {}) };
}

function requestAbortSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined) {
  if (timeoutMs === undefined) return { signal, didTimeout: () => false, cleanup: () => undefined };
  const controller = new AbortController();
  let timedOut = false;
  const onCancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) onCancel();
  else signal?.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("media_provider_request_timeout"));
  }, Math.max(1, Math.floor(timeoutMs)));
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onCancel);
    },
  };
}

async function defaultCurlRunner(args: readonly string[], options: { readonly signal?: AbortSignal }) {
  const { spawn } = await import("node:child_process");
  return new Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number | null }>((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "curl.exe" : "curl", [...args], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const onAbort = () => { child.kill(); };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, code });
    });
  });
}

async function curlImageRequest(options: DirectProviderOptions, body: Record<string, unknown>, cancellation: CancellationPort, idempotencyKey?: string) {
  requireInjectedProviderConfig(options, "media");
  cancellation.throwIfCancelled();
  const timeoutMs = options.requestTimeoutMs ?? IMAGE_GENERATION_REQUEST_TIMEOUT_MS;
  const requestAbort = requestAbortSignal(cancellation.signal, timeoutMs);
  const args = [
    "-sS", "--connect-timeout", String(Math.max(5, Math.ceil(timeoutMs / 3000))),
    "--max-time", String(Math.max(10, Math.ceil(timeoutMs / 1000))),
    // Windows curl uses Schannel and can fail when the local revocation
    // service is offline even though the server certificate is otherwise
    // valid. Keep the relaxation scoped to this legacy PPTOKEN transport;
    // Node fetch and all non-Windows transports retain normal verification.
    ...(process.platform === "win32" ? ["--ssl-no-revoke"] : []),
    "-X", "POST", providerUrl(options.baseUrl, "/images/generations").toString(),
    "-H", `Authorization: Bearer ${options.apiKey}`,
    "-H", "Content-Type: application/json",
    ...(idempotencyKey ? ["-H", `Idempotency-Key: ${idempotencyKey}`] : []),
    "-d", JSON.stringify(body),
    "-w", "\n__HTTP_STATUS__:%{http_code}",
  ];
  try {
    const result = await (options.curlRunner ?? defaultCurlRunner)(args, { signal: requestAbort.signal });
    if (requestAbort.didTimeout()) throw new Error("media_provider_request_timeout");
    if (cancellation.signal?.aborted) cancellation.throwIfCancelled();
    const marker = "\n__HTTP_STATUS__:";
    const markerIndex = result.stdout.lastIndexOf(marker);
    if (markerIndex === -1) throw new Error("media_provider_curl_response_malformed");
    const status = Number.parseInt(result.stdout.slice(markerIndex + marker.length).trim(), 10);
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(result.stdout.slice(0, markerIndex) || "{}") as Record<string, unknown>; } catch { throw new Error("media_provider_invalid_response"); }
    if (result.code === 28) throw new Error("media_provider_request_timeout");
    if (result.code !== 0 || !Number.isFinite(status) || status <= 0) {
      const detail = result.stderr.trim().slice(-180);
      throw new Error(`media_provider_curl_failed${detail ? `:${detail}` : ""}`);
    }
    if (status < 200 || status >= 300) {
      const error = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : payload;
      const detail = text(error.message ?? error.msg ?? error.code).slice(0, 180);
      throw new Error(`media_provider_http_${status}${detail ? `:${detail}` : ""}`);
    }
    return payload;
  } catch (error) {
    if (requestAbort.didTimeout()) throw new Error("media_provider_request_timeout");
    if (cancellation.signal?.aborted) cancellation.throwIfCancelled();
    if (error instanceof Error && error.message.includes("ENOENT")) throw new Error("media_provider_curl_unavailable");
    throw error;
  } finally {
    requestAbort.cleanup();
  }
}

type CurlImageEditReference = { readonly blob: Blob; readonly fileName: string };

async function curlImageEditRequest(
  options: DirectProviderOptions,
  fields: readonly (readonly [string, string])[],
  references: readonly CurlImageEditReference[],
  cancellation: CancellationPort,
  idempotencyKey?: string,
) {
  requireInjectedProviderConfig(options, "media");
  cancellation.throwIfCancelled();
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { extname, join } = await import("node:path");
  const tempDirectory = await mkdtemp(join(tmpdir(), "coworkany-image-edit-"));
  const requestAbort = requestAbortSignal(cancellation.signal, options.requestTimeoutMs ?? IMAGE_GENERATION_REQUEST_TIMEOUT_MS);
  try {
    const files = await Promise.all(references.map(async (reference, index) => {
      cancellation.throwIfCancelled();
      const extension = extname(reference.fileName).replace(/[^a-z0-9.]/giu, "") || ".png";
      const filePath = join(tempDirectory, `reference-${index}${extension}`);
      await writeFile(filePath, new Uint8Array(await reference.blob.arrayBuffer()));
      return { filePath, contentType: reference.blob.type || "image/png" };
    }));
    const args = [
      "-sS", "--connect-timeout", String(Math.max(5, Math.ceil((options.requestTimeoutMs ?? IMAGE_GENERATION_REQUEST_TIMEOUT_MS) / 3000))),
      "--max-time", String(Math.max(10, Math.ceil((options.requestTimeoutMs ?? IMAGE_GENERATION_REQUEST_TIMEOUT_MS) / 1000))),
      ...(process.platform === "win32" ? ["--ssl-no-revoke"] : []),
      "-X", "POST", providerUrl(options.baseUrl, "/images/edits").toString(),
      "-H", `Authorization: Bearer ${options.apiKey}`,
      "-H", "Accept: application/json",
      ...(idempotencyKey ? ["-H", `Idempotency-Key: ${idempotencyKey}`] : []),
      ...fields.flatMap(([key, value]) => ["--form-string", `${key}=${value}`]),
      ...files.flatMap(({ filePath, contentType }) => ["--form", `image=@${filePath};type=${contentType}`]),
      "-w", "\n__HTTP_STATUS__:%{http_code}",
    ];
    const result = await (options.curlRunner ?? defaultCurlRunner)(args, { signal: requestAbort.signal });
    if (requestAbort.didTimeout()) throw new Error("media_provider_request_timeout");
    if (cancellation.signal?.aborted) cancellation.throwIfCancelled();
    const marker = "\n__HTTP_STATUS__:";
    const markerIndex = result.stdout.lastIndexOf(marker);
    if (markerIndex === -1) throw new Error("media_provider_curl_response_malformed");
    const status = Number.parseInt(result.stdout.slice(markerIndex + marker.length).trim(), 10);
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(result.stdout.slice(0, markerIndex) || "{}") as Record<string, unknown>; } catch { throw new Error("media_provider_invalid_response"); }
    if (result.code === 28) throw new Error("media_provider_request_timeout");
    if (result.code !== 0 || !Number.isFinite(status) || status <= 0) {
      const detail = result.stderr.trim().slice(-180);
      throw new Error(`media_provider_curl_failed${detail ? `:${detail}` : ""}`);
    }
    if (status < 200 || status >= 300) {
      const error = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : payload;
      const detail = text(error.message ?? error.msg ?? error.code).slice(0, 180);
      throw new Error(`media_provider_http_${status}${detail ? `:${detail}` : ""}`);
    }
    return payload;
  } catch (error) {
    if (requestAbort.didTimeout()) throw new Error("media_provider_request_timeout");
    if (cancellation.signal?.aborted) cancellation.throwIfCancelled();
    if (error instanceof Error && error.message.includes("ENOENT")) throw new Error("media_provider_curl_unavailable");
    throw error;
  } finally {
    requestAbort.cleanup();
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function jsonRequest(options: DirectProviderOptions, path: string, init: RequestInit, cancellation: CancellationPort, query?: Record<string, string>, requestTimeoutMs = options.requestTimeoutMs) {
  requireInjectedProviderConfig(options, "media");
  cancellation.throwIfCancelled();
  const requestAbort = requestAbortSignal(cancellation.signal, requestTimeoutMs);
  let response: Response;
  let raw: string;
  try {
    const isMultipart = typeof FormData !== "undefined" && init.body instanceof FormData;
    response = await (options.fetchImpl ?? fetch)(providerUrl(options.baseUrl, path, query), {
      ...init,
      headers: { accept: "application/json", authorization: `Bearer ${options.apiKey}`, ...(isMultipart ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) },
      signal: requestAbort.signal,
    });
    raw = await response.text();
  } catch (error) {
    if (requestAbort.didTimeout()) throw new Error("media_provider_request_timeout");
    if (cancellation.signal?.aborted) cancellation.throwIfCancelled();
    throw error;
  } finally {
    requestAbort.cleanup();
  }
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw: raw.slice(0, 1000) }; }
  if (!response.ok) {
    const error = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const nested = error.error && typeof error.error === "object" ? error.error as Record<string, unknown> : undefined;
    const detail = text(nested?.message ?? nested?.msg ?? error.message ?? error.msg ?? error.code).slice(0, 180);
    throw new Error(`media_provider_http_${response.status}${detail ? `:${detail}` : ""}`);
  }
  return body && typeof body === "object" ? body as Record<string, unknown> : {};
}

export type MiniMaxVoiceType = "system" | "voice_cloning" | "voice_generation" | "all";
export type MiniMaxVoiceCategory = Exclude<MiniMaxVoiceType, "all">;
export interface MiniMaxVoiceOption {
  readonly voiceId: string;
  readonly voiceName: string;
  readonly category: MiniMaxVoiceCategory;
  readonly description: readonly string[];
  readonly createdTime: string | null;
}

/** Lists MiniMax voices without exposing the provider credential to the UI. */
export async function listMiniMaxVoices(
  options: DirectProviderOptions,
  voiceType: MiniMaxVoiceType = "all",
): Promise<readonly MiniMaxVoiceOption[]> {
  const cancellation: CancellationPort = { throwIfCancelled: () => undefined };
  const payload = await jsonRequest(options, "/get_voice", {
    method: "POST",
    body: JSON.stringify({ voice_type: voiceType }),
  }, cancellation);
  const baseResp = payload.base_resp && typeof payload.base_resp === "object" ? payload.base_resp as Record<string, unknown> : undefined;
  const statusCode = Number(baseResp?.status_code ?? 0);
  if (Number.isFinite(statusCode) && statusCode !== 0) {
    throw new Error(text(baseResp?.status_msg) || "minimax_get_voice_failed");
  }
  const map = (category: MiniMaxVoiceCategory, value: unknown): MiniMaxVoiceOption[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const voiceId = text(record.voice_id ?? record.voiceId);
      if (!voiceId) return [];
      const description = Array.isArray(record.description)
        ? record.description.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim())
        : [];
      return [{
        voiceId,
        voiceName: text(record.voice_name ?? record.voiceName) || voiceId,
        category,
        description,
        createdTime: text(record.created_time ?? record.createdTime) || null,
      }];
    });
  };
  return [
    ...map("system", payload.system_voice),
    ...map("voice_cloning", payload.voice_cloning),
    ...map("voice_generation", payload.voice_generation),
  ];
}

async function uploadMiniMaxFile(options: DirectProviderOptions, sourcePath: string, cancellation: CancellationPort, allowWorkflowLocalPath = false): Promise<string> {
  requireInjectedProviderConfig(options, "voice-clone");
  cancellation.throwIfCancelled();
  const workspacePath = text(options.workspacePath);
  if (!workspacePath) throw new Error("voice_clone_workspace_required");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(workspacePath);
  const candidate = path.isAbsolute(sourcePath) ? allowWorkflowLocalPath ? path.resolve(sourcePath) : (() => { throw new Error("voice_clone_source_file_unsafe"); })() : path.resolve(root, sourcePath);
  if (!path.isAbsolute(sourcePath) && (candidate === root || !candidate.startsWith(`${root}${path.sep}`))) throw new Error("voice_clone_source_file_unsafe");
  const metadata = await fs.stat(candidate).catch(() => undefined);
  if (!metadata?.isFile()) throw new Error("voice_clone_source_file_missing");
  const bytes = await fs.readFile(candidate);
  const form = new FormData();
  form.set("purpose", "voice_clone");
  form.set("file", new Blob([bytes as unknown as BlobPart]), path.basename(candidate));
  const response = await (options.fetchImpl ?? fetch)(providerUrl(options.baseUrl, "/files/upload"), {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${options.apiKey}` },
    body: form,
    signal: cancellation.signal,
  });
  const raw = await response.text();
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  if (!response.ok) throw new Error(`voice_clone_upload_failed:${response.status}`);
  const file = body && typeof body === "object" && "file" in body && body.file && typeof body.file === "object" ? body.file as Record<string, unknown> : undefined;
  const rawFileId = file?.file_id ?? file?.fileId;
  const fileId = typeof rawFileId === "number" && Number.isSafeInteger(rawFileId) && rawFileId > 0 ? String(rawFileId) : text(rawFileId);
  if (!fileId) throw new Error("voice_clone_upload_missing_file_id");
  return fileId;
}

/** Direct OpenAI-compatible image generation adapter. The provider response is
 * kept as a local task so the host can download URLs or decode b64_json without
 * involving a SaaS route.
 */
export function createOpenAICompatibleImageAdapter(options: DirectProviderOptions): MediaProviderAdapter {
  return {
    provider: options.provider,
    execute: async (request, cancellation) => {
      const input = request.input as Record<string, unknown>;
      const prompt = text(input.prompt);
      if (!prompt) throw new Error("image_prompt_required");
      const workflowLocalAttachments = input.workflowLocalAttachments === true;
      const count = Math.max(1, Math.min(9, Math.floor(numberValue(input.n, 1))));
      const referenceImageUrls = [...new Set([
        ...(Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()) : []),
        ...(text(input.inputImageUrl) ? [text(input.inputImageUrl)] : []),
      ])];
      const optional = (key: string) => {
        const value = input[key];
        return typeof value === "string" && value.trim() ? { [key]: value.trim() } : {};
      };
      const outputCompression = finiteNumber(input.output_compression);
      const outputFormat = text(input.output_format);
      const loadReferenceImage = async (value: string, index: number) => {
        const dataUrl = /^data:([^;,]+)(;base64)?,([\s\S]*)$/u.exec(value);
        if (dataUrl) {
          const contentType = dataUrl[1] || "image/png";
          const bytes = dataUrl[2] ? Buffer.from(dataUrl[3], "base64") : Buffer.from(decodeURIComponent(dataUrl[3]), "utf8");
          return { blob: new Blob([bytes as unknown as BlobPart], { type: contentType }), fileName: `reference-${index}.${contentType.split("/")[1] || "png"}` };
        }

        let parsed: URL | undefined;
        try { parsed = new URL(value); } catch { parsed = undefined; }
        if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
          const response = await (options.fetchImpl ?? fetch)(parsed, { signal: cancellation.signal });
          if (!response.ok) throw new Error(`image_reference_fetch_failed:${response.status}`);
          const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "image/png";
          const fileName = parsed.pathname.split("/").filter(Boolean).pop() || `reference-${index}.png`;
          return { blob: new Blob([await response.arrayBuffer()], { type: contentType }), fileName };
        }

        const local = await readWorkflowLocalMediaFile(value, options, cancellation, workflowLocalAttachments, /^image\//u, 20 * 1024 * 1024);
        return { blob: new Blob([local.bytes as unknown as BlobPart], { type: local.contentType }), fileName: local.fileName };
      };
      const submit = async (modelId: string, idempotencyKey?: string) => {
        if (referenceImageUrls.length) {
          const fields: Array<readonly [string, string]> = [["model", modelId], ["prompt", prompt], ["n", String(count)]];
          for (const key of ["size", "quality", "output_format", "response_format"]) {
            const value = text(input[key]);
            if (value) fields.push([key, value]);
          }
          if (outputCompression !== undefined && outputFormat !== "png") fields.push(["output_compression", String(Math.max(0, Math.min(100, outputCompression)))]);
          const loadedReferences: CurlImageEditReference[] = [];
          for (const [index, reference] of referenceImageUrls.entries()) {
            const loaded = await loadReferenceImage(reference, index);
            loadedReferences.push(loaded);
          }
          if (options.imageTransport === "curl") return curlImageEditRequest(options, fields, loadedReferences, cancellation, idempotencyKey);
          const form = new FormData();
          for (const [key, value] of fields) form.set(key, value);
          for (const reference of loadedReferences) {
            form.append("image", reference.blob, reference.fileName);
          }
          return jsonRequest(options, "/images/edits", {
            method: "POST",
            body: form,
            headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
          }, cancellation, undefined, options.requestTimeoutMs ?? IMAGE_GENERATION_REQUEST_TIMEOUT_MS);
        }
        const body = {
          model: modelId,
          prompt,
          n: count,
          ...optional("size"),
          ...optional("quality"),
          ...optional("background"),
          ...optional("output_format"),
          ...(outputCompression !== undefined && outputFormat !== "png" ? { output_compression: Math.max(0, Math.min(100, outputCompression)) } : {}),
          ...optional("moderation"),
          ...optional("response_format"),
          ...(idempotencyKey ? { user: idempotencyKey } : {}),
        };
        return options.imageTransport === "curl"
          ? curlImageRequest(options, body, cancellation, idempotencyKey)
          : jsonRequest(options, "/images/generations", {
            method: "POST",
            body: JSON.stringify(body),
            headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
          }, cancellation, undefined, options.requestTimeoutMs ?? IMAGE_GENERATION_REQUEST_TIMEOUT_MS);
      };
      return asTask(options.provider, await submit(request.modelId, request.idempotencyKey));
    },
  };
}

/** Direct DashScope/Bailian text-to-image adapter with recoverable async tasks. */
export function createBailianImageAdapter(options: DirectProviderOptions): MediaProviderAdapter {
  return {
    provider: options.provider,
    execute: async (request, cancellation) => {
      const input = request.input as Record<string, unknown>;
      const prompt = text(input.prompt);
      if (!prompt) throw new Error("image_prompt_required");
      const references = [...new Set([
        ...(Array.isArray(input.referenceImages) ? input.referenceImages : []),
        ...(Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : []),
        ...(text(input.inputImageUrl) ? [text(input.inputImageUrl)] : []),
      ].flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []))].slice(0, 3);
      const model = request.modelId.toLowerCase();
      if (model.includes("qwen-image") && /(?:-edit|image-to-image|img2img)/iu.test(model) && references.length === 0) throw new Error("image_reference_required");
      const parameters: Record<string, unknown> = {
        size: text(input.size).replace(/x/giu, "*") || "1024*1024",
        n: Math.max(1, Math.min(model.includes("qwen-image") ? 6 : 4, Math.floor(numberValue(input.n, 1)))),
        ...(text(input.style) ? { style: text(input.style) } : {}),
        ...(text(input.negativePrompt) ? { negative_prompt: text(input.negativePrompt) } : {}),
        ...(input.promptExtend !== undefined ? { prompt_extend: input.promptExtend === true || text(input.promptExtend).toLowerCase() === "true" } : {}),
        ...(input.watermark !== undefined ? { watermark: input.watermark === true || text(input.watermark).toLowerCase() === "true" } : {}),
        ...(input.seed !== undefined && Number.isFinite(Number(input.seed)) ? { seed: Math.max(0, Math.floor(Number(input.seed))) } : {}),
      };
      const useMultimodal = references.length > 0 || model.includes("qwen-image");
      const resolvedReferences = await Promise.all(references.map((reference) => resolveProviderImageReference(reference, options, cancellation, input.workflowLocalAttachments === true, 10 * 1024 * 1024)));
      const body = useMultimodal
        ? {
            model: request.modelId,
            input: { messages: [{ role: "user", content: [...resolvedReferences.map((image) => ({ image })), { text: prompt }] }] },
            parameters,
          }
        : {
            model: request.modelId,
            input: { prompt },
            parameters,
          };
      const payload = await jsonRequest(options, useMultimodal ? "/api/v1/services/aigc/multimodal-generation/generation" : "/api/v1/services/aigc/text2image/image-synthesis", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { ...(useMultimodal ? {} : { "X-DashScope-Async": "enable" }), ...(request.idempotencyKey ? { "X-Request-ID": request.idempotencyKey } : {}) },
      }, cancellation, undefined, options.requestTimeoutMs ?? IMAGE_GENERATION_REQUEST_TIMEOUT_MS);
      return asTask(options.provider, payload);
    },
    query: async (providerTaskId, cancellation) => asTask(options.provider, await jsonRequest(options, `/api/v1/tasks/${encodeURIComponent(providerTaskId)}`, { method: "GET" }, cancellation), providerTaskId),
  };
}

/** Direct DashScope/Bailian async video adapter. It intentionally contains no SaaS/database imports. */
export function createBailianVideoAdapter(options: DirectProviderOptions): MediaProviderAdapter {
  return {
    provider: options.provider,
    execute: async (request, cancellation) => {
      const input = request.input as Record<string, unknown>;
      const model = request.modelId;
      const prompt = text(input.prompt);
      const explicitFeature = text(input.featureId) || text(input.mode);
      const referenceVideoInputs = Array.isArray(input.referenceVideoUrls) ? input.referenceVideoUrls : [];
      const referenceAudioInputs = Array.isArray(input.referenceAudioUrls) ? input.referenceAudioUrls : [];
      const feature = ["text-to-video", "image-to-video", "reference-to-video", "video-edit"].includes(explicitFeature)
        ? explicitFeature
        : text(input.sourceVideoUrl) ? "video-edit" : Array.isArray(input.referenceImageUrls) && input.referenceImageUrls.length ? "reference-to-video" : referenceVideoInputs.length || referenceAudioInputs.length ? "reference-to-video" : text(input.firstFrameUrl) ? "image-to-video" : "text-to-video";
      if (!prompt && feature !== "image-to-video") throw new Error("video_prompt_required");
      const parameters: Record<string, unknown> = {
        resolution: text(input.resolution).toUpperCase() === "720P" ? "720P" : "1080P",
        ...(feature !== "video-edit" ? { ratio: text(input.ratio) || "16:9", duration: Math.max(3, Math.min(15, numberValue(input.duration, 5))) } : {}),
        ...(input.watermark !== undefined ? { watermark: input.watermark === true || text(input.watermark).toLowerCase() === "true" } : {}),
        ...(text(input.audioSetting) ? { audio_setting: text(input.audioSetting) } : {}),
        ...(input.seed !== undefined && Number.isFinite(Number(input.seed)) ? { seed: Math.max(0, Math.floor(Number(input.seed))) } : {}),
      };
      const media: Array<Record<string, string>> = [];
      const wan3Model = text(model).toLowerCase().includes("wan3");
      if (feature === "video-edit" && text(input.sourceVideoUrl)) {
        const url = await resolveDashScopeMediaReference(text(input.sourceVideoUrl), text(model), options, cancellation, "video");
        media.push({ type: wan3Model ? (isDashScopeTemporaryUrl(url) ? "file" : "link") : "video", url });
      }
      if ((feature === "image-to-video" || feature === "reference-to-video") && text(input.firstFrameUrl)) media.push({ type: "first_frame", url: text(input.firstFrameUrl) });
      if (feature === "image-to-video" && text(input.lastFrameUrl)) media.push({ type: "last_frame", url: text(input.lastFrameUrl) });
      const referenceImages = Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : [];
      if (feature === "reference-to-video" || feature === "video-edit") {
        for (const value of referenceImages) if (typeof value === "string" && value.trim()) media.push({ type: "reference_image", url: await resolveDashScopeMediaReference(value.trim(), text(model), options, cancellation, "image") });
      }
      if ((feature === "reference-to-video" || feature === "video-edit") && (referenceVideoInputs.length || referenceAudioInputs.length) && !wan3Model) throw new Error("provider_media_role_unsupported:video.reference");
      if (feature === "reference-to-video" || feature === "video-edit") {
        for (const value of referenceVideoInputs) if (typeof value === "string" && value.trim()) media.push({ type: "reference_video", url: await resolveDashScopeMediaReference(value.trim(), text(model), options, cancellation, "video") });
        for (const value of referenceAudioInputs) if (typeof value === "string" && value.trim()) media.push({ type: "reference_audio", url: await resolveDashScopeMediaReference(value.trim(), text(model), options, cancellation, "audio") });
      }
      if (feature === "image-to-video" || feature === "reference-to-video") {
        for (const key of ["first_frame", "last_frame"] as const) {
          const index = media.findIndex((item) => item.type === key);
          if (index < 0) continue;
          const value = media[index]?.url;
          if (value) media[index] = { type: key, url: await resolveDashScopeMediaReference(value, text(model), options, cancellation, "image") };
        }
      }
      if (wan3Model && media.some((item) => item.type === "first_frame" || item.type === "last_frame") && media.some((item) => item.type === "reference_image" || item.type === "reference_video" || item.type === "reference_audio")) {
        throw new Error("provider_media_combination_unsupported:wan3_frames_with_references");
      }
      const body = { model, input: { ...(prompt ? { prompt } : {}), ...(media.length ? { media } : {}) }, parameters };
      const usesTemporaryFile = media.some((item) => isDashScopeTemporaryUrl(item.url));
      const payload = await jsonRequest(options, "/api/v1/services/aigc/video-generation/video-synthesis", { method: "POST", body: JSON.stringify(body), headers: { "X-DashScope-Async": "enable", ...(usesTemporaryFile ? { "X-DashScope-OssResourceResolve": "enable" } : {}), ...(request.idempotencyKey ? { "X-Request-ID": request.idempotencyKey } : {}) } }, cancellation);
      return asTask(options.provider, payload);
    },
    query: async (providerTaskId, cancellation) => asTask(options.provider, await jsonRequest(options, `/api/v1/tasks/${encodeURIComponent(providerTaskId)}`, { method: "GET" }, cancellation), providerTaskId),
  };
}

/** Direct MiniMax video adapter for official text/image-to-video endpoints. */
export function createMiniMaxVideoAdapter(options: DirectProviderOptions): MediaProviderAdapter {
  return {
    provider: options.provider,
    execute: async (request, cancellation) => {
      const input = request.input as Record<string, unknown>;
      const workflowLocalAttachments = input.workflowLocalAttachments === true;
      const firstFrameImage = text(input.firstFrameUrl) ? await resolveProviderImageReference(text(input.firstFrameUrl), options, cancellation, workflowLocalAttachments, 20 * 1024 * 1024) : undefined;
      const lastFrameImage = text(input.lastFrameUrl) ? await resolveProviderImageReference(text(input.lastFrameUrl), options, cancellation, workflowLocalAttachments, 20 * 1024 * 1024) : undefined;
      const body = { model: request.modelId || "MiniMax-Hailuo-2.3", prompt: text(input.prompt) || "Create a polished marketing video with smooth cinematic motion.", duration: Math.max(6, Math.min(10, numberValue(input.duration, 6))), resolution: text(input.resolution) || "768P", prompt_optimizer: true, ...(firstFrameImage ? { first_frame_image: firstFrameImage } : {}), ...(lastFrameImage ? { last_frame_image: lastFrameImage } : {}) };
      const payload = await jsonRequest(options, "/video_generation", { method: "POST", body: JSON.stringify(body), headers: request.idempotencyKey ? { "X-Request-ID": request.idempotencyKey } : {} }, cancellation);
      const task = asTask(options.provider, payload);
      const fileId = text((payload.output as Record<string, unknown> | undefined)?.file_id) || text(payload.file_id);
      return fileId && task.outputs.length === 0 ? { ...task, outputs: [{ url: providerUrl(options.baseUrl, "/files/retrieve", { file_id: fileId }).toString() }] } : task;
    },
    query: async (providerTaskId, cancellation) => asTask(options.provider, await jsonRequest(options, "/query/video_generation", { method: "GET" }, cancellation, { task_id: providerTaskId }), providerTaskId),
  };
}

/** Direct MiniMax async speech/music adapter. Music may return a synchronous base64 payload. */
export function createMiniMaxAudioAdapter(options: DirectProviderOptions): MediaProviderAdapter {
  return {
    provider: options.provider,
    execute: async (request, cancellation) => {
      const input = request.input as Record<string, unknown>;
      const featureId = text(input.featureId);
      if (featureId === "voice-clone" || text(input.kind) === "voice_clone") {
        let sourceFileId = text(input.sourceFileId);
        if (!sourceFileId) {
          const attachments = Array.isArray(input.localAttachments) ? input.localAttachments.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
          const sourceFilePath = text(input.sourceFilePath) || attachments[0] || "";
          if (!sourceFilePath) throw new Error("voice_clone_source_file_required");
          sourceFileId = await uploadMiniMaxFile(options, sourceFilePath, cancellation, input.workflowLocalAttachments === true);
        }
        if (!sourceFileId) throw new Error("voice_clone_source_file_required");
        const numericSourceFileId = Number(sourceFileId);
        if (!Number.isSafeInteger(numericSourceFileId) || numericSourceFileId <= 0) throw new Error("voice_clone_source_file_invalid");
        const voiceId = text(input.voiceId) || `desktop-voice-${Date.now()}`;
        const body: Record<string, unknown> = {
          file_id: numericSourceFileId,
          voice_id: voiceId,
          need_noise_reduction: String(input.needNoiseReduction ?? "false") === "true",
          need_volume_normalization: String(input.needVolumeNormalization ?? "false") === "true",
          aigc_watermark: false,
        };
        const previewText = text(input.previewText) || text(input.prompt);
        if (previewText) {
          body.text = previewText;
          body.model = request.modelId || "speech-2.8-turbo";
          body.language_boost = text(input.languageBoost) || "auto";
        }
        const promptAudioFileId = text(input.promptAudioFileId);
        const promptText = text(input.promptText);
        if (promptAudioFileId && promptText) {
          const numericPromptAudioFileId = Number(promptAudioFileId);
          if (!Number.isSafeInteger(numericPromptAudioFileId) || numericPromptAudioFileId <= 0) throw new Error("voice_clone_prompt_audio_invalid");
          body.clone_prompt = { prompt_audio: numericPromptAudioFileId, prompt_text: promptText };
        }
        const payload = await jsonRequest(options, "/voice_clone", { method: "POST", body: JSON.stringify(body) }, cancellation);
        const task = asTask(options.provider, payload);
        const previewUrl = text(payload.demo_audio);
        return {
          ...task,
          status: "succeeded",
          outputs: [...task.outputs, ...(previewUrl ? [{ url: previewUrl }] : []), { voiceId }],
        };
      }
      const kind = text(input.kind) || (featureId === "ai-music" ? "music" : "speech");
      const path = kind === "music" ? "/music_generation" : "/t2a_async_v2";
      const payload = await jsonRequest(options, path, { method: "POST", body: JSON.stringify({ model: request.modelId, ...input }) }, cancellation);
      const task = asTask(options.provider, payload);
      const audio = text((payload.data as Record<string, unknown> | undefined)?.audio);
      if (kind === "music" && audio) return { ...task, status: "succeeded", outputs: [{ b64_json: audio }] };
      // A TTS acknowledgement with only a task ID is not a finished result.
      // Poll it even when the provider omitted an explicit Pending status.
      return task.providerTaskId && task.outputs.length === 0 ? { ...task, status: "queued" } : task;
    },
    query: async (providerTaskId, cancellation) => {
      const payload = await jsonRequest(options, "/query/t2a_async_query_v2", { method: "GET" }, cancellation, { task_id: providerTaskId });
      const task = asTask(options.provider, payload, providerTaskId);
      const fileId = text((payload as Record<string, unknown>).file_id) || text((payload.data as Record<string, unknown> | undefined)?.file_id);
      return fileId && task.status === "succeeded" ? { ...task, outputs: [{ url: providerUrl(options.baseUrl, "/files/retrieve_content", { file_id: fileId }).toString() }] } : task;
    },
  };
}

/** Direct RunningHub task adapter. Endpoint selection stays in desktop config so no cloud defaults are hidden. */
export function createRunningHubAdapter(options: DirectProviderOptions & { readonly submitPath: string; readonly queryPath?: string }): MediaProviderAdapter {
  const queryPath = options.queryPath || "/openapi/v2/query";
  const map = (payload: Record<string, unknown>, fallbackId?: string): MediaTask => {
    const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
    const status = data.status ?? data.taskStatus ?? data.task_status ?? payload.status ?? payload.taskStatus ?? payload.task_status;
    const task = asTask(options.provider, { ...payload, ...data }, fallbackId);
    const results = Array.isArray(data.results) ? data.results : Array.isArray(data.output) ? data.output : Array.isArray(payload.results) ? payload.results : [];
    const outputs = results.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const url = text(value.url ?? value.uri ?? value.video_url ?? value.videoUrl ?? value.file_url ?? value.fileUrl ?? value.download_url ?? value.downloadUrl);
      return url ? [{ url }] : [];
    });
    const mappedStatus = mapProviderStatus(status);
    // Some RunningHub workflows acknowledge submission as SUCCESS before the
    // result URLs are attached. Keep polling until a terminal result includes
    // an output, otherwise the host would attempt to download an empty task.
    const statusWithoutOutputs = task.providerTaskId && outputs.length === 0 && mappedStatus === "succeeded" ? "queued" : mappedStatus;
    return { ...task, status: statusWithoutOutputs, ...(outputs.length ? { outputs } : {}) };
  };
  const mapInput = (input: Record<string, unknown>) => {
    if (!options.submitPath.toLowerCase().includes("minimax/hailuo-h3/multimodal-to-video")) return input;
    const mapped: Record<string, unknown> = { prompt: input.prompt, resolution: input.resolution, duration: input.duration, ratio: input.ratio };
    const imageUrls = [
      ...(typeof input.firstFrameUrl === "string" && input.firstFrameUrl.trim() ? [input.firstFrameUrl.trim()] : []),
      ...(Array.isArray(input.imageUrls) ? input.imageUrls : []),
      ...(Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : []),
    ].filter((value, index, values): value is string => typeof value === "string" && Boolean(value.trim()) && values.indexOf(value) === index);
    if (imageUrls.length > 9) throw new Error("workflow_media_role_limit:image.input:9");
    if (imageUrls.length) mapped.imageUrls = imageUrls;
    if (Array.isArray(input.referenceVideoUrls) && input.referenceVideoUrls.length) mapped.videoUrls = input.referenceVideoUrls;
    if (Array.isArray(input.referenceAudioUrls) && input.referenceAudioUrls.length) mapped.audioUrls = input.referenceAudioUrls;
    if (input.watermark !== undefined) mapped.aigc_watermark = input.watermark;
    return Object.fromEntries(Object.entries(mapped).filter(([, value]) => value !== undefined && value !== ""));
  };
  return {
    provider: options.provider,
    execute: async (request, cancellation) => map(await jsonRequest(options, options.submitPath, { method: "POST", body: JSON.stringify({ ...mapInput(request.input as Record<string, unknown>), ...(request.idempotencyKey ? { clientRequestId: request.idempotencyKey } : {}) }) }, cancellation)),
    query: async (providerTaskId, cancellation) => map(await jsonRequest(options, queryPath, { method: "POST", body: JSON.stringify({ taskId: providerTaskId }) }, cancellation), providerTaskId),
  };
}

/** RunningHub's digital-human product is a workflow submission, not a video model endpoint. */
export function createRunningHubDigitalHumanAdapter(options: DirectProviderOptions & { readonly workflowId: string; readonly submitPath?: string; readonly queryPath?: string }): MediaProviderAdapter {
  const submitPath = options.submitPath || "/task/openapi/create";
  const queryPath = options.queryPath || "/openapi/v2/query";
  const map = (payload: Record<string, unknown>, fallbackId?: string) => {
    const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
    return asTask(options.provider, { ...payload, ...data }, fallbackId);
  };
  return {
    provider: options.provider,
    execute: async (request, cancellation) => {
      const input = request.input as Record<string, unknown>;
      const avatar = text(input.avatarImageUrl);
      const audio = text(input.audioUrl);
      const script = text(input.script) || text(input.prompt);
      if (!avatar) throw new Error("digital_human_avatar_required");
      if (!audio && !script) throw new Error("digital_human_audio_or_script_required");
      const payload = {
        apiKey: options.apiKey,
        workflowId: options.workflowId,
        nodeInfoList: [
          { nodeId: "243", fieldName: "audio", fieldValue: audio },
          { nodeId: "244", fieldName: "string", fieldValue: script },
          { nodeId: "288", fieldName: "index", fieldValue: audio ? 0 : 1 },
          { nodeId: "343", fieldName: "image", fieldValue: avatar },
          { nodeId: "349", fieldName: "value", fieldValue: text(input.scenePrompt) || "产品展示" },
          { nodeId: "128", fieldName: "seed", fieldValue: Math.max(0, Math.floor(numberValue(input.seed, 0))) },
        ],
        ...(request.idempotencyKey ? { clientRequestId: request.idempotencyKey } : {}),
      };
      let response: Record<string, unknown>;
      try {
        response = await jsonRequest(options, submitPath, { method: "POST", body: JSON.stringify(payload) }, cancellation);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/media_provider_http_(?:401|403|404)/u.test(message)) {
          throw new Error("runninghub_workflow_not_accessible: current API key cannot access the configured workflow");
        }
        throw error;
      }
      const data = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : response;
      const code = finiteNumber(response.code);
      const taskId = text(data.taskId ?? data.task_id ?? response.taskId ?? response.task_id);
      if ((code !== undefined && code !== 0) || !taskId) {
        const detail = text(response.message ?? response.msg ?? data.message ?? data.msg).slice(0, 180);
        throw new Error(`runninghub_workflow_not_accessible: current API key cannot access workflow ${options.workflowId}${detail ? ` (${detail})` : ""}`);
      }
      return map(response);
    },
    query: async (providerTaskId, cancellation) => map(await jsonRequest(options, queryPath, { method: "POST", body: JSON.stringify({ taskId: providerTaskId }) }, cancellation), providerTaskId),
  };
}

export type RunningHubWorkflowBinding = {
  readonly inputId: string;
  readonly nodeId: string;
  readonly fieldName: string;
  readonly valueType: "literal" | "file" | "file_list" | "reference";
  readonly transform?: "string" | "number" | "boolean" | "json";
  readonly defaultValue?: unknown;
};

/** Generic ComfyUI/RunningHub workflow adapter. The desktop registry owns the
 * binding schema; this adapter only submits the resolved node values. */
export function createRunningHubWorkflowAdapter(options: DirectProviderOptions & { readonly workflowId: string; readonly bindings: readonly RunningHubWorkflowBinding[]; readonly submitPath?: string; readonly queryPath?: string }): MediaProviderAdapter {
  const submitPath = options.submitPath || "/task/openapi/create";
  const queryPath = options.queryPath || "/openapi/v2/query";
  const map = (payload: Record<string, unknown>, fallbackId?: string) => {
    const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
    return asTask(options.provider, { ...payload, ...data }, fallbackId);
  };
  return {
    provider: options.provider,
    execute: async (request, cancellation) => {
      const input = request.input as Record<string, unknown>;
      const nodeInfoList = options.bindings.flatMap((binding) => {
        const raw = input[binding.inputId] ?? binding.defaultValue;
        if (raw === undefined || raw === null || raw === "") return [];
        const values = binding.valueType === "file_list" ? (Array.isArray(raw) ? raw : [raw]) : binding.valueType === "file" && Array.isArray(raw) ? raw.slice(0, 1) : [raw];
        return values.map((value) => ({ nodeId: binding.nodeId, fieldName: binding.fieldName, fieldValue: binding.transform === "number" ? Number(value) : binding.transform === "boolean" ? Boolean(value) : binding.transform === "json" ? JSON.stringify(value) : typeof value === "object" && value !== null ? (value as Record<string, unknown>).fileName ?? (value as Record<string, unknown>).url ?? value : value }));
      });
      if (!nodeInfoList.length) throw new Error("runninghub_workflow_inputs_empty");
      const payload = { apiKey: options.apiKey, workflowId: options.workflowId, nodeInfoList, ...(request.idempotencyKey ? { clientRequestId: request.idempotencyKey } : {}) };
      try {
        return map(await jsonRequest(options, submitPath, { method: "POST", body: JSON.stringify(payload) }, cancellation));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/media_provider_http_(?:401|403|404)/u.test(message)) throw new Error("runninghub_workflow_not_accessible: current API key cannot access the configured workflow");
        throw error;
      }
    },
    query: async (providerTaskId, cancellation) => map(await jsonRequest(options, queryPath, { method: "POST", body: JSON.stringify({ taskId: providerTaskId }) }, cancellation), providerTaskId),
  };
}

export interface DownloadedMediaArtifact { readonly relativePath: string; readonly bytes: number; readonly sha256: string; readonly contentType?: string; }

function extensionForMediaContentType(contentType: string | undefined) {
  switch (contentType?.toLowerCase()) {
    case "audio/mpeg":
    case "audio/mp3": return ".mp3";
    case "audio/wav":
    case "audio/x-wav": return ".wav";
    case "audio/ogg": return ".ogg";
    case "audio/mp4": return ".m4a";
    case "video/mp4": return ".mp4";
    case "video/webm": return ".webm";
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/webp": return ".webp";
    case "image/gif": return ".gif";
    default: return ".bin";
  }
}

function mediaContentTypeForExtension(extension: string) {
  switch (extension.toLowerCase()) {
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".ogg": return "audio/ogg";
    case ".m4a": return "audio/mp4";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".tif":
    case ".tiff": return "image/tiff";
    default: return undefined;
  }
}

function decodeDataUrl(value: string): { readonly bytes: Uint8Array; readonly contentType?: string } | undefined {
  if (value.slice(0, 5).toLowerCase() !== "data:") return undefined;
  const separator = value.indexOf(",");
  if (separator < 0) throw new Error("media_download_data_url_invalid");
  const metadata = value.slice(5, separator);
  const encoded = value.slice(separator + 1);
  const metadataParts = metadata.split(";");
  const contentType = metadataParts[0]?.trim().toLowerCase() || undefined;
  try {
    const bytes = metadataParts.some((part) => part.trim().toLowerCase() === "base64")
      ? new Uint8Array(Buffer.from(encoded, "base64"))
      : new TextEncoder().encode(decodeURIComponent(encoded));
    if (!bytes.byteLength) throw new Error("media_download_data_url_empty");
    return { bytes, ...(contentType ? { contentType } : {}) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("media_download_data_url_")) throw error;
    throw new Error("media_download_data_url_invalid", { cause: error });
  }
}

async function detectMediaFileSignature(filePath: string) {
  const fs = await import("node:fs/promises");
  const source = await fs.open(filePath, "r");
  try {
    const bytes = new Uint8Array(new ArrayBuffer(16));
    const { bytesRead } = await source.read(bytes, 0, bytes.length, 0);
    const header = bytes.subarray(0, bytesRead);
    const startsWith = (...signature: number[]) => signature.every((value, index) => header[index] === value);
    const ascii = (start: number, end: number) => String.fromCharCode(...header.subarray(start, end));
    if (header.length >= 8 && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { extension: ".png", contentType: "image/png" };
    if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return { extension: ".jpg", contentType: "image/jpeg" };
    if (header.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { extension: ".webp", contentType: "image/webp" };
    if (header.length >= 6 && /^GIF8[79]a$/u.test(ascii(0, 6))) return { extension: ".gif", contentType: "image/gif" };
    if (header.length >= 12 && ascii(4, 8) === "ftyp") return { extension: ".mp4", contentType: "video/mp4" };
    if (header.length >= 4 && startsWith(0x1a, 0x45, 0xdf, 0xa3)) return { extension: ".webm", contentType: "video/webm" };
    if (header.length >= 3 && ascii(0, 3) === "ID3") return { extension: ".mp3", contentType: "audio/mpeg" };
    if (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return { extension: ".mp3", contentType: "audio/mpeg" };
    if (header.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { extension: ".wav", contentType: "audio/wav" };
    if (header.length >= 4 && ascii(0, 4) === "OggS") return { extension: ".ogg", contentType: "audio/ogg" };
    return undefined;
  } finally {
    await source.close().catch(() => undefined);
  }
}

async function extractSingleTarMedia(filePath: string, maxBytes: number) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const crypto = await import("node:crypto");
  const source = await fs.open(filePath, "r");
  try {
    let headerOffset = 0;
    for (let entryIndex = 0; entryIndex < 64; entryIndex += 1) {
      const headerBytes = new Uint8Array(new ArrayBuffer(512));
      const { bytesRead } = await source.read(headerBytes, 0, headerBytes.length, headerOffset);
      const header = Buffer.from(headerBytes.buffer);
      if (bytesRead !== header.length || header.every((byte) => byte === 0)) return undefined;
      if (header.subarray(257, 262).toString("ascii") !== "ustar") return undefined;
      const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "").trim();
      const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim();
      const size = Number.parseInt(sizeText || "0", 8);
      if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) throw new Error("media_download_tar_entry_invalid");
      const type = header[156];
      const dataOffset = headerOffset + 512;
      const extension = path.extname(name).toLowerCase();
      if ((type === 0 || type === 48) && mediaContentTypeForExtension(extension)) {
        const extractedPath = `${filePath}.media`;
        const target = await fs.open(extractedPath, "w");
        const hash = crypto.createHash("sha256");
        try {
          const buffer = new Uint8Array(new ArrayBuffer(64 * 1024));
          let copied = 0;
          while (copied < size) {
            const requested = Math.min(buffer.length, size - copied);
            const result = await source.read(buffer, 0, requested, dataOffset + copied);
            if (!result.bytesRead) throw new Error("media_download_tar_truncated");
            const chunk = buffer.subarray(0, result.bytesRead);
            await target.write(chunk);
            hash.update(chunk);
            copied += result.bytesRead;
          }
          await target.sync();
        } catch (error) {
          await target.close().catch(() => undefined);
          await fs.rm(extractedPath, { force: true }).catch(() => undefined);
          throw error;
        }
        await target.close();
        await fs.rm(filePath, { force: true });
        await fs.rename(extractedPath, filePath);
        return { byteLength: size, digest: hash.digest("hex"), extension, contentType: mediaContentTypeForExtension(extension) };
      }
      headerOffset = dataOffset + Math.ceil(size / 512) * 512;
    }
    throw new Error("media_download_tar_entry_missing");
  } finally {
    await source.close().catch(() => undefined);
  }
}

/** Downloads provider URLs before a task is considered durable. */
export async function downloadMediaOutputs(task: MediaTask, directory: string, options: { readonly fetchImpl?: typeof fetch; readonly filenamePrefix?: string; readonly maxBytes?: number; readonly allowedContentTypes?: readonly string[]; readonly tempDirectory?: string } = {}): Promise<readonly DownloadedMediaArtifact[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const crypto = await import("node:crypto");
  const tempDirectory = options.tempDirectory ?? directory;
  await fs.mkdir(directory, { recursive: true });
  if (tempDirectory !== directory) await fs.mkdir(tempDirectory, { recursive: true });
  const artifacts: DownloadedMediaArtifact[] = [];
  try {
    for (const [index, output] of task.outputs.entries()) {
      const url = typeof output.url === "string" ? output.url : typeof output.uri === "string" ? output.uri : undefined;
      const encoded = typeof output.b64_json === "string" ? output.b64_json : typeof output.base64 === "string" ? output.base64 : undefined;
      if (!url && !encoded) continue;
      const dataUrl = url ? decodeDataUrl(url) : undefined;
      const response = url && !dataUrl ? await fetchImpl(url) : undefined;
      if (response && (!response.ok || !response.body)) throw new Error(`media_download_http_${response.status}`);
      const contentType = dataUrl?.contentType ?? response?.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType && options.allowedContentTypes?.length && !options.allowedContentTypes.some((allowed) => contentType === allowed.toLowerCase() || contentType.startsWith(`${allowed.toLowerCase()}/`))) throw new Error(`media_download_mime_rejected:${contentType}`);
      const maxBytes = Math.max(1, options.maxBytes ?? 512 * 1024 * 1024);
      const advertisedBytes = dataUrl?.bytes.byteLength ?? Number(response?.headers.get("content-length") ?? 0);
      if (advertisedBytes > maxBytes) throw new Error("media_download_too_large");
      const temporary = path.join(tempDirectory, `${options.filenamePrefix ?? "media"}-${index + 1}-${Date.now()}-${process.pid}.tmp`);
      let name = "";
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
      let digest = "";
      let byteLength = 0;
      let artifactContentType = contentType;
      try {
        const hash = crypto.createHash("sha256");
        handle = await fs.open(temporary, "w");
        if (dataUrl || encoded) {
          const bytes = dataUrl?.bytes ?? new Uint8Array(Buffer.from(encoded!, "base64"));
          if (bytes.byteLength > maxBytes) throw new Error("media_download_too_large");
          await handle.write(bytes as unknown as Uint8Array<ArrayBuffer>);
          hash.update(bytes as unknown as Uint8Array<ArrayBuffer>);
          byteLength = bytes.byteLength;
        } else {
          const reader = response!.body!.getReader();
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              const chunk = next.value;
              byteLength += chunk.byteLength;
              if (byteLength > maxBytes) throw new Error("media_download_too_large");
              await handle.write(chunk);
              hash.update(chunk);
            }
          } finally {
            reader.releaseLock();
          }
        }
        await handle.sync();
        await handle.close();
        handle = undefined;
        digest = hash.digest("hex");
        const urlExtension = url && !dataUrl ? path.extname(new URL(url).pathname) : "";
        const extractedTar = await extractSingleTarMedia(temporary, maxBytes);
        if (extractedTar) {
          byteLength = extractedTar.byteLength;
          digest = extractedTar.digest;
          artifactContentType = extractedTar.contentType;
        }
        const detectedMedia = extractedTar ? undefined : await detectMediaFileSignature(temporary);
        if (detectedMedia) artifactContentType = detectedMedia.contentType;
        const extension = extractedTar?.extension ?? detectedMedia?.extension ?? (urlExtension && urlExtension !== ".bin" ? urlExtension : extensionForMediaContentType(contentType));
        name = `${options.filenamePrefix ?? "media"}-${index + 1}-${digest.slice(0, 12)}${extension}`;
        const target = path.join(directory, name);
        const targetExists = await fs.access(target).then(() => true).catch(() => false);
        if (targetExists) {
          // A retry is allowed to refresh an existing same-name output. This
          // is especially important on Windows, where rename does not replace
          // an existing target like POSIX rename does.
          await fs.copyFile(temporary, target);
          await fs.rm(temporary, { force: true });
        } else {
          try {
            await fs.rename(temporary, target);
          } catch (error) {
            // Multiple workflow retries can finish the same content-addressed
            // output concurrently. The existence check above is intentionally
            // only an optimization; another attempt may win the rename between
            // the check and the commit. If the target is now present, the
            // artifact is already durable and this attempt can be idempotent.
            const targetCreatedByConcurrentAttempt = await fs.access(target).then(() => true).catch(() => false);
            if (!targetCreatedByConcurrentAttempt) throw error;
            await fs.copyFile(temporary, target);
            await fs.rm(temporary, { force: true });
          }
        }
      } catch (error) {
        if (handle) await handle.close().catch(() => undefined);
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
      artifacts.push({ relativePath: name, bytes: byteLength, sha256: digest, ...(artifactContentType ? { contentType: artifactContentType } : {}) });
    }
    return artifacts;
  } finally {
    if (tempDirectory !== directory) await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runMediaJob(adapter: MediaProviderAdapter, request: MediaRequest, cancellation: CancellationPort, options: MediaPollingOptions = {}): Promise<MediaTask> {
  let task = normalizeMediaTask(options.initialTask ?? await adapter.execute(request, cancellation));
  if (!options.initialTask) await options.onSubmitted?.(task);
  await options.onUpdate?.(task);
  if (isMediaTerminal(task.status) || !adapter.query) return task;
  let cancelPromise: Promise<void> | undefined;
  const onAbort = () => {
    if (!adapter.cancel || isMediaTerminal(task.status) || cancelPromise) return;
    // The provider cancel request must still be sent after the local run is
    // aborted. Reusing the aborted port makes every provider client throw
    // before its HTTP request is issued.
    const cancelPort: CancellationPort = { throwIfCancelled: () => undefined };
    cancelPromise = Promise.resolve(adapter.cancel(task.providerTaskId, cancelPort)).then(() => undefined).catch(() => undefined);
  };
  cancellation.signal?.addEventListener("abort", onAbort, { once: true });
  const deadline = Date.now() + Math.max(1000, options.timeoutMs ?? 30 * 60 * 1000);
  try {
    while (!isMediaTerminal(task.status)) {
      cancellation.throwIfCancelled();
      if (Date.now() >= deadline) throw new Error("media_poll_timeout");
      await new Promise((resolve) => setTimeout(resolve, Math.max(10, options.pollIntervalMs ?? 1000)));
      task = normalizeMediaTask(await adapter.query(task.providerTaskId, cancellation));
      await options.onUpdate?.(task);
    }
  } finally {
    cancellation.signal?.removeEventListener("abort", onAbort);
  }
  return task;
}

export interface MediaJobRecord {
  readonly runId: string;
  readonly nodeId: string;
  readonly idempotencyKey: string;
  readonly provider: MediaProviderId;
  readonly providerTaskId?: string;
  readonly status: MediaTaskStatus | "interrupted";
  readonly submittedAt: string;
  readonly updatedAt: string;
}

export function createMediaIdempotencyKey(runId: string, nodeId: string, attempt: number) {
  return `${runId}:${nodeId}:${Math.max(1, Math.floor(attempt))}`;
}

export function isMediaTerminal(status: MediaTaskStatus | "interrupted") {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function recoverMediaJob(record: MediaJobRecord): "poll" | "submit" | "done" {
  if (isMediaTerminal(record.status)) return "done";
  if (record.providerTaskId) return "poll";
  return "submit";
}

export function normalizeMediaTask(task: MediaTask): MediaTask {
  const status: MediaTaskStatus = ["queued", "running", "succeeded", "failed", "cancelled"].includes(task.status) ? task.status : "failed";
  return { providerTaskId: task.providerTaskId.trim(), status, ...(task.providerStatus ? { providerStatus: task.providerStatus.slice(0, 160) } : {}), ...(task.error ? { error: task.error.slice(0, 240) } : {}), outputs: task.outputs.map((output) => ({ ...output })), ...(task.usage ? { usage: normalizeUsage(task.usage) } : {}) };
}
