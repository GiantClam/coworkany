import {
  canonicalizeWorkflowDefinition,
  hashWorkflowDefinition,
  validateWorkflowDefinition,
  type WorkflowDefinitionEdgeV2,
  type WorkflowDefinitionEnvelope,
  type WorkflowDefinitionNodeV2,
  type WorkflowValidationIssue,
} from "./definition";
import { workflowNodeRegistry } from "./node-definitions/registry";

export type WorkflowAiCommand =
  | { type: "add_node"; node: WorkflowDefinitionNodeV2 }
  | { type: "update_node"; nodeKey: string; patch: Partial<WorkflowDefinitionNodeV2> }
  | { type: "copy_node"; sourceNodeKey: string; node: WorkflowDefinitionNodeV2 }
  | { type: "delete_node"; nodeKey: string }
  | { type: "connect_nodes"; edge: WorkflowDefinitionEdgeV2 }
  | { type: "disconnect_nodes"; edgeKey: string }
  | { type: "update_port_mapping"; nodeKey: string; portId: string; value: unknown }
  | { type: "group_nodes"; nodeKeys: string[]; groupNode: WorkflowDefinitionNodeV2 }
  | { type: "ungroup_nodes"; nodeKey: string }
  | { type: "create_control_structure"; node: WorkflowDefinitionNodeV2 }
  | { type: "layout_nodes"; nodeKeys: string[]; positions: Record<string, { x: number; y: number }> };

export type WorkflowAiOperationGroup = {
  id: string;
  conversationId: string;
  workflowId: string;
  baseRevision: number;
  resultRevision: number | null;
  commands: readonly WorkflowAiCommand[];
  status: "applied" | "rolled_back" | "failed";
  summary: string;
  createdAt: string;
};

export type WorkflowAiOperationErrorCode =
  | "workflow_ai_revision_conflict"
  | "workflow_ai_invalid_command"
  | "workflow_ai_validation_failed";

export class WorkflowAiOperationError extends Error {
  readonly code: WorkflowAiOperationErrorCode;
  readonly details?: unknown;

  constructor(code: WorkflowAiOperationErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "WorkflowAiOperationError";
    this.code = code;
    this.details = details;
  }
}

function cloneDefinition(definition: WorkflowDefinitionEnvelope): WorkflowDefinitionEnvelope {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => ({ ...node, config: { ...node.config } })),
    edges: definition.edges.map((edge) => ({ ...edge })),
    ...(definition.metadata ? { metadata: { ...definition.metadata } } : {}),
  };
}

function invalid(message: string, details?: unknown): never {
  throw new WorkflowAiOperationError("workflow_ai_invalid_command", message, details);
}

function requireNode(definition: WorkflowDefinitionEnvelope, nodeKey: string) {
  const node = definition.nodes.find((candidate) => candidate.nodeKey === nodeKey);
  if (!node) invalid(`Workflow node does not exist: ${nodeKey}`, { nodeKey });
  return node;
}

function assertNewNode(definition: WorkflowDefinitionEnvelope, node: WorkflowDefinitionNodeV2) {
  if (definition.nodes.some((candidate) => candidate.nodeKey === node.nodeKey)) invalid(`Workflow node already exists: ${node.nodeKey}`, { nodeKey: node.nodeKey });
  const registered = workflowNodeRegistry.get(node.type);
  if (!registered) invalid(`Unsupported workflow node type: ${node.type}`, { nodeKey: node.nodeKey, nodeType: node.type });
  if (node.nodeVersion < 1 || node.nodeVersion > registered.version) invalid(`Unsupported workflow node version: ${node.nodeVersion}`, { nodeKey: node.nodeKey, nodeType: node.type });
}

function withValidHash(definition: WorkflowDefinitionEnvelope) {
  const unhashed = { ...definition, definitionHash: "" };
  return { ...unhashed, definitionHash: hashWorkflowDefinition(unhashed) };
}

function assertValid(definition: WorkflowDefinitionEnvelope) {
  const candidate = withValidHash(definition);
  const issues = validateWorkflowDefinition(candidate);
  if (issues.length) {
    throw new WorkflowAiOperationError("workflow_ai_validation_failed", "Workflow AI command produced an invalid definition", issues);
  }
  return candidate;
}

