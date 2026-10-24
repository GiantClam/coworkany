import {
  WORKFLOW_AI_TOOL_NAMES,
  createDesktopUIMessage,
  createWorkflowAiPrompt,
  type DesktopUIMessage,
  type DesktopUIMessagePart,
  type WorkbenchClient,
  type WorkflowAiCommand,
  type WorkflowAiContext,
  type WorkflowAiOperationGroup,
  type WorkflowAiProviderOption,
} from "@coworkany/workbench-client";
import {
  applyWorkflowAiCommands,
  layoutWorkflowDeterministically,
  parseWorkflowAuthoringPlan,
  validateWorkflowAuthoringResult,
  hashWorkflowDefinition,
  matchGoldenWorkflowTemplates,
  type WorkflowAuthoringPlan,
  type WorkflowCapability,
  validateWorkflowDefinition,
  type WorkflowDefinitionEnvelope,
} from "@coworkany/workflow-core";
import {
  configuredModelOptions,
  supportsProviderCapability,
  type DesktopProviderConfig,
  type ProviderCapability,
} from "./provider-config";

const MUTATION_TOOL_NAMES = new Set<WorkflowAiCommand["type"]>([
  "add_node",
  "update_node",
  "copy_node",
  "delete_node",
  "connect_nodes",
  "disconnect_nodes",
  "update_port_mapping",
  "group_nodes",
  "ungroup_nodes",
  "create_control_structure",
  "layout_nodes",
]);

