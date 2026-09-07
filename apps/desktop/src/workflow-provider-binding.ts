import { capabilityForWorkflowAction, configuredModelOptions, providerForCapability, providerForId, supportsProviderCapability, type DesktopProviderConfig } from "./provider-config";
import type { WorkflowDefinitionEnvelope, WorkflowNodeType } from "@coworkany/workflow-core";

type WorkflowProviderConfig = {
  readonly provider: DesktopProviderConfig;
  readonly providers?: Readonly<Record<string, DesktopProviderConfig>>;
  readonly defaults?: Partial<Record<"text" | "image" | "video" | "audio", string>>;
};

const PROVIDER_NODE_TYPES = new Set<WorkflowNodeType>([
  "writer",
  "llm_generate",
  "agent_execute",
  "ppt_generate",
  "image_generate",
  "video_generate",
  "digital_human",
  "music_generate",
  "voice_synthesis",
  "voice_clone",
  "audio_generate",
]);

function runningHubWorkflowCapabilityForNode(node: WorkflowDefinitionEnvelope["nodes"][number]) {
  if (node.type === "image_generate") return "image" as const;
  if (node.type === "digital_human") return "digital_human" as const;
  if (node.type === "video_generate") return node.config.featureId === "video-enhance" ? "video_enhance" as const : "video" as const;
  if (["music_generate", "voice_synthesis", "voice_clone", "audio_generate"].includes(node.type)) return "audio" as const;
  return undefined;
}

function isRunningHubProvider(provider: DesktopProviderConfig) {
  return provider.source?.trim().toLowerCase() === "runninghub";
}

/**
 * Rebind provider-backed nodes only for the in-memory host request. Persisted/exported
 * definitions are sanitized separately so Provider/model bindings never
 * become portable state. Each capability resolves its own configured profile,
 * which is required for mixed image/video/audio workflows.
 */
export function bindWorkflowProviderDefaults(definition: WorkflowDefinitionEnvelope, config: WorkflowProviderConfig): WorkflowDefinitionEnvelope {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      if (!PROVIDER_NODE_TYPES.has(node.type as WorkflowNodeType)) return node;
      // Provider bindings are rebuilt from the current local profile. Remove
      // stale workflow IDs from imported definitions so a developer account's
      // private workflow cannot survive a provider switch.
      const nodeConfig = Object.fromEntries(Object.entries(node.config).filter(([key]) => !["apiKey", "workflowId", "digitalHumanWorkflowId", "videoEnhanceWorkflowId", "workflowRef"].includes(key)));
      const capability = capabilityForWorkflowAction(node.type as WorkflowNodeType);
      const selectedProviderId = typeof nodeConfig.selectedProviderId === "string" ? nodeConfig.selectedProviderId.trim() : "";
      const selectedProfile = selectedProviderId ? config.providers?.[selectedProviderId] : undefined;
      const provider = selectedProfile && supportsProviderCapability(selectedProfile, capability)
        ? providerForId(config, selectedProviderId)
        : providerForCapability(config, capability);
      const workflowCapability = runningHubWorkflowCapabilityForNode(node);
      const registeredWorkflows = isRunningHubProvider(provider) && workflowCapability
        ? provider.workflows?.filter((workflow) => workflow.capability === workflowCapability) ?? []
        : [];
      // RunningHub's executable choice is an account-owned remote workflow,
      // not an opaque model ID. Its model catalog is therefore the matching
      // workflow ID list; direct endpoint profiles keep their normal models.
      const configuredModels = registeredWorkflows.length
        ? registeredWorkflows.map((workflow) => workflow.remoteWorkflowId)
        : configuredModelOptions(provider);
      const selectedNodeModel = typeof nodeConfig.selectedModelId === "string" && nodeConfig.selectedModelId.trim()
        ? nodeConfig.selectedModelId.trim()
        : typeof nodeConfig.model === "string" ? nodeConfig.model.trim() : "";
      const selectedWorkflowReference = typeof node.config.workflowRef === "string" ? node.config.workflowRef.trim() : "";
      // A workflow node may choose any model registered to its currently
      // resolved capability profile. Keep that choice for every capability,
      // rather than replacing it with the profile's first model at run time.
      // Imported/stale model IDs remain rejected whenever the profile has an
      // explicit model catalog.
      const selectedConfiguredModel = selectedNodeModel && (!configuredModels.length || configuredModels.includes(selectedNodeModel))
        ? selectedNodeModel
        : undefined;
      // Media feature tabs can select a music model that is not the profile's
      // first model. Keep the legacy behavior for an older audio profile that
      // has not yet persisted a model catalog.
      const selectedMusicModel = node.type === "music_generate" && selectedNodeModel && /music/iu.test(selectedNodeModel)
        ? selectedNodeModel
        : undefined;
      const selectedWorkflow = registeredWorkflows.find((workflow) => workflow.remoteWorkflowId === selectedNodeModel || workflow.id === selectedNodeModel || workflow.remoteWorkflowId === selectedWorkflowReference || workflow.id === selectedWorkflowReference)
        ?? (registeredWorkflows.length === 1 ? registeredWorkflows[0] : undefined);
      const boundModel = selectedWorkflow?.remoteWorkflowId ?? selectedConfiguredModel ?? selectedMusicModel ?? provider.model;
      return {
        ...node,
        config: {
          ...nodeConfig,
          provider: provider.id,
          model: boundModel,
          baseUrl: provider.baseUrl,
          ...(provider.endpoint ? { endpoint: provider.endpoint } : {}),
          ...(provider.queryEndpoint ? { queryEndpoint: provider.queryEndpoint } : {}),
          ...(("selectedProviderId" in nodeConfig || "selectedModelId" in nodeConfig)
            ? { selectedProviderId: provider.id, ...("selectedModelId" in nodeConfig ? { selectedModelId: boundModel } : {}) }
            : {}),
        },
      };
    }),
  };
}

export function isMediaWorkflowNodeType(type: string): type is WorkflowNodeType {
  return PROVIDER_NODE_TYPES.has(type as WorkflowNodeType) && !["writer", "llm_generate", "agent_execute", "ppt_generate"].includes(type);
}