function addNode(definition: WorkflowDefinitionEnvelope, node: WorkflowDefinitionNodeV2) {
  assertNewNode(definition, node);
  return { ...definition, nodes: [...definition.nodes, { ...node, config: { ...node.config } }] };
}

function applyCommand(definition: WorkflowDefinitionEnvelope, command: WorkflowAiCommand, changedNodeKeys: Set<string>): WorkflowDefinitionEnvelope {
  switch (command.type) {
    case "add_node":
      changedNodeKeys.add(command.node.nodeKey);
      return addNode(definition, command.node);
    case "update_node": {
      const current = requireNode(definition, command.nodeKey);
      if (command.patch.nodeKey !== undefined && command.patch.nodeKey !== command.nodeKey) invalid("update_node cannot rename nodeKey", { nodeKey: command.nodeKey });
      const next = { ...current, ...command.patch, nodeKey: current.nodeKey, config: command.patch.config ? { ...current.config, ...command.patch.config } : current.config };
      const registered = workflowNodeRegistry.get(next.type);
      if (!registered) invalid(`Unsupported workflow node type: ${next.type}`, { nodeKey: command.nodeKey, nodeType: next.type });
      if (next.nodeVersion < 1 || next.nodeVersion > registered.version) invalid(`Unsupported workflow node version: ${next.nodeVersion}`, { nodeKey: command.nodeKey, nodeType: next.type });
      changedNodeKeys.add(command.nodeKey);
      return { ...definition, nodes: definition.nodes.map((node) => node.nodeKey === command.nodeKey ? next : node) };
    }
    case "copy_node": {
      const source = requireNode(definition, command.sourceNodeKey);
      if (source.type !== command.node.type) invalid("copy_node must preserve the source node type", { sourceNodeKey: command.sourceNodeKey, nodeType: command.node.type });
      changedNodeKeys.add(command.node.nodeKey);
      return addNode(definition, command.node);
    }
    case "delete_node": {
      requireNode(definition, command.nodeKey);
      changedNodeKeys.add(command.nodeKey);
      return {
        ...definition,
        nodes: definition.nodes.filter((node) => node.nodeKey !== command.nodeKey),
        edges: definition.edges.filter((edge) => edge.sourceNodeKey !== command.nodeKey && edge.targetNodeKey !== command.nodeKey),
      };
    }
    case "connect_nodes":
      requireNode(definition, command.edge.sourceNodeKey);
      requireNode(definition, command.edge.targetNodeKey);
      if (definition.edges.some((edge) => edge.edgeKey === command.edge.edgeKey)) invalid(`Workflow edge already exists: ${command.edge.edgeKey}`, { edgeKey: command.edge.edgeKey });
      changedNodeKeys.add(command.edge.sourceNodeKey);
      changedNodeKeys.add(command.edge.targetNodeKey);
      return { ...definition, edges: [...definition.edges, { ...command.edge }] };
    case "disconnect_nodes": {
      const edge = definition.edges.find((candidate) => candidate.edgeKey === command.edgeKey);
      if (!edge) invalid(`Workflow edge does not exist: ${command.edgeKey}`, { edgeKey: command.edgeKey });
      changedNodeKeys.add(edge.sourceNodeKey);
      changedNodeKeys.add(edge.targetNodeKey);
      return { ...definition, edges: definition.edges.filter((candidate) => candidate.edgeKey !== command.edgeKey) };
    }
    case "update_port_mapping": {
      const current = requireNode(definition, command.nodeKey);
      const registered = workflowNodeRegistry.require(current.type);
      if (!registered.inputs.some((port) => port.id === command.portId)) invalid(`Workflow input port does not exist: ${command.portId}`, { nodeKey: command.nodeKey, portId: command.portId });
      const portMappings = typeof current.config.portMappings === "object" && current.config.portMappings !== null && !Array.isArray(current.config.portMappings)
        ? current.config.portMappings as Record<string, unknown>
        : {};
      changedNodeKeys.add(command.nodeKey);
      return { ...definition, nodes: definition.nodes.map((node) => node.nodeKey === command.nodeKey ? { ...node, config: { ...node.config, portMappings: { ...portMappings, [command.portId]: command.value } } } : node) };
    }
    case "group_nodes": {
      if (!command.nodeKeys.length) invalid("group_nodes requires at least one member node");
      command.nodeKeys.forEach((nodeKey) => requireNode(definition, nodeKey));
      const registered = workflowNodeRegistry.get(command.groupNode.type);
      if (!registered || registered.category !== "control") invalid("group_nodes requires a registered control node", { nodeType: command.groupNode.type });
      const groupNode = { ...command.groupNode, config: { ...command.groupNode.config, memberNodeKeys: [...new Set(command.nodeKeys)] } };
      command.nodeKeys.forEach((nodeKey) => changedNodeKeys.add(nodeKey));
      changedNodeKeys.add(groupNode.nodeKey);
      return addNode(definition, groupNode);
    }
    case "ungroup_nodes": {
      const groupNode = requireNode(definition, command.nodeKey);
      const registered = workflowNodeRegistry.require(groupNode.type);
      if (registered.category !== "control" || !Array.isArray(groupNode.config.memberNodeKeys)) invalid("ungroup_nodes requires a grouped control node", { nodeKey: command.nodeKey });
      for (const memberNodeKey of groupNode.config.memberNodeKeys) if (typeof memberNodeKey === "string") changedNodeKeys.add(memberNodeKey);
      changedNodeKeys.add(command.nodeKey);
      return { ...definition, nodes: definition.nodes.filter((node) => node.nodeKey !== command.nodeKey), edges: definition.edges.filter((edge) => edge.sourceNodeKey !== command.nodeKey && edge.targetNodeKey !== command.nodeKey) };
    }
    case "create_control_structure": {
      const registered = workflowNodeRegistry.get(command.node.type);
      if (!registered || registered.category !== "control") invalid("create_control_structure requires a registered control node", { nodeType: command.node.type });
      changedNodeKeys.add(command.node.nodeKey);
      return addNode(definition, command.node);
    }
    case "layout_nodes": {
      if (!command.nodeKeys.length) invalid("layout_nodes requires at least one node");
      const requested = new Set(command.nodeKeys);
      for (const nodeKey of requested) {
        requireNode(definition, nodeKey);
        const position = command.positions[nodeKey];
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) invalid(`layout_nodes requires a finite position for ${nodeKey}`, { nodeKey });
        changedNodeKeys.add(nodeKey);
      }
      return { ...definition, nodes: definition.nodes.map((node) => requested.has(node.nodeKey) ? { ...node, positionX: command.positions[node.nodeKey].x, positionY: command.positions[node.nodeKey].y } : node) };
    }
  }
}