const ALLOWED_RESPONSE_KEYS = new Set(["message", "plan", "operationGroup", "focusNodeKeys", "runWorkflow", "nextInferenceProvider"]);
const EXPLICIT_RUN_REQUEST = /(?:\brun\b|\btest\b|\bexecute\b|运行|测试|执行)/iu;
const EXPLICIT_APPROVAL_REQUEST = /(?:\b(?:ask|hold|pause|present|request|require|submit|wait)\b[\s\S]{0,60}\bapproval\b|\bapproval\s+(?:plan\s+)?(?:before|first|only|required)\b|\b(?:do not|don't|never|without)\b[\s\S]{0,40}\bapproval\b|\b(?:before|until)\b[\s\S]{0,35}\bapprove(?:d)?\b|(?:等待|待|请求|需要|先|请先).{0,10}(?:审批|批准))/iu;
const EXPLICIT_TITLE_REQUEST = /(?:\brename\b|\bretitle\b|\btitle\b|\blabel\b|重命名|改名|命名|名称|标题|(?:节点|node).*(?:改为|改成))/iu;

export type WorkflowAiAssistantResponse = {
  readonly message: string;
  readonly plan?: WorkflowAuthoringPlan<WorkflowAiCommand>;
  readonly operationGroup?: {
    readonly summary: string;
    readonly commands: readonly WorkflowAiCommand[];
  };
  readonly focusNodeKeys?: readonly string[];
  readonly runWorkflow?: boolean;
  /** Provider/model to use for the next user turn (never the current request). */
  readonly nextInferenceProvider?: WorkflowAiInferenceProviderSelection;
};

export type WorkflowAiInferenceProviderSelection = {
  readonly providerId: string;
  readonly modelId: string;
};

export type WorkflowAiControllerResult = {
  readonly status: "applied" | "approval_required" | "rejected" | "completed" | "failed";
  readonly toolCallId?: string;
  readonly operationGroup?: WorkflowAiOperationGroup;
  readonly error?: string;
  readonly nextInferenceProvider?: WorkflowAiInferenceProviderSelection;
};

export function shouldRetryWorkflowAiRepair(
  result: WorkflowAiControllerResult,
  sourceUserId: string | undefined,
  attempts: ReadonlyMap<string, 0 | 1>,
): boolean {
  if (!sourceUserId) return false;
  return result.status === "failed"
    && Boolean(result.error && /workflow_ai_(?:invalid_response|invalid_validation_result|semantic_validation_failed|validation_failed|plan_validation_failed|plan_operations_mismatch)/u.test(result.error))
    && (attempts.get(sourceUserId) ?? 0) === 0;
}

export function recordWorkflowAiRepairAttempt(attempts: Map<string, 0 | 1>, sourceUserId: string, repairMessageId: string) {
  attempts.set(sourceUserId, 1);
  attempts.set(repairMessageId, 1);
}

type ProviderWithEstimate = DesktopProviderConfig & { readonly estimatedCost?: number; readonly label?: string };

export type WorkflowAiControllerInput = {
  readonly workflowId: string;
  readonly conversationId?: string;
  readonly definition: WorkflowDefinitionEnvelope;
  readonly selectedNodeKeys: readonly string[];
  readonly providers: readonly DesktopProviderConfig[];
  readonly client: Pick<WorkbenchClient, "workflows">;
  readonly onDefinitionChange: (definition: WorkflowDefinitionEnvelope) => void;
  readonly onFocusNodes: (nodeKeys: readonly string[]) => void;
  readonly onNextInferenceProvider?: (provider: DesktopProviderConfig) => void;
  readonly onRun?: (definition: WorkflowDefinitionEnvelope) => void | Promise<void>;
  readonly goldenTemplates?: WorkflowAiContext["goldenTemplates"];
  readonly requestAssistant?: (request: { readonly prompt: string; readonly context: WorkflowAiContext }) => Promise<string>;
};

export type WorkflowAiController = {
  readonly messages: readonly DesktopUIMessage[];
  readonly operationGroups: readonly WorkflowAiOperationGroup[];
  readonly context: WorkflowAiContext;
  readonly send: (text: string) => Promise<WorkflowAiControllerResult>;
  readonly handleAssistantResponse: (text: string, userRequest: string) => Promise<WorkflowAiControllerResult>;
  readonly approve: (toolCallId: string) => Promise<WorkflowAiControllerResult>;
  readonly reject: (toolCallId: string) => Promise<WorkflowAiControllerResult>;
  readonly focus: (nodeKeys: readonly string[]) => void;
  readonly sync: (state: { readonly definition: WorkflowDefinitionEnvelope; readonly selectedNodeKeys?: readonly string[]; readonly operationGroups?: readonly WorkflowAiOperationGroup[] }) => void;
};

function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function providerIsAvailable(provider: DesktopProviderConfig) {
  const source = (provider.source ?? provider.id ?? "").trim().toLowerCase();
  const hasModel = Boolean(provider.model?.trim() || configuredModelOptions(provider).length || provider.workflows?.length || provider.workflowId?.trim());
  const hasEndpoint = source === "local" || Boolean(provider.baseUrl?.trim() || provider.endpoint?.trim() || provider.queryEndpoint?.trim());
  return hasModel && hasEndpoint;
}

/** Converts configured profiles to a prompt-safe capability catalog. */
export function workflowAiProviderOptions(providers: readonly DesktopProviderConfig[]): WorkflowAiProviderOption[] {
  return providers
    .filter((provider) => supportsProviderCapability(provider, "text"))
    .map((provider, index) => {
      const id = provider.id?.trim() || provider.source?.trim() || `provider-${index + 1}`;
      const models = [...new Set([provider.model, ...configuredModelOptions(provider)].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
      const estimatedCost = (provider as ProviderWithEstimate).estimatedCost;
      return {
        id,
        label: (provider as ProviderWithEstimate).label?.trim() || id,
        models,
        capabilities: ["text"],
        available: providerIsAvailable(provider),
        ...(typeof estimatedCost === "number" && Number.isFinite(estimatedCost) ? { estimatedCost } : {}),
      } satisfies WorkflowAiProviderOption;
    })
    .filter((provider) => provider.available)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Resolve only an available, configured text Provider/model pair for assistant inference. */
export function resolveWorkflowAiTextProvider(
  providers: readonly DesktopProviderConfig[],
  providerId: string | undefined,
  modelId: string | undefined,
  fallback: DesktopProviderConfig,
): DesktopProviderConfig;
export function resolveWorkflowAiTextProvider(
  providers: readonly DesktopProviderConfig[],
  providerId: string | undefined,
  modelId: string | undefined,
): DesktopProviderConfig | undefined;
export function resolveWorkflowAiTextProvider(
  providers: readonly DesktopProviderConfig[],
  providerId: string | undefined,
  modelId: string | undefined,
  fallback?: DesktopProviderConfig,
): DesktopProviderConfig | undefined {
  const id = providerId?.trim();
  const model = modelId?.trim();
  if (!id || !model) return fallback;
  const descriptor = workflowAiProviderOptions(providers).find((provider) => provider.id === id);
  if (!descriptor || !descriptor.models.includes(model)) return fallback;
  const provider = providers.find((candidate) => (candidate.id?.trim() || candidate.source?.trim()) === id);
  return provider ? { ...provider, id, model } : fallback;
}

/** Resolve a model-declared next inference target without silently falling back. */
export function resolveWorkflowAiNextInferenceProvider(
  providers: readonly DesktopProviderConfig[],
  selection: WorkflowAiInferenceProviderSelection | undefined,
): { readonly provider: DesktopProviderConfig; readonly selection: WorkflowAiInferenceProviderSelection } | undefined {
  if (!selection) return undefined;
  const provider = resolveWorkflowAiTextProvider(providers, selection.providerId, selection.modelId);
  if (!provider) return undefined;
  const providerId = provider.id?.trim() || provider.source?.trim();
  const modelId = provider.model?.trim();
  if (!providerId || !modelId) return undefined;
  return { provider, selection: { providerId, modelId } };
}

function jsonPayload(text: string) {
  const marker = text.match(/<workflow-ai-response>\s*([\s\S]*?)\s*<\/workflow-ai-response>/iu)?.[1];
  if (marker) return marker.trim();
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/giu)].map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
  for (const fenced of fences) {
    try {
      const parsed: unknown = JSON.parse(fenced);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return fenced;
    } catch { /* keep looking for the actual response object */ }
  }
  const trimmed = text.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return trimmed;
  } catch { /* provider may add a short preamble or trailing note */ }

  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, index + 1);
          try {
            const parsed: unknown = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return candidate;
          } catch { /* malformed candidate is still rejected by the normal parser */ }
          break;
        }
      }
    }
  }
  return trimmed;
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("workflow_ai_invalid_focus_nodes");
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

