import type { DesktopUIMessage } from "./uimessage";
import type { WorkbenchQuestionClient, WorkbenchQuestionEvent } from "./questions";

export interface NavigationAdapter {
  readonly go: (href: string) => void;
  readonly replace: (href: string) => void;
  readonly current: () => string;
}

export type WorkbenchRole = "system" | "user" | "assistant" | "tool";
export type WorkbenchRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export const WORKBENCH_MESSAGE_PARTS_VERSION = 2 as const;

export type WorkbenchPartStatus = "queued" | "running" | "completed" | "succeeded" | "failed" | "cancelled" | "blocked" | "waiting";

export type WorkbenchPlanStep = {
  readonly id: string;
  readonly title: string;
  readonly status: WorkbenchPartStatus;
  readonly detail?: string;
};

export type WorkbenchTaskStep = WorkbenchPlanStep & { readonly toolName?: string };

export type WorkbenchMessagePartBase = {
  readonly id: string;
  readonly sequence?: number;
  readonly createdAt?: string;
};

export type WorkbenchMessagePart =
  | (WorkbenchMessagePartBase & { readonly type: "text"; readonly text: string })
  | (WorkbenchMessagePartBase & { readonly type: "reasoning"; readonly text: string; readonly status: "running" | "completed" | "failed" })
  | (WorkbenchMessagePartBase & { readonly type: "plan"; readonly title?: string; readonly steps: readonly WorkbenchPlanStep[]; readonly status: WorkbenchPartStatus })
  | (WorkbenchMessagePartBase & { readonly type: "task"; readonly taskId?: string; readonly title: string; readonly steps?: readonly WorkbenchTaskStep[]; readonly status: WorkbenchPartStatus })
  | (WorkbenchMessagePartBase & { readonly type: "tool-call"; readonly toolName: string; readonly toolCallId: string; readonly input?: unknown; readonly output?: unknown; readonly error?: string; readonly status: WorkbenchPartStatus })
  | (WorkbenchMessagePartBase & { readonly type: "attachment"; readonly name: string; readonly mediaType: string; readonly uri?: string; readonly status?: "queued" | "uploading" | "ready" | "failed" })
  | (WorkbenchMessagePartBase & { readonly type: "warning"; readonly message: string })
  | (WorkbenchMessagePartBase & { readonly type: "tool"; readonly tool: string; readonly status: "queued" | "running" | "completed" | "failed"; readonly message?: string })
  | (WorkbenchMessagePartBase & { readonly type: "status"; readonly status: WorkbenchRunStatus; readonly message?: string })
  | (WorkbenchMessagePartBase & { readonly type: "usage"; readonly usage: WorkbenchUsage })
  | (WorkbenchMessagePartBase & { readonly type: "artifact"; readonly artifact: WorkbenchArtifact })
  | (WorkbenchMessagePartBase & { readonly type: "source"; readonly title: string; readonly href?: string; readonly excerpt?: string })
  | (WorkbenchMessagePartBase & { readonly type: "media"; readonly media: { readonly artifactId: string; readonly kind: "image" | "video" | "audio" | "document"; readonly mimeType: string; readonly title: string; readonly relativePath?: string; readonly previewable?: boolean } })
  | (WorkbenchMessagePartBase & { readonly type: "report"; readonly title: string; readonly body?: string; readonly artifact?: WorkbenchArtifact });

export interface WorkbenchMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly role: WorkbenchRole;
  readonly content: string;
  readonly createdAt: string;
  readonly status?: WorkbenchRunStatus;
  readonly partsVersion?: typeof WORKBENCH_MESSAGE_PARTS_VERSION;
  readonly parts?: readonly WorkbenchMessagePart[];
}

export interface WorkbenchConversation {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  /** Persisted local OpenCode session used to continue a conversation after restart. */
  readonly opencodeSessionId?: string;
  /** Agent profile selected when this conversation was created. */
  readonly agentId?: string;
}

export interface WorkbenchConversationMessageCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface WorkbenchConversationMessagesOptions {
  readonly limit?: number;
  readonly before?: WorkbenchConversationMessageCursor;
}

export interface WorkbenchRun {
  readonly id: string;
  readonly conversationId: string;
  readonly status: WorkbenchRunStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly model?: string;
}

export interface WorkbenchRunDetail {
  readonly run: WorkbenchRun;
  readonly nodes: readonly { readonly nodeKey: string; readonly status: string; readonly outputJson?: string | null; readonly updatedAt: string }[];
  readonly events: readonly { readonly sequence: number; readonly eventType: string; readonly payloadJson: string; readonly createdAt: string }[];
  readonly usage: readonly { readonly provider?: string | null; readonly model: string; readonly inputTokens?: number | null; readonly outputTokens?: number | null; readonly providerCost?: number | null; readonly estimatedCost?: number | null; readonly createdAt: string }[];
}

export interface WorkbenchArtifact {
  readonly id: string;
  readonly relativePath: string;
  readonly title: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly createdAt?: string;
  readonly available?: boolean;
}

export interface WorkbenchUsage {
  readonly runId: string;
  readonly provider?: string;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly providerCost?: number;
  readonly estimatedCost?: number;
}

export interface WorkbenchWorkflowDefinition {
  readonly schemaVersion?: number;
  readonly revision?: number;
  readonly definitionHash?: string;
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
}

export interface WorkbenchWorkflow {
  readonly id: string;
  readonly title: string;
  readonly definition: WorkbenchWorkflowDefinition;
  readonly updatedAt: string;
}

export interface WorkbenchWorkflowInput {
  readonly id?: string;
  readonly title: string;
  readonly definition: WorkbenchWorkflowDefinition;
}