export function applyWorkflowAiCommands(input: {
  definition: WorkflowDefinitionEnvelope;
  baseRevision: number;
  commands: readonly WorkflowAiCommand[];
}): { definition: WorkflowDefinitionEnvelope; changedNodeKeys: readonly string[] } {
  if (input.definition.revision !== input.baseRevision) {
    throw new WorkflowAiOperationError("workflow_ai_revision_conflict", "Workflow revision changed before the AI operation could be applied", { expectedRevision: input.baseRevision, actualRevision: input.definition.revision });
  }
  if (!input.commands.length) invalid("A workflow AI operation group must contain at least one command");

  const changedNodeKeys = new Set<string>();
  let next = { ...cloneDefinition(input.definition), revision: input.baseRevision + 1 };
  for (const command of input.commands) next = assertValid(applyCommand(next, command, changedNodeKeys));
  const definition = canonicalizeWorkflowDefinition(assertValid(next));
  return { definition, changedNodeKeys: [...changedNodeKeys].sort() };
}

export function workflowAiValidationIssues(error: unknown): readonly WorkflowValidationIssue[] {
  return error instanceof WorkflowAiOperationError && error.code === "workflow_ai_validation_failed" && Array.isArray(error.details)
    ? error.details as readonly WorkflowValidationIssue[]
    : [];
}
