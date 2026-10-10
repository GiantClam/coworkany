import type { AgentDirectoryReader, OfficeCapabilities, OfficeSourceId } from "./types";

export interface MediaRuntimeProbe {
  readonly node?: boolean;
  readonly host?: boolean;
  readonly media?: boolean;
}

/** Reads local runtime prerequisites only; it does not probe remote Providers. */
export interface MediaRuntimeReader {
  readonly read: () => Promise<MediaRuntimeProbe | null | undefined>;
}

export function buildOfficeCapabilities(input: Partial<OfficeCapabilities> = {}): OfficeCapabilities {
  return {
    routes: input.routes ?? new Set<string>(),
    featureFlags: input.featureFlags ?? new Set<string>(),
    runtime: input.runtime ?? { text: true, agents: false, workflows: true },
    providers: input.providers ?? {},
    agentDirectoryReady: input.agentDirectoryReady ?? false,
  };
}

export function officeRouteAvailable(capabilities: OfficeCapabilities, route: string): boolean {
  const path = route.split("?", 1)[0] ?? route;
  return capabilities.routes.has(route) || capabilities.routes.has(path);
}

function validMediaRuntimeProbe(value: unknown): value is MediaRuntimeProbe {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const probe = value as Record<string, unknown>;
  return ["node", "host", "media"].some((key) => key in probe)
    && ["node", "host", "media"].every((key) => !(key in probe) || typeof probe[key] === "boolean");
}

function requiredRuntimePrerequisites(provider: string): readonly (keyof MediaRuntimeProbe)[] {
  return provider === "video" ? ["node", "host", "media"] : ["node", "host"];
}

/** Configuration and local probes cannot prove remote Provider availability. */
export function createCapabilityHealthSources(capabilities: OfficeCapabilities, mediaRuntimeReader?: MediaRuntimeReader) {
  let runtimeReadFlight: Promise<MediaRuntimeProbe | null> | undefined;
  const readRuntime = async (): Promise<MediaRuntimeProbe | null> => {
    if (!runtimeReadFlight) {
      runtimeReadFlight = Promise.resolve().then(() => mediaRuntimeReader?.read())
        .then((value) => validMediaRuntimeProbe(value) ? value : null)
        .catch(() => null)
        .finally(() => { runtimeReadFlight = undefined; });
    }
    return runtimeReadFlight;
  };

  return Object.entries(capabilities.providers).map(([provider, state]) => {
    const sourceId = `provider:${provider}` as OfficeSourceId;
    return {
      id: sourceId,
      snapshot: async () => {
        const observedAt = new Date().toISOString();
        if (state !== "configured" || !mediaRuntimeReader || (provider !== "image" && provider !== "video")) {
          return {
            sourceId,
            status: state === "unavailable" ? "offline" as const : "unknown" as const,
            observedAt,
            ...(state === "configured" ? { reason: "provider_availability_unobserved" } : {}),
          };
        }
        const runtime = await readRuntime();
        const required = requiredRuntimePrerequisites(provider);
        if (runtime && required.some((key) => runtime[key] === false)) {
          return { sourceId, status: "offline" as const, observedAt, reason: "runtime_unavailable" };
        }
        if (!runtime || required.some((key) => typeof runtime[key] !== "boolean")) {
          return { sourceId, status: "unknown" as const, observedAt, reason: "runtime_status_unavailable" };
        }
        return { sourceId, status: "unknown" as const, observedAt, reason: "provider_availability_unobserved" };
      },
    };
  });
}

export function createAgentDirectoryHealthSource(reader: AgentDirectoryReader) {
  return {
    id: "agent-directory" as const,
    snapshot: async () => {
      const result = await reader.read();
      return {
        sourceId: "agent-directory" as const,
        status: result.status === "ready" ? "ready" as const : result.status === "offline" ? "offline" as const : "unknown" as const,
        observedAt: result.snapshot?.observedAt ?? new Date().toISOString(),
        ...(result.status !== "ready" ? { reason: result.reason } : {}),
      };
    },
    clear: () => reader.clear(),
  };
}