const UPDATE_NODE_PATCH_KEYS = ["type", "nodeVersion", "title", "positionX", "positionY", "config"] as const;

function normalizeOperationCommand(value: unknown): WorkflowAiCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workflow_ai_invalid_command");
  const command = value as Record<string, unknown>;
  const namedTool = typeof command.name === "string" ? command.name : undefined;
  const type = namedTool ?? (typeof command.type === "string" ? command.type : undefined);
  if (type === "validate_workflow") return null;
  if (!type || !MUTATION_TOOL_NAMES.has(type as WorkflowAiCommand["type"])) throw new Error("workflow_ai_tool_not_allowed");
  if (!namedTool) return command as WorkflowAiCommand;

  if (type === "update_node" && command.patch === undefined) {
    if (typeof command.nodeKey !== "string" || !command.nodeKey.trim()) throw new Error("workflow_ai_invalid_command");
    const patch: Record<string, unknown> = {};
    for (const key of UPDATE_NODE_PATCH_KEYS) if (command[key] !== undefined) patch[key] = command[key];
    if (!Object.keys(patch).length) throw new Error("workflow_ai_invalid_command");
    return { type, nodeKey: command.nodeKey, patch } as WorkflowAiCommand;
  }

  const input = { ...command };
  delete input.name;
  return { ...input, type } as WorkflowAiCommand;
}

/** Parses the only model-to-controller protocol accepted by the desktop. */
export function parseWorkflowAiAssistantResponse(text: string): WorkflowAiAssistantResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload(text));
  } catch {
    throw new Error("workflow_ai_invalid_response");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("workflow_ai_invalid_response");
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_RESPONSE_KEYS.has(key))) throw new Error("workflow_ai_response_field_not_allowed");
  if (typeof record.message !== "string" || !record.message.trim()) throw new Error("workflow_ai_response_message_required");
  const focusNodeKeys = stringList(record.focusNodeKeys);
  let operationGroup: WorkflowAiAssistantResponse["operationGroup"];
  if (record.operationGroup !== undefined) {
    if (!record.operationGroup || typeof record.operationGroup !== "object" || Array.isArray(record.operationGroup)) throw new Error("workflow_ai_invalid_operation_group");
    const group = record.operationGroup as Record<string, unknown>;
    if (Object.keys(group).some((key) => key !== "summary" && key !== "commands")) throw new Error("workflow_ai_operation_field_not_allowed");
    if (typeof group.summary !== "string" || !group.summary.trim() || !Array.isArray(group.commands) || group.commands.length === 0) throw new Error("workflow_ai_invalid_operation_group");
    const commands = group.commands.map(normalizeOperationCommand).filter((command): command is WorkflowAiCommand => command !== null);
    if (!commands.length) throw new Error("workflow_ai_invalid_operation_group");
    operationGroup = { summary: group.summary.trim(), commands };
  }
  let plan: WorkflowAiAssistantResponse["plan"];
  if (record.plan !== undefined) {
    plan = parseWorkflowAuthoringPlan<WorkflowAiCommand>(record.plan);
    const planCommands = plan.operations.map(normalizeOperationCommand).filter((command): command is WorkflowAiCommand => command !== null);
    if (operationGroup && JSON.stringify(planCommands) !== JSON.stringify(operationGroup.commands)) throw new Error("workflow_ai_plan_operations_mismatch");
    if (!operationGroup && planCommands.length) operationGroup = { summary: plan.intent, commands: planCommands };
    if (plan.validationResult.status === "invalid" || (plan.validationResult.status === "valid" && plan.validationResult.issues.length > 0)) {
      throw new Error("workflow_ai_plan_validation_failed");
    }
  } else if (operationGroup) {
    throw new Error("workflow_ai_plan_required");
  }
  if (record.runWorkflow !== undefined && typeof record.runWorkflow !== "boolean") throw new Error("workflow_ai_invalid_run_request");
  let nextInferenceProvider: WorkflowAiInferenceProviderSelection | undefined;
  if (record.nextInferenceProvider !== undefined) {
    if (!record.nextInferenceProvider || typeof record.nextInferenceProvider !== "object" || Array.isArray(record.nextInferenceProvider)) throw new Error("workflow_ai_invalid_next_inference_provider");
    const next = record.nextInferenceProvider as Record<string, unknown>;
    if (Object.keys(next).some((key) => key !== "providerId" && key !== "modelId") || typeof next.providerId !== "string" || typeof next.modelId !== "string" || !next.providerId.trim() || !next.modelId.trim()) {
      throw new Error("workflow_ai_invalid_next_inference_provider");
    }
    nextInferenceProvider = { providerId: next.providerId.trim(), modelId: next.modelId.trim() };
  }
  return {
    message: record.message.trim(),
    ...(plan ? { plan } : {}),
    ...(operationGroup ? { operationGroup } : {}),
    ...(focusNodeKeys ? { focusNodeKeys } : {}),
    ...(record.runWorkflow === true ? { runWorkflow: true } : {}),
    ...(nextInferenceProvider ? { nextInferenceProvider } : {}),
  };
}

