import type { WorkbenchClient, WorkbenchConversation, WorkbenchRun, WorkbenchRunAttemptSummary, WorkbenchRunDetail } from "@coworkany/workbench-client";
import type { DesktopTaskMetadata } from "../desktop-task-metadata";

export type OfficeRoleId = "ai-chat" | "agent-center" | "ppt-expert" | "workflow-operator" | "writer" | "image-creator" | "video-producer";
export type OfficeStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "unknown";
export type OfficeRoleStatus = "idle" | "offline" | OfficeStatus;
/**
 * Visual states are intentionally narrower than persisted office statuses.  They
 * are renderer-facing facts, not a second source of work state.
 */
export type OfficeVisualState = "idle" | "walk" | "work" | "thinking" | "waiting" | "completed" | "error" | "offline";

/** Normalized character rig contract shared by renderer adapters. */
export interface OfficeRigBone {
  readonly name: string;
  readonly parent: string | null;
  readonly length: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

export interface OfficeRigSlot {
  readonly name: string;
  readonly bone: string;
  readonly zIndex: number;
  readonly blend: "normal" | "additive";
}

export interface OfficeRigKeyframe {
  /** Normalized clip time in the inclusive range [0, 1]. */
  readonly t: number;
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly opacity?: number;
}

export interface OfficeRigClip {
  readonly durationMs: number;
  readonly loop: boolean;
  readonly tracks: Readonly<Record<string, readonly OfficeRigKeyframe[]>>;
}

export interface OfficeRigManifest {
  readonly schemaVersion: number;
  readonly assetId?: string;
  readonly sourcePreview?: string;
  readonly coordinateSystem?: Readonly<Record<string, string>>;
  readonly bones: readonly OfficeRigBone[];
  readonly slots: readonly OfficeRigSlot[];
  readonly textureRegions: Readonly<Record<string, string>>;
  readonly clips: Readonly<Record<string, OfficeRigClip>>;
  readonly reducedMotion: {
    readonly enabledByDefaultWhen?: string;
    readonly staticPoseByClip: Readonly<Record<string, string>>;
    readonly disableStatusFx: boolean;
  };
}

export type OfficeAttention = "user" | "external";
export type OfficeSourceId = "conversations" | "runs" | "run-details" | "attempts" | "agent-directory" | `provider:${string}`;
export type OfficeWorkItemKey = { readonly sourceAdapterId: string; readonly workItemId: string };
export type OfficeRoleAnchor = { readonly x: number; readonly y: number };
export interface OfficeWorkItem extends OfficeWorkItemKey { readonly roleId: OfficeRoleId; readonly status: OfficeStatus; readonly attention?: OfficeAttention; readonly statusVersion: string; readonly title: string; readonly updatedAt: string; readonly routeTarget?: string; readonly artifactIds: readonly string[] }
export interface OfficeDeviceState { readonly deviceId: string; readonly workItemKey: OfficeWorkItemKey; readonly visualStatus: OfficeStatus }
export interface OfficeRoleState { readonly roleId: OfficeRoleId; readonly status: OfficeRoleStatus; readonly activeCount: number; readonly queuedCount: number; readonly waitingUserCount: number; readonly failedCount: number; readonly recentItems: readonly OfficeWorkItem[]; readonly devices: readonly OfficeDeviceState[]; readonly overflowCount: number; readonly available: boolean }
export interface OfficeLayout { readonly roles: Readonly<Record<OfficeRoleId, { readonly x: number; readonly y: number }>>; readonly workstations: Readonly<Record<OfficeRoleId, { readonly x: number; readonly y: number }>> }
export interface RunRecord { readonly run: WorkbenchRun; readonly conversation?: WorkbenchConversation; readonly detail: WorkbenchRunDetail; readonly metadata: DesktopTaskMetadata | null; readonly attempts: readonly WorkbenchRunAttemptSummary[] }
export interface RunRecordSnapshot { readonly records: readonly RunRecord[]; readonly health: readonly OfficeSourceHealth[]; readonly observedAt: string }
export interface OfficeSourceHealth { readonly sourceId: OfficeSourceId; readonly status: "ready" | "unknown" | "offline"; readonly observedAt: string; readonly lastSuccessfulAt?: string; readonly reason?: string }
export interface OfficeHealthSource { readonly id: OfficeSourceId; snapshot(): Promise<OfficeSourceHealth>; clear?(): void }
export interface OfficeRoleAdapter { readonly id: string; toWorkItem(record: RunRecord): OfficeWorkItem | null }
export type OfficeProjectionChange = { readonly kind: "upsert"; readonly item: OfficeWorkItem } | { readonly kind: "remove"; readonly key: OfficeWorkItemKey } | { readonly kind: "source-health"; readonly health: OfficeSourceHealth };
export interface OfficeCapabilities { readonly routes: ReadonlySet<string>; readonly featureFlags: ReadonlySet<string>; readonly runtime: { readonly text: boolean; readonly agents: boolean; readonly workflows: boolean }; readonly providers: Readonly<Record<string, "configured" | "unconfigured" | "unavailable">>; readonly agentDirectoryReady: boolean }
export interface OfficeRoleDefinition { readonly roleId: OfficeRoleId; readonly label: { readonly zh: string; readonly en: string }; readonly homeRoute: string; readonly sourceAdapterId: string; readonly healthSourceIds: readonly OfficeSourceId[]; readonly enabledWhen: (capabilities: OfficeCapabilities) => boolean; readonly workItemRoute: (item: OfficeWorkItem) => string; readonly artifactKinds: readonly ("ppt" | "document" | "image" | "video" | "audio")[]; readonly workstationAssetId: string; readonly characterAssetId: string; readonly deviceLimit: number }
export interface OfficeClock { now(): number; setTimeout(callback: () => void, delayMs: number): unknown; clearTimeout(handle: unknown): void }
export interface RunRecordSource { snapshot(): Promise<RunRecordSnapshot>; subscribeInvalidation(listener: () => void): () => void; clear(): void }
export interface OfficeProjector { hydrate(items: readonly OfficeWorkItem[]): OfficeSnapshot; apply(change: OfficeProjectionChange): OfficeSnapshot; getSnapshot(): OfficeSnapshot; subscribe(listener: () => void): () => void; dispose(): void }
export interface OfficeSnapshot { readonly roles: readonly OfficeRoleState[]; readonly workItems: readonly OfficeWorkItem[]; readonly revision: number }
export interface OfficeStoreOptions { readonly createProjector: () => OfficeProjector; readonly source: RunRecordSource; readonly healthSources: readonly OfficeHealthSource[]; readonly adapters: readonly OfficeRoleAdapter[]; readonly discoveryRefreshMs: number; readonly scheduler: OfficeClock }
export interface OfficeStore { start(): Promise<void>; stop(): void; getSnapshot(): OfficeSnapshot; subscribe(listener: () => void): () => void }
export type ActivateResult = { readonly ok: true; readonly route: string } | { readonly ok: false; readonly reason: "not-found" | "route-unavailable" };
export interface AgentDirectoryEntry { readonly agentId: string; readonly label: string; readonly installed: boolean; readonly availability: "available" | "unavailable" }
export interface AgentDirectorySnapshot { readonly entries: readonly AgentDirectoryEntry[]; readonly runtime: "ready" | "unavailable"; readonly observedAt: string }
export interface AgentRuntimeProbe { readonly ready: boolean; readonly skills?: boolean }
export type AgentDirectoryReadResult = { readonly status: "ready"; readonly snapshot: AgentDirectorySnapshot } | { readonly status: "unknown"; readonly snapshot?: AgentDirectorySnapshot; readonly reason: string } | { readonly status: "offline"; readonly snapshot?: AgentDirectorySnapshot; readonly reason: string };
export interface AgentDirectoryReader { read(options?: { readonly refresh?: boolean }): Promise<AgentDirectoryReadResult>; getSnapshot?: () => AgentDirectoryReadResult | undefined; clear(): void }
export interface NavigationAdapter { go(route: string): void }
export interface OfficeCompositionOptions { readonly client: WorkbenchClient; readonly capabilities: OfficeCapabilities; readonly agentDirectoryReader: AgentDirectoryReader }
export const TERMINAL_DISPLAY_MS = 8_000;
export const RECENT_ITEM_LIMIT = 20;
export const DEVICE_LIMIT = 3;
