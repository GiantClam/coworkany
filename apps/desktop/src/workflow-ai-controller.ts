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
  validateWorkflowDefinition,
  type WorkflowDefinitionEnvelope,
} from "@coworkany/workflow-core";
import {
  configuredModelOptions,
  supportsProviderCapability,
  type DesktopProviderConfig,
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

const ALLOWED_RESPONSE_KEYS = new Set(["message", "operationGroup", "focusNodeKeys", "runWorkflow"]);
const EXPLICIT_RUN_REQUEST = /(?:\brun\b|\btest\b|\bexecute\b|运行|测试|执行)/iu;

export type WorkflowAiAssistantResponse = {
  readonly message: string;
  readonly operationGroup?: {
    readonly summary: string;
    readonly commands: readonly WorkflowAiCommand[];
  };
  readonly focusNodeKeys?: readonly string[];
  readonly runWorkflow?: boolean;
};

export type WorkflowAiControllerResult = {
  readonly status: "applied" | "approval_required" | "rejected" | "completed" | "failed";
  readonly toolCallId?: string;
  readonly operationGroup?: WorkflowAiOperationGroup;
  readonly error?: string;
};

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
  readonly onRun?: (definition: WorkflowDefinitionEnvelope) => void | Promise<void>;
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

function jsonPayload(text: string) {
  const marker = text.match(/<workflow-ai-response>\s*([\s\S]*?)\s*<\/workflow-ai-response>/iu)?.[1];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/iu)?.[1];
  return (marker ?? fenced ?? text).trim();
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

  const { name: _name, ...input } = command;
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
  if (record.runWorkflow !== undefined && typeof record.runWorkflow !== "boolean") throw new Error("workflow_ai_invalid_run_request");
  return {
    message: record.message.trim(),
    ...(operationGroup ? { operationGroup } : {}),
    ...(focusNodeKeys ? { focusNodeKeys } : {}),
    ...(record.runWorkflow === true ? { runWorkflow: true } : {}),
  };
}

function commandProviderId(command: WorkflowAiCommand) {
  if (command.type !== "update_node" || !command.patch.config) return undefined;
  const config = command.patch.config;
  const value = config.selectedProviderId ?? config.provider;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function operationNeedsApproval(commands: readonly WorkflowAiCommand[], definition: WorkflowDefinitionEnvelope, providers: readonly WorkflowAiProviderOption[]) {
  if (commands.filter((command) => command.type === "delete_node").length > 1) return "destructive_batch_delete";
  for (const command of commands) {
    const providerId = commandProviderId(command);
    if (!providerId) continue;
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider?.available) return "provider_unavailable";
    const node = command.type === "update_node" ? definition.nodes.find((candidate) => candidate.nodeKey === command.nodeKey) : undefined;
    const currentProviderId = node && (typeof node.config.selectedProviderId === "string" ? node.config.selectedProviderId : typeof node.config.provider === "string" ? node.config.provider : undefined);
    const currentProvider = providers.find((candidate) => candidate.id === currentProviderId);
    if (currentProvider && currentProvider.capabilities.join("|") !== provider.capabilities.join("|")) return "provider_capability_change";
    if (currentProvider?.estimatedCost !== undefined && provider.estimatedCost !== undefined && provider.estimatedCost > currentProvider.estimatedCost) return "provider_cost_increase";
    if (currentProviderId && currentProviderId !== providerId) return "provider_change";
  }
  return undefined;
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
      const completed: WorkflowAiOperationGroup = { ...group, resultRevision: applied.definition.revision, status: "applied" };
      await input.client.workflows.applyAiOperation({
        workflowId: input.workflowId,
        expectedRevision: group.baseRevision,
        definition: applied.definition,
        operationGroup: completed,
      });
      definition = applied.definition;
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
    if (response.focusNodeKeys?.length) input.onFocusNodes(response.focusNodeKeys);
    if (response.operationGroup) {
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
      const reason = operationNeedsApproval(group.commands, definition, providerOptions);
      const firstTool = group.commands[0].type;
      if (reason) {
        pending.set(id, { kind: "operation", response, group });
        appendAssistant(response, toolPart(firstTool, id, "approval-requested", { operationGroupId: id, summary: group.summary, commands: group.commands, reason }));
        return { status: "approval_required", toolCallId: id, operationGroup: group };
      }
      appendAssistant(response, toolPart(firstTool, id, "input-available", { operationGroupId: id, summary: group.summary, commands: group.commands }));
      return applyGroup(group);
    }
    if (response.runWorkflow) {
      if (!EXPLICIT_RUN_REQUEST.test(userRequest)) {
        appendAssistant({ message: "workflow_ai_explicit_run_required" }, toolPart("run_workflow", makeId("workflow-ai-run"), "output-denied", { reason: "explicit_run_required" }));
        return { status: "rejected", error: "workflow_ai_explicit_run_required" };
      }
      const toolCallId = makeId("workflow-ai-run");
      pending.set(toolCallId, { kind: "run", response });
      appendAssistant(response, toolPart("run_workflow", toolCallId, "approval-requested", { workflowId: input.workflowId, revision: definition.revision, preflightIssues: validateWorkflowDefinition(definition) }));
      return { status: "approval_required", toolCallId };
    }
    appendAssistant(response);
    return { status: "completed" };
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