export type WorkbenchRunEventMetadata = { readonly sequence?: number; readonly createdAt?: string };

export type WorkbenchRunEvent = WorkbenchRunEventMetadata & (
  | WorkbenchQuestionEvent
  | { readonly type: "text"; readonly delta: string }
  | { readonly type: "reasoning"; readonly delta: string }
  | { readonly type: "plan"; readonly plan: { readonly id: string; readonly title?: string; readonly steps: readonly WorkbenchPlanStep[]; readonly status: WorkbenchPartStatus } }
  | { readonly type: "task"; readonly task: { readonly id: string; readonly taskId?: string; readonly title: string; readonly steps?: readonly WorkbenchTaskStep[]; readonly status: WorkbenchPartStatus } }
  | { readonly type: "tool_call"; readonly toolName: string; readonly toolCallId: string; readonly phase: "started" | "completed" | "failed" | "blocked"; readonly input?: unknown; readonly output?: unknown; readonly error?: string; readonly approvalId?: string; readonly sessionId?: string }
  | { readonly type: "attachment"; readonly attachment: { readonly id: string; readonly name: string; readonly mediaType: string; readonly uri?: string; readonly status?: "queued" | "uploading" | "ready" | "failed" } }
  | { readonly type: "warning"; readonly code: string; readonly message: string }
  | { readonly type: "tool"; readonly tool: string; readonly phase: "started" | "completed" | "failed"; readonly message?: string }
  | { readonly type: "usage"; readonly usage: WorkbenchUsage }
  | { readonly type: "artifact"; readonly artifact: WorkbenchArtifact }
  | { readonly type: "status"; readonly status: WorkbenchRunStatus }
  | { readonly type: "source"; readonly source: { readonly id: string; readonly title: string; readonly href?: string; readonly excerpt?: string } }
  | { readonly type: "media"; readonly media: { readonly artifactId: string; readonly kind: "image" | "video" | "audio" | "document"; readonly mimeType: string; readonly title: string; readonly relativePath?: string; readonly previewable?: boolean } }
);

export interface WorkbenchRunRequest {
  readonly id?: string;
  /** Null for standalone media/workflow tasks that must not create a chat session. */
  readonly conversationId: string | null;
  readonly prompt: string;
  readonly model?: string;
  readonly skillId?: string;
  readonly reasoningEffort?: string;
}

export interface FileActionsAdapter {
  readonly open: (relativePath: string, mimeType?: string) => Promise<void>;
  readonly reveal: (relativePath: string, mimeType?: string) => Promise<void>;
  readonly openFolder?: (relativePath: string, mimeType?: string) => Promise<void>;
  readonly openWith?: (relativePath: string, mimeType?: string) => Promise<void>;
}

export interface ArtifactActionsAdapter {
  readonly list: () => Promise<readonly WorkbenchArtifact[]>;
  readonly remove: (artifactId: string) => Promise<void>;
}

export interface WorkbenchEmbeddingConfig {
  readonly mode: "local" | "remote";
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKey?: string;
}

export interface WorkbenchKnowledgeResult {
  readonly chunkId: string;
  readonly documentPath: string;
  readonly heading?: string;
  readonly excerpt: string;
  readonly score: number;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}

export interface WorkbenchKnowledgeIndex {
  readonly generation: number;
  readonly documents: number;
  readonly chunks: number;
  readonly indexPath: string;
  readonly semantic: boolean;
  readonly embeddingModel?: string;
  readonly embeddingDimension?: number;
  readonly watcher?: string;
}

export interface WorkbenchClient {
  readonly questions?: WorkbenchQuestionClient;
  readonly navigation: NavigationAdapter;
  readonly files: FileActionsAdapter;
  readonly artifacts: ArtifactActionsAdapter;
  readonly knowledge: {
    readonly index: (options: { readonly vaultPath: string; readonly indexPath: string; readonly embedding?: WorkbenchEmbeddingConfig }) => Promise<WorkbenchKnowledgeIndex>;
    readonly search: (options: { readonly indexPath: string; readonly query: string; readonly limit?: number; readonly embedding?: WorkbenchEmbeddingConfig }) => Promise<readonly WorkbenchKnowledgeResult[]>;
    readonly open: (relativePath: string) => Promise<void>;
  };
  readonly conversations: {
    readonly list: () => Promise<readonly WorkbenchConversation[]>;
    readonly create: (title?: string, agentId?: string | null) => Promise<WorkbenchConversation>;
    readonly messages: (conversationId: string, options?: WorkbenchConversationMessagesOptions) => Promise<readonly DesktopUIMessage[]>;
  };
  readonly workflows: {
    readonly list: () => Promise<readonly WorkbenchWorkflow[]>;
    readonly save: (input: WorkbenchWorkflowInput) => Promise<WorkbenchWorkflow>;
    readonly remove: (workflowId: string) => Promise<void>;
  };
  readonly runs: {
    readonly start: (request: WorkbenchRunRequest) => Promise<WorkbenchRun>;
    readonly list: () => Promise<readonly WorkbenchRun[]>;
    readonly inspect: (runId: string) => Promise<WorkbenchRunDetail>;
    readonly cancel: (runId: string) => Promise<void>;
    readonly emergencyStop: (runId: string) => Promise<void>;
    readonly subscribe: (runId: string, onEvent: (event: WorkbenchRunEvent) => void) => () => void;
  };
  readonly usage: {
    readonly list: (conversationId?: string) => Promise<readonly WorkbenchUsage[]>;
  };
}

export * from "./message-parts";
export * from "./questions";
export * from "./uimessage";
export * from "./workflow-ai";