function commandProviderId(command: WorkflowAiCommand) {
  const config = command.type === "update_node" ? command.patch.config : command.type === "add_node" || command.type === "copy_node" || command.type === "create_control_structure" ? command.node.config : command.type === "group_nodes" ? command.groupNode.config : undefined;
  if (!config) return undefined;
  const value = config.selectedProviderId ?? config.provider;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function configuredNodeProviderId(config: Readonly<Record<string, unknown>>) {
  const value = config.selectedProviderId ?? config.provider;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredProviderCapability(nodeType: string, config: Readonly<Record<string, unknown>>): ProviderCapability | undefined {
  if (["writer", "llm_generate", "agent_execute", "ppt_generate"].includes(nodeType)) {
    return config.operation === "audio_transcription" ? "audio" : "text";
  }
  if (nodeType === "image_generate") return "image";
  if (["video_generate", "digital_human"].includes(nodeType)) return "video";
  if (["music_generate", "voice_synthesis", "voice_clone", "audio_generate"].includes(nodeType)) return "audio";
  return undefined;
}

function commandNode(command: WorkflowAiCommand, definition: WorkflowDefinitionEnvelope) {
  if (command.type === "add_node" || command.type === "create_control_structure") return command.node;
  if (command.type === "copy_node") return command.node;
  if (command.type === "group_nodes") return command.groupNode;
  if (command.type === "update_node") {
    const current = definition.nodes.find((node) => node.nodeKey === command.nodeKey);
    if (!current) return undefined;
    return { ...current, ...command.patch, config: { ...current.config, ...(command.patch.config ?? {}) } };
  }
  return undefined;
}

function isTitleOnlyOperation(commands: readonly WorkflowAiCommand[]) {
  return commands.length > 0 && commands.every((command) => {
    if (command.type !== "update_node" || !("title" in command.patch)) return false;
    return Object.keys(command.patch).every((key) => key === "title");
  });
}

function operationNeedsApproval(commands: readonly WorkflowAiCommand[], definition: WorkflowDefinitionEnvelope, providers: readonly WorkflowAiProviderOption[]) {
  if (commands.filter((command) => command.type === "delete_node").length > 1) return "destructive_batch_delete";
  for (const command of commands) {
    const changed = commandNode(command, definition);
    const providerId = commandProviderId(command);
    const provider = providerId ? providers.find((candidate) => candidate.id === providerId) : undefined;
    if (providerId && !provider?.available) return "provider_unavailable";
    const required = changed ? requiredProviderCapability(changed.type, changed.config) : undefined;
    // A configured provider with the wrong capability is not an approval-worthy
    // choice. It is an invalid binding and must fail closed before the command
    // can enter the pending approval queue or be persisted on the node.
    if (provider && required && !provider.capabilities.includes(required)) return "provider_capability_mismatch";
  }
  return undefined;
}

function workflowExecutionProviders(providers: readonly DesktopProviderConfig[]): WorkflowAiProviderOption[] {
  const capabilities: ProviderCapability[] = ["text", "image", "video", "audio"];
  return providers.filter(providerIsAvailable).map((provider, index) => ({
    id: provider.id?.trim() || provider.source?.trim() || `provider-${index + 1}`,
    label: (provider as ProviderWithEstimate).label?.trim() || provider.id?.trim() || provider.source?.trim() || `provider-${index + 1}`,
    models: [...new Set([provider.model, ...configuredModelOptions(provider)].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))],
    capabilities: capabilities.filter((capability) => supportsProviderCapability(provider, capability)),
    available: true,
  }));
}

function templateMatchKey(match: ReturnType<typeof matchGoldenWorkflowTemplates>[number]) {
  return `${match.coverage}:${match.estimatedAddedNodes}:${match.pendingConfigurationCount}`;
}

function validateSelectedTemplateStructure(
  template: NonNullable<WorkflowAiContext["goldenTemplates"]>[number],
  before: WorkflowDefinitionEnvelope,
  candidate: WorkflowDefinitionEnvelope,
) {
  // Existing workflows are allowed to retain their established graph and
  // provenance while making a minimal edit. Blank workflows must, however,
  // adapt the selected template's typed graph instead of merely recording its
  // key in metadata.
  if (before.nodes.length > 0 && typeof before.metadata?.templateKey === "string") return true;
  const requiredTypes = template.definition?.nodes.map((node) => node.type) ?? template.nodeTypes;
  const actualTypes = new Map<string, number>();
  for (const node of candidate.nodes) actualTypes.set(node.type, (actualTypes.get(node.type) ?? 0) + 1);
  return requiredTypes.every((type) => {
    const count = actualTypes.get(type) ?? 0;
    actualTypes.set(type, count - 1);
    return count > 0;
  });
}

function toolPart(toolName: string, toolCallId: string, state: "input-available" | "approval-requested" | "output-available" | "output-error" | "output-denied", input: unknown, detail?: unknown): DesktopUIMessagePart {
  if (state === "approval-requested") return { type: "dynamic-tool", toolName, toolCallId, state, input, approval: { id: `approval:${toolCallId}` } };
  if (state === "output-available") return { type: "dynamic-tool", toolName, toolCallId, state, input, output: detail };
  if (state === "output-error") return { type: "dynamic-tool", toolName, toolCallId, state, input, errorText: typeof detail === "string" ? detail : "Workflow operation failed" };
  if (state === "output-denied") return { type: "dynamic-tool", toolName, toolCallId, state, input, approval: { id: `approval:${toolCallId}`, approved: false } };
  return { type: "dynamic-tool", toolName, toolCallId, state, input };
}

export function createWorkflowAiController(input: WorkflowAiControllerInput): WorkflowAiController {
  const conversationId = input.conversationId ?? `workflow-ai:${input.workflowId}`;
  const providerOptions = workflowAiProviderOptions(input.providers);
  const executionProviders = workflowExecutionProviders(input.providers);
  let definition = input.definition;
  let selectedNodeKeys = [...input.selectedNodeKeys];
  let messages: DesktopUIMessage[] = [];
  let operationGroups: WorkflowAiOperationGroup[] = [];
  const pending = new Map<string, { readonly kind: "operation"; readonly response: WorkflowAiAssistantResponse; readonly group: WorkflowAiOperationGroup } | { readonly kind: "run"; readonly response: WorkflowAiAssistantResponse }>();

  const context = (): WorkflowAiContext => ({
    workflowId: input.workflowId,
    revision: definition.revision,
    definition,
    selectedNodeKeys,
    validationIssues: validateWorkflowDefinition(definition),
    configuredProviders: providerOptions,
    ...(input.goldenTemplates ? { goldenTemplates: input.goldenTemplates } : {}),
  });

  const appendAssistant = (response: WorkflowAiAssistantResponse, part?: DesktopUIMessagePart) => {
    const message = createDesktopUIMessage({ id: makeId("workflow-ai-assistant"), role: "assistant", conversationId, content: response.message });
    messages = [...messages, part ? { ...message, parts: [...message.parts, part] } : message];
  };

  const updateTool = (toolCallId: string, state: "output-available" | "output-error" | "output-denied", detail?: unknown) => {
    messages = messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => part.type === "dynamic-tool" && part.toolCallId === toolCallId
        ? toolPart(part.toolName, toolCallId, state, part.input, detail)
        : part),
    }));
  };

  const applyGroup = async (group: WorkflowAiOperationGroup): Promise<WorkflowAiControllerResult> => {
    const before = definition;
    try {
      const applied = applyWorkflowAiCommands({ definition: before, baseRevision: group.baseRevision, commands: group.commands });
      const shouldAutoLayout = group.commands.some((command) => command.type !== "layout_nodes");
      let layout = shouldAutoLayout ? layoutWorkflowDeterministically(applied.definition, applied.changedNodeKeys) : applied.definition;
      const changed = new Set(applied.changedNodeKeys);
      const configuredNodes = layout.nodes.map((node) => {
        if (!changed.has(node.nodeKey)) return node;
        const required = requiredProviderCapability(node.type, node.config);
        if (!required) return node;
        const providerId = configuredNodeProviderId(node.config) ?? "";
        const previous = before.nodes.find((candidate) => candidate.nodeKey === node.nodeKey);
        const previousProviderId = previous ? configuredNodeProviderId(previous.config) ?? "" : "";
        const previousRequired = previous ? requiredProviderCapability(previous.type, previous.config) : undefined;
        // Connecting or laying out a node must not turn an unchanged legacy
        // Provider binding into a blocker. Validate bindings on added nodes or
        // when the operation actually changes the node's capability/binding.
        if (previous && previousRequired === required && previousProviderId === providerId) return node;
        const provider = executionProviders.find((candidate) => candidate.id === providerId && candidate.capabilities.includes(required));
        const config = { ...node.config };
        if (!provider) {
          if (providerId) throw new Error(`workflow_ai_provider_capability_mismatch:${node.nodeKey}:${required}`);
          config.needsConfig = true;
          for (const key of ["selectedProviderId", "provider", "selectedModelId", "model", "baseUrl", "endpoint"]) delete config[key];
        } else delete config.needsConfig;
        return { ...node, config };
      });
      if (configuredNodes.some((node, index) => node !== layout.nodes[index])) {
        const unhashed = { ...layout, nodes: configuredNodes, definitionHash: "" };
        layout = { ...unhashed, definitionHash: hashWorkflowDefinition(unhashed) };
      }
      const sourceResponse = group as WorkflowAiOperationGroup & { requiredCapabilities?: readonly WorkflowCapability[]; selectedTemplate?: string | null; templateVersion?: number | null };
      if (sourceResponse.selectedTemplate && sourceResponse.templateVersion
        && (before.nodes.length === 0 || !before.metadata?.templateKey)) {
        const unhashed = { ...layout, metadata: { ...(layout.metadata ?? {}), templateKey: sourceResponse.selectedTemplate, templateVersion: sourceResponse.templateVersion }, definitionHash: "" };
        layout = { ...unhashed, definitionHash: hashWorkflowDefinition(unhashed) };
      }
      const requiredCapabilities = sourceResponse.requiredCapabilities ?? [];
      const semantic = validateWorkflowAuthoringResult(layout, requiredCapabilities);
      if (!semantic.valid) throw new Error(`workflow_ai_semantic_validation_failed:${[...semantic.graphIssues.map((issue) => issue.code), ...semantic.semanticIssues.map((issue) => issue.capability)].join(",")}`);
      const candidate = layout;
      const completed: WorkflowAiOperationGroup = { ...group, resultRevision: applied.definition.revision, status: "applied" };
      await input.client.workflows.applyAiOperation({
        workflowId: input.workflowId,
        expectedRevision: group.baseRevision,
        definition: candidate,
        operationGroup: completed,
      });
      definition = candidate;
      operationGroups = [...operationGroups, completed];
      input.onDefinitionChange(definition);
      if (applied.changedNodeKeys.length) input.onFocusNodes(applied.changedNodeKeys);
      updateTool(group.id, "output-available", { operationGroupId: completed.id, revision: completed.resultRevision, changedNodeKeys: applied.changedNodeKeys });
      return { status: "applied", toolCallId: group.id, operationGroup: completed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("workflow_ai_revision_conflict") ? "workflow_ai_revision_conflict" : message;
      const failed = { ...group, status: "failed" as const, resultRevision: null };
      operationGroups = [...operationGroups, failed];
      updateTool(group.id, "output-error", code);
      return { status: "failed", toolCallId: group.id, operationGroup: failed, error: code };
    }
  };

  const handleAssistantResponse = async (text: string, userRequest: string): Promise<WorkflowAiControllerResult> => {
    let response: WorkflowAiAssistantResponse;
    try {
      response = parseWorkflowAiAssistantResponse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "workflow_ai_invalid_response";
      appendAssistant({ message });
      return { status: "failed", error: message };
    }
    let nextInferenceProvider: WorkflowAiInferenceProviderSelection | undefined;
    if (response.nextInferenceProvider) {
      const resolved = resolveWorkflowAiNextInferenceProvider(input.providers, response.nextInferenceProvider);
      if (!resolved) {
        const error = "workflow_ai_invalid_next_inference_provider";
        appendAssistant({ message: error });
        return { status: "failed", error };
      }
      nextInferenceProvider = resolved.selection;
      input.onNextInferenceProvider?.(resolved.provider);
    }
    if (response.operationGroup && isTitleOnlyOperation(response.operationGroup.commands) && !EXPLICIT_TITLE_REQUEST.test(userRequest)) {
      const error = "workflow_ai_capability_change_requires_structure";
      const toolCallId = makeId("workflow-ai-operation");
      appendAssistant({ message: error }, toolPart("update_node", toolCallId, "output-denied", {
        reason: "title_only_capability_change",
        commands: response.operationGroup.commands,
      }));
      return { status: "rejected", toolCallId, error };
    }
    if (response.plan) {
      const templates = input.goldenTemplates ?? [];
      const configuredProviderCapabilities = [...new Set(executionProviders.flatMap((provider) => provider.capabilities))];
      const matches = matchGoldenWorkflowTemplates({
        templates,
        requiredCapabilities: response.plan.requiredCapabilities,
        existingNodeTypes: definition.nodes.map((node) => node.type),
        configuredProviderCapabilities,
      });
      const topMatch = matches[0];
      const topMatches = topMatch ? matches.filter((match) => templateMatchKey(match) === templateMatchKey(topMatch)) : [];
      const selected = response.plan.selectedTemplate
        ? matches.find((match) => match.templateKey === response.plan!.selectedTemplate && match.templateVersion === response.plan!.templateVersion)
        : undefined;
      if (response.plan.selectedTemplate && (!selected || !topMatches.some((match) => match.templateKey === selected.templateKey && match.templateVersion === selected.templateVersion))) {
        const error = "workflow_ai_unknown_golden_template";
        appendAssistant({ message: error });
        return { status: "rejected", error };
      }
      if (response.plan.requiredCapabilities.length > 0 && matches.length > 0 && !selected) {
        const error = "workflow_ai_golden_template_required";
        appendAssistant({ message: error });
        return { status: "rejected", error };
      }
      const selectedTemplate = selected && templates.find((template) => template.templateKey === selected.templateKey && template.templateVersion === selected.templateVersion);
      if (selectedTemplate && response.operationGroup) {
        try {
          const candidate = applyWorkflowAiCommands({ definition, baseRevision: definition.revision, commands: response.operationGroup.commands }).definition;
          if (!validateSelectedTemplateStructure(selectedTemplate, definition, candidate)) {
            const error = "workflow_ai_golden_template_structure_mismatch";
            appendAssistant({ message: error });
            return { status: "rejected", error };
          }
        } catch {
          // The normal apply path reports command errors with its detailed code.
        }
      }
    }
    if (response.focusNodeKeys?.length) input.onFocusNodes(response.focusNodeKeys);
    if (response.operationGroup) {
      if (!response.plan) return { status: "failed", error: "workflow_ai_plan_required" };
      const addCount = response.operationGroup.commands.reduce((count, command) => count
        + (command.type === "add_node" || command.type === "copy_node" || command.type === "create_control_structure" || command.type === "group_nodes" ? 1 : 0), 0);
      const id = makeId("workflow-ai-operation");
      const group: WorkflowAiOperationGroup = {
        id,
        conversationId,
        workflowId: input.workflowId,
        baseRevision: definition.revision,
        resultRevision: null,
        commands: response.operationGroup.commands,
        status: "failed",
        summary: response.operationGroup.summary,
        createdAt: new Date().toISOString(),
      };
      Object.assign(group, { requiredCapabilities: response.plan.requiredCapabilities, selectedTemplate: response.plan.selectedTemplate, templateVersion: response.plan.templateVersion });
      const firstTool = group.commands[0].type;
      const destructiveReplacement = group.commands.some((command) => command.type === "update_node" && command.patch.type !== undefined)
        || (group.commands.some((command) => command.type === "delete_node") && addCount > 0);
      const approvalBoundary = operationNeedsApproval(group.commands, definition, executionProviders);
      const reason = approvalBoundary
        ?? (addCount > 20 ? "large_node_addition" : undefined)
        ?? (destructiveReplacement ? "irreversible_replacement" : undefined)
        ?? (EXPLICIT_APPROVAL_REQUEST.test(userRequest) ? "explicit_user_approval" : undefined);
      if (reason === "provider_unavailable") {
        appendAssistant({ message: "workflow_ai_unconfigured_provider_rejected" }, toolPart(firstTool, id, "output-denied", { operationGroupId: id, reason }));
        return { status: "rejected", toolCallId: id, operationGroup: group, error: "workflow_ai_unconfigured_provider_rejected", nextInferenceProvider };
      }
      if (reason === "provider_capability_mismatch") {
        appendAssistant({ message: "workflow_ai_incompatible_provider_rejected" }, toolPart(firstTool, id, "output-denied", { operationGroupId: id, reason }));
        return { status: "rejected", toolCallId: id, operationGroup: group, error: "workflow_ai_incompatible_provider_rejected", nextInferenceProvider };
      }
      if (reason) {
        pending.set(id, { kind: "operation", response, group });
        appendAssistant(response, toolPart(firstTool, id, "approval-requested", { operationGroupId: id, summary: group.summary, commands: group.commands, reason }));
        return { status: "approval_required", toolCallId: id, operationGroup: group, nextInferenceProvider };
      }
      appendAssistant(response, toolPart(firstTool, id, "input-available", { operationGroupId: id, summary: group.summary, commands: group.commands }));
      return { ...(await applyGroup(group)), ...(nextInferenceProvider ? { nextInferenceProvider } : {}) };
    }
    if (response.runWorkflow) {
      if (!EXPLICIT_RUN_REQUEST.test(userRequest)) {
        appendAssistant({ message: "workflow_ai_explicit_run_required" }, toolPart("run_workflow", makeId("workflow-ai-run"), "output-denied", { reason: "explicit_run_required" }));
        return { status: "rejected", error: "workflow_ai_explicit_run_required", nextInferenceProvider };
      }
      const toolCallId = makeId("workflow-ai-run");
      pending.set(toolCallId, { kind: "run", response });
      appendAssistant(response, toolPart("run_workflow", toolCallId, "approval-requested", { workflowId: input.workflowId, revision: definition.revision, preflightIssues: validateWorkflowDefinition(definition) }));
      return { status: "approval_required", toolCallId, nextInferenceProvider };
    }
    appendAssistant(response);
    return { status: "completed", nextInferenceProvider };
  };

  const approve = async (toolCallId: string) => {
    const item = pending.get(toolCallId);
    if (!item) return { status: "failed", toolCallId, error: "workflow_ai_approval_not_found" } as WorkflowAiControllerResult;
    pending.delete(toolCallId);
    if (item.kind === "operation") return applyGroup(item.group);
    const issues = validateWorkflowDefinition(definition);
    if (issues.length) {
      updateTool(toolCallId, "output-error", "workflow_ai_preflight_failed");
      return { status: "failed", toolCallId, error: "workflow_ai_preflight_failed" } as WorkflowAiControllerResult;
    }
    if (!input.onRun) {
      updateTool(toolCallId, "output-error", "workflow_ai_run_unavailable");
      return { status: "failed", toolCallId, error: "workflow_ai_run_unavailable" } as WorkflowAiControllerResult;
    }
    await input.onRun(definition);
    updateTool(toolCallId, "output-available", { workflowId: input.workflowId, revision: definition.revision, status: "submitted" });
    return { status: "completed", toolCallId } as WorkflowAiControllerResult;
  };

  const reject = async (toolCallId: string) => {
    if (!pending.delete(toolCallId)) return { status: "failed", toolCallId, error: "workflow_ai_approval_not_found" } as WorkflowAiControllerResult;
    updateTool(toolCallId, "output-denied", { reason: "user_rejected" });
    return { status: "rejected", toolCallId } as WorkflowAiControllerResult;
  };

  const send = async (text: string) => {
    if (!input.requestAssistant) return { status: "failed", error: "workflow_ai_transport_unavailable" } as WorkflowAiControllerResult;
    const request = text.trim();
    if (!request) return { status: "rejected", error: "workflow_ai_empty_request" } as WorkflowAiControllerResult;
    messages = [...messages, createDesktopUIMessage({ id: makeId("workflow-ai-user"), role: "user", conversationId, content: request })];
    const currentContext = context();
    const response = await input.requestAssistant({ prompt: createWorkflowAiPrompt(currentContext, request), context: currentContext });
    return handleAssistantResponse(response, request);
  };

  return {
    get messages() { return messages; },
    get operationGroups() { return operationGroups; },
    get context() { return context(); },
    send,
    handleAssistantResponse,
    approve,
    reject,
    focus: input.onFocusNodes,
    sync: (state) => {
      definition = state.definition;
      if (state.selectedNodeKeys) selectedNodeKeys = [...state.selectedNodeKeys];
      if (state.operationGroups) operationGroups = [...state.operationGroups];
    },
  };
}

export const WORKFLOW_AI_ALLOWED_TOOLS = WORKFLOW_AI_TOOL_NAMES;
