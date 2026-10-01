export const RUNTIME_CONTRACT_VERSION = 1 as const;
export const MAX_RUNTIME_MESSAGE_BYTES = 8 * 1024 * 1024;

export type RuntimeId = string & { readonly __runtimeId: unique symbol };

export interface StructuredRuntimeError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type RuntimeCommandName = "chat.run" | "workflow.run" | "run.cancel" | "run.retry" | "health" | "session.create" | "session.prompt";

export interface RuntimeCommand<TPayload = unknown> {
  readonly version: typeof RUNTIME_CONTRACT_VERSION;
  readonly requestId: string;
  readonly runId?: string;
  readonly type: RuntimeCommandName;
  readonly payload: TPayload;
}

export interface RuntimeResponse<TData = unknown> {
  readonly version: typeof RUNTIME_CONTRACT_VERSION;
  readonly requestId: string;
  readonly ok: boolean;
  readonly data?: TData;
  readonly error?: StructuredRuntimeError;
}

export interface RuntimeEventEnvelope<TEvent = unknown> {
  readonly version: typeof RUNTIME_CONTRACT_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly event: TEvent;
}

export interface ArtifactRef {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface UsageRecord {
  readonly usageId?: string;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly estimatedCost?: number;
  readonly aggregation?: "delta" | "snapshot";
  readonly scope?: "step" | "run";
}

export type {
  OpenCodeCommandInput,
  OpenCodeRuntimeEvent,
  OpenCodeServeEventResult,
  OpenCodeServeEventState,
  OpenCodeServeModel,
  OpenCodeServePromptPayloadInput,
  OpenCodeServeSessionPayloadInput,
} from "./opencode";
export {
  buildOpenCodeCommand,
  createOpenCodeEventParser,
  createOpenCodeServeEventState,
  createOpenCodeServePromptPayload,
  createOpenCodeServeSessionPayload,
  normalizeOpenCodeServeEvent,
  openCodeServeSessionPath,
  openCodeServeSessionsPath,
  opencodeRuntimeDefinition,
  readOpenCodeServeSessionId,
} from "./opencode";
export { OpenCodeSessionClient } from "./session";
export type { OpenCodeSessionRef, OpenCodeSessionTransport } from "./session";
