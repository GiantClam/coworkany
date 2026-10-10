import type { OfficeCapabilities, OfficeRoleDefinition, OfficeRoleId, OfficeSourceId, OfficeWorkItem } from "./types";
import { OFFICE_CHARACTER_ASSET_ID, OFFICE_WORKSTATION_ASSET_ID } from "./asset-registry";

const DEVICE_LIMIT = 3;

function routeAvailable(capabilities: OfficeCapabilities, route: string): boolean {
  const path = route.split("?", 1)[0] ?? route;
  return capabilities.routes.has(route) || capabilities.routes.has(path);
}

function roleCapabilityAvailable(capabilities: OfficeCapabilities, role: OfficeRoleId): boolean {
  switch (role) {
    case "ai-chat":
      return capabilities.runtime.text;
    case "agent-center":
      return capabilities.runtime.agents && capabilities.agentDirectoryReady;
    case "ppt-expert":
      return capabilities.featureFlags.has("ppt_generate");
    case "workflow-operator":
      return capabilities.runtime.workflows;
    case "writer":
      return capabilities.runtime.text;
    case "image-creator":
      return capabilities.providers.image === "configured";
    case "video-producer":
      return capabilities.providers.video === "configured";
  }
}

function roleEnabled(capabilities: OfficeCapabilities, role: OfficeRoleId, homeRoute: string): boolean {
  return routeAvailable(capabilities, homeRoute);
}

type RoleSeed = {
  readonly roleId: OfficeRoleId;
  readonly label: OfficeRoleDefinition["label"];
  readonly homeRoute: string;
  readonly sourceAdapterId: string;
  readonly healthSourceIds: readonly OfficeSourceId[];
  readonly artifactKinds: OfficeRoleDefinition["artifactKinds"];
};

const roleSeeds: readonly RoleSeed[] = [
  {
    roleId: "ai-chat",
    label: { zh: "AI 对话", en: "AI Chat" },
    homeRoute: "/dashboard/ai",
    sourceAdapterId: "conversation-runs",
    healthSourceIds: ["conversations", "runs", "run-details"],
    artifactKinds: ["document"],
  },
  {
    roleId: "agent-center",
    label: { zh: "Agent 中心", en: "Agent Center" },
    homeRoute: "/dashboard/agent-platform",
    sourceAdapterId: "agent-runs",
    healthSourceIds: ["conversations", "runs", "run-details", "agent-directory"],
    artifactKinds: ["document"],
  },
  {
    roleId: "ppt-expert",
    label: { zh: "PPT 专家", en: "PPT Expert" },
    homeRoute: "/dashboard/ai?agent=executive-ppt",
    sourceAdapterId: "ppt-runs",
    healthSourceIds: ["conversations", "runs", "run-details"],
    artifactKinds: ["ppt"],
  },
  {
    roleId: "workflow-operator",
    label: { zh: "工作流", en: "Workflow" },
    homeRoute: "/dashboard/workflows",
    sourceAdapterId: "workflow-runs",
    healthSourceIds: ["runs", "run-details", "attempts"],
    artifactKinds: ["document"],
  },
  {
    roleId: "writer",
    label: { zh: "写作助手", en: "Writing Assistant" },
    homeRoute: "/dashboard/writer",
    sourceAdapterId: "writer-runs",
    healthSourceIds: ["conversations", "runs", "run-details"],
    artifactKinds: ["document"],
  },
  {
    roleId: "image-creator",
    label: { zh: "图片生成助手", en: "Image Assistant" },
    homeRoute: "/dashboard/image-assistant",
    sourceAdapterId: "image-runs",
    healthSourceIds: ["runs", "run-details", "attempts", "provider:image"],
    artifactKinds: ["image"],
  },
  {
    roleId: "video-producer",
    label: { zh: "视频助手", en: "Video Assistant" },
    homeRoute: "/dashboard/video",
    sourceAdapterId: "video-runs",
    healthSourceIds: ["runs", "run-details", "attempts", "provider:video"],
    artifactKinds: ["video"],
  },
];

export const OFFICE_ROLE_REGISTRY: readonly OfficeRoleDefinition[] = roleSeeds.map((seed) => ({
  ...seed,
  enabledWhen: (capabilities) => roleEnabled(capabilities, seed.roleId, seed.homeRoute),
  workItemRoute: (item: OfficeWorkItem) => {
    const routeTarget = item.routeTarget?.trim();
    if (routeTarget) return routeTarget;
    const artifactId = item.artifactIds[0]?.trim();
    if (artifactId) return `/dashboard/assets?artifactId=${encodeURIComponent(artifactId)}&preview=1`;
    return seed.homeRoute;
  },
  workstationAssetId: OFFICE_WORKSTATION_ASSET_ID,
  characterAssetId: OFFICE_CHARACTER_ASSET_ID,
  deviceLimit: DEVICE_LIMIT,
}));

/** Return the registered role only when the item came from that role's adapter. */
export function officeRoleForWorkItem(item: OfficeWorkItem): OfficeRoleDefinition | undefined {
  const role = OFFICE_ROLE_REGISTRY.find((candidate) => candidate.roleId === item.roleId);
  return role?.sourceAdapterId === item.sourceAdapterId ? role : undefined;
}

export function enabledOfficeRoles(capabilities: OfficeCapabilities): readonly OfficeRoleDefinition[] {
  return OFFICE_ROLE_REGISTRY.filter((role) => role.enabledWhen(capabilities));
}

export function officeRoleAvailable(capabilities: OfficeCapabilities, role: OfficeRoleDefinition): boolean {
  return routeAvailable(capabilities, role.homeRoute) && roleCapabilityAvailable(capabilities, role.roleId);
}
