import type { WorkbenchClient } from "@coworkany/workbench-client";
import { createAgentRunsAdapter, createRoleRunAdapter } from "./adapters/run-adapters";
import { createRunRecordSource } from "./run-record-source";
import { createOfficeProjector } from "./projector";
import { createOfficeStore, type OfficeStore } from "./office-store";
import { enabledOfficeRoles, officeRoleAvailable } from "./role-registry";
import { createAgentDirectoryHealthSource, createCapabilityHealthSources, type MediaRuntimeReader } from "./capabilities";
import type { AgentDirectoryReader, OfficeCapabilities, OfficeClock } from "./types";

export interface OfficeCompositionOptions {
  readonly client: WorkbenchClient;
  readonly capabilities: OfficeCapabilities;
  readonly agentDirectoryReader: AgentDirectoryReader;
  readonly mediaRuntimeReader?: MediaRuntimeReader;
  /** Keep the empty studio readable as a calm, fully staffed idle scene. */
  readonly defaultIdle?: boolean;
  readonly reportDiagnostic?: (code: string, detail?: string) => void;
  readonly clock?: OfficeClock;
}

export interface OfficeComposition {
  readonly store: OfficeStore;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
}

const realClock: OfficeClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function createOfficeComposition(options: OfficeCompositionOptions): OfficeComposition {
  const clock = options.clock ?? realClock;
  const roles = enabledOfficeRoles(options.capabilities);
  const unavailableRoleIds = new Set(roles.filter((role) => !officeRoleAvailable(options.capabilities, role)).map((role) => role.roleId));
  const source = createRunRecordSource({
    client: options.client,
    clock,
    reportDiagnostic: options.reportDiagnostic ?? (() => undefined),
  });
  const adapters = roles.map((role) => role.roleId === "agent-center" ? createAgentRunsAdapter(options.agentDirectoryReader) : createRoleRunAdapter(role.roleId));
  const store = createOfficeStore({
    createProjector: () => createOfficeProjector({ clock, roles, unavailableRoleIds, defaultIdle: options.defaultIdle }),
    source,
    healthSources: [createAgentDirectoryHealthSource(options.agentDirectoryReader), ...createCapabilityHealthSources(options.capabilities, options.mediaRuntimeReader)],
    adapters,
    discoveryRefreshMs: 5_000,
    scheduler: clock,
  });
  return { store, start: () => store.start(), stop: () => store.stop() };
}
