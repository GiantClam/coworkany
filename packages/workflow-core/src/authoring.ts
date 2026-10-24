import { hashWorkflowDefinition, validateWorkflowDefinition, type WorkflowDefinitionEnvelope, type WorkflowDefinitionPortValueKind, type WorkflowValidationIssue } from "./definition";
import { workflowNodeRegistry } from "./node-definitions/registry";

export const WORKFLOW_AUTHORING_PLAN_VERSION = 1 as const;

export const WORKFLOW_CAPABILITIES = [
  "text-input",
  "file-input",
  "text-generation",
  "article-generation",
  "image-generation",
  "video-generation",
  "audio-generation",
  "presentation-generation",
  "media-transform",
  "controlled-iteration",
  "result-composition",
  "artifact-persistence",
] as const;

export type WorkflowCapability = (typeof WORKFLOW_CAPABILITIES)[number];

export type WorkflowAuthoringValidationResult = {
  readonly status: "valid" | "invalid" | "needs_configuration";
  readonly issues: readonly string[];
  readonly repairAttempt: 0 | 1;
};

export type WorkflowAuthoringPlan<TOperation = unknown> = {
  readonly schemaVersion: typeof WORKFLOW_AUTHORING_PLAN_VERSION;
  readonly intent: string;
  readonly requiredCapabilities: readonly WorkflowCapability[];
  readonly selectedTemplate: string | null;
  readonly templateVersion: number | null;
  readonly assumptions: readonly string[];
  readonly operations: readonly TOperation[];
  readonly validationResult: WorkflowAuthoringValidationResult;
};

export type WorkflowAuthoringIssue = {
  readonly code: "workflow_required_capability_missing" | "workflow_capability_path_missing";
  readonly capability: WorkflowCapability;
  readonly message: string;
};

export type GoldenWorkflowTemplateDescriptor = {
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly capabilities: readonly WorkflowCapability[];
  readonly nodeTypes: readonly string[];
  readonly requiredProviderCapabilities: readonly string[];
  readonly subgraphKeys?: readonly string[];
};

export type GoldenWorkflowTemplateMatch = {
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly capabilities: readonly WorkflowCapability[];
  readonly coverage: number;
  readonly missingCapabilities: readonly WorkflowCapability[];
  readonly estimatedAddedNodes: number;
  readonly pendingConfigurationCount: number;
};

export type WorkflowGraphBoundary = {
  readonly boundaryKey: string;
  readonly nodeKey: string;
  readonly portId: string;
  readonly dataType: WorkflowDefinitionPortValueKind;
  readonly disposition: "external" | "bindable";
  readonly maxBindings: number | "many";
};

export type WorkflowComposableGraphDescriptor = {
  readonly graphKind: "primary" | "subgraph";
  readonly graphKey: string;
  readonly definition: WorkflowDefinitionEnvelope;
  readonly inputs: readonly WorkflowGraphBoundary[];
  readonly outputs: readonly WorkflowGraphBoundary[];
};

export type WorkflowGoldenSubgraphDescriptor = WorkflowComposableGraphDescriptor & {
  readonly graphKind: "subgraph";
  readonly subgraphKey: string;
  readonly subgraphVersion: number;
  readonly capabilities: readonly WorkflowCapability[];
  readonly validatedProvenance: string;
  /** Set only by the registry factory; provenance text alone is not authority. */
  readonly registered?: true;
};

export type WorkflowGraphBoundaryRef = { readonly graphKind: "primary" | "subgraph"; readonly graphKey: string; readonly boundaryKey: string };
export type WorkflowGraphBinding = { readonly from: WorkflowGraphBoundaryRef; readonly to: WorkflowGraphBoundaryRef };
export type WorkflowGraphCompositionIssueCode = "duplicate_entry_boundary" | "duplicate_output_boundary" | "boundary_binding_cardinality_exceeded" | "incompatible_boundary_port" | "unknown_boundary" | "full_template_not_composable" | "duplicate_node_key" | "composed_key_too_long" | "invalid_composed_graph";
export type WorkflowGraphCompositionIssue = { readonly code: WorkflowGraphCompositionIssueCode; readonly message: string; readonly boundaryKey?: string };
export type WorkflowGraphCompositionResult =
  | { readonly ok: true; readonly definition: WorkflowDefinitionEnvelope; readonly inputs: readonly WorkflowGraphBoundary[]; readonly outputs: readonly WorkflowGraphBoundary[] }
  | { readonly ok: false; readonly issues: readonly WorkflowGraphCompositionIssue[] };

const CAPABILITY_SET = new Set<string>(WORKFLOW_CAPABILITIES);
const PLAN_KEYS = new Set(["schemaVersion", "intent", "requiredCapabilities", "selectedTemplate", "templateVersion", "assumptions", "operations", "validationResult"]);
const VALIDATION_KEYS = new Set(["status", "issues", "repairAttempt"]);

const NODE_CAPABILITIES: Readonly<Record<string, readonly WorkflowCapability[]>> = {
  workflow_input: ["text-input"],
  text_input: ["text-input"],
  upload: ["file-input"],
  writer: ["text-generation", "article-generation"],
  llm_generate: ["text-generation"],
  agent_execute: ["text-generation"],
  image_generate: ["image-generation"],
  video_generate: ["video-generation"],
  music_generate: ["audio-generation"],
  voice_synthesis: ["audio-generation"],
  voice_clone: ["audio-generation"],
  audio_generate: ["audio-generation"],
  ppt_generate: ["presentation-generation"],
  video_process: ["media-transform"],
  audio_process: ["media-transform"],
  video_compose: ["media-transform", "result-composition"],
  foreach: ["controlled-iteration"],
  collect: ["controlled-iteration", "result-composition"],
  output: ["result-composition"],
  product_store: ["result-composition", "artifact-persistence"],
  file_create: ["artifact-persistence"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) throw new Error(code);
  return [...new Set(value.map((item) => item.trim()))];
}

export function parseWorkflowAuthoringPlan<TOperation = unknown>(value: unknown): WorkflowAuthoringPlan<TOperation> {
  if (!isRecord(value) || Object.keys(value).some((key) => !PLAN_KEYS.has(key))) throw new Error("workflow_ai_invalid_plan");
  if (value.schemaVersion !== WORKFLOW_AUTHORING_PLAN_VERSION) throw new Error("workflow_ai_plan_version_unsupported");
  if (typeof value.intent !== "string" || !value.intent.trim()) throw new Error("workflow_ai_plan_intent_required");
  const requiredCapabilities = stringList(value.requiredCapabilities, "workflow_ai_invalid_required_capabilities");
  if (requiredCapabilities.some((capability) => !CAPABILITY_SET.has(capability))) throw new Error("workflow_ai_unknown_required_capability");
  if (value.selectedTemplate !== null && (typeof value.selectedTemplate !== "string" || !value.selectedTemplate.trim())) throw new Error("workflow_ai_invalid_selected_template");
  if (value.templateVersion !== null && (!Number.isInteger(value.templateVersion) || Number(value.templateVersion) < 1)) throw new Error("workflow_ai_invalid_template_version");
  if ((value.selectedTemplate === null) !== (value.templateVersion === null)) throw new Error("workflow_ai_template_provenance_incomplete");
  const assumptions = stringList(value.assumptions, "workflow_ai_invalid_assumptions");
  if (!Array.isArray(value.operations) || !value.operations.every(isRecord)) throw new Error("workflow_ai_invalid_plan_operations");
  if (!isRecord(value.validationResult) || Object.keys(value.validationResult).some((key) => !VALIDATION_KEYS.has(key))) throw new Error("workflow_ai_invalid_validation_result");
  const validationResult = value.validationResult;
  if (validationResult.status !== "valid" && validationResult.status !== "invalid" && validationResult.status !== "needs_configuration") throw new Error("workflow_ai_invalid_validation_result");
  const issues = stringList(validationResult.issues, "workflow_ai_invalid_validation_result");
  if (validationResult.repairAttempt !== 0 && validationResult.repairAttempt !== 1) throw new Error("workflow_ai_invalid_repair_attempt");
  return {
    schemaVersion: WORKFLOW_AUTHORING_PLAN_VERSION,
    intent: value.intent.trim(),
    requiredCapabilities: requiredCapabilities as WorkflowCapability[],
    selectedTemplate: value.selectedTemplate === null ? null : value.selectedTemplate.trim(),
    templateVersion: value.templateVersion === null ? null : Number(value.templateVersion),
    assumptions,
    operations: value.operations as TOperation[],
    validationResult: { status: validationResult.status, issues, repairAttempt: validationResult.repairAttempt },
  };
}

function graphReachability(definition: WorkflowDefinitionEnvelope) {
  const forward = new Map(definition.nodes.map((node) => [node.nodeKey, [] as string[]]));
  const reverse = new Map(definition.nodes.map((node) => [node.nodeKey, [] as string[]]));
  for (const edge of definition.edges) {
    forward.get(edge.sourceNodeKey)?.push(edge.targetNodeKey);
    reverse.get(edge.targetNodeKey)?.push(edge.sourceNodeKey);
  }
  const sourceKeys = definition.nodes.filter((node) => ["workflow_input", "text_input", "upload"].includes(node.type)).map((node) => node.nodeKey);
  const sinkKeys = definition.nodes.filter((node) => ["output", "product_store", "file_create"].includes(node.type)).map((node) => node.nodeKey);
  const visit = (starts: readonly string[], adjacency: ReadonlyMap<string, readonly string[]>) => {
    const visited = new Set<string>();
    const pending = [...starts];
    while (pending.length) {
      const current = pending.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(adjacency.get(current) ?? []));
    }
    return visited;
  };
  return {
    // A graph without an explicit source or sink has no executable
    // input-to-output path.  Treating every node as reachable here makes an
    // orphan AI node appear to provide a capability merely because the graph
    // happens to contain no boundary nodes.
    fromSource: sourceKeys.length ? visit(sourceKeys, forward) : new Set<string>(),
    toSink: sinkKeys.length ? visit(sinkKeys, reverse) : new Set<string>(),
  };
}

export function workflowCapabilitiesForNodeType(nodeType: string): readonly WorkflowCapability[] {
  return NODE_CAPABILITIES[nodeType] ?? [];
}

export function deriveWorkflowCapabilities(definition: WorkflowDefinitionEnvelope): readonly WorkflowCapability[] {
  if (validateWorkflowDefinition(definition).length) return [];
  const { fromSource, toSink } = graphReachability(definition);
  const result = new Set<WorkflowCapability>();
  for (const node of definition.nodes) {
    if (!fromSource.has(node.nodeKey) || !toSink.has(node.nodeKey)) continue;
    for (const capability of workflowCapabilitiesForNodeType(node.type)) result.add(capability);
  }
  return WORKFLOW_CAPABILITIES.filter((capability) => result.has(capability));
}

export function validateWorkflowAuthoringSemantics(definition: WorkflowDefinitionEnvelope, requiredCapabilities: readonly WorkflowCapability[]): readonly WorkflowAuthoringIssue[] {
  const actual = new Set(deriveWorkflowCapabilities(definition));
  return [...new Set(requiredCapabilities)].flatMap((capability) => actual.has(capability) ? [] : [{
    code: "workflow_required_capability_missing" as const,
    capability,
    message: `Workflow does not provide required capability on an executable input-to-output path: ${capability}`,
  }]);
}

export function validateWorkflowAuthoringResult(definition: WorkflowDefinitionEnvelope, requiredCapabilities: readonly WorkflowCapability[]): {
  readonly graphIssues: readonly WorkflowValidationIssue[];
  readonly semanticIssues: readonly WorkflowAuthoringIssue[];
  readonly valid: boolean;
} {
  const graphIssues = validateWorkflowDefinition(definition);
  const semanticIssues = graphIssues.length ? [] : validateWorkflowAuthoringSemantics(definition, requiredCapabilities);
  return { graphIssues, semanticIssues, valid: graphIssues.length === 0 && semanticIssues.length === 0 };
}

export function layoutWorkflowDeterministically(definition: WorkflowDefinitionEnvelope, changedNodeKeys: readonly string[] = definition.nodes.map((node) => node.nodeKey)): WorkflowDefinitionEnvelope {
  const changed = new Set(changedNodeKeys);
  if (!changed.size) return definition;
  const incoming = new Map(definition.nodes.map((node) => [node.nodeKey, 0]));
  const outgoing = new Map(definition.nodes.map((node) => [node.nodeKey, [] as string[]]));
  for (const edge of definition.edges) {
    incoming.set(edge.targetNodeKey, (incoming.get(edge.targetNodeKey) ?? 0) + 1);
    outgoing.get(edge.sourceNodeKey)?.push(edge.targetNodeKey);
  }
  const ready = definition.nodes.filter((node) => (incoming.get(node.nodeKey) ?? 0) === 0).map((node) => node.nodeKey).sort();
  const level = new Map<string, number>();
  while (ready.length) {
    const nodeKey = ready.shift()!;
    const nodeLevel = level.get(nodeKey) ?? 0;
    for (const target of [...(outgoing.get(nodeKey) ?? [])].sort()) {
      level.set(target, Math.max(level.get(target) ?? 0, nodeLevel + 1));
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
    ready.sort();
  }
  const rows = new Map<number, string[]>();
  for (const node of definition.nodes) {
    const nodeLevel = level.get(node.nodeKey) ?? 0;
    rows.set(nodeLevel, [...(rows.get(nodeLevel) ?? []), node.nodeKey].sort());
  }
  const nodes = definition.nodes.map((node) => {
    if (!changed.has(node.nodeKey)) return node;
    const nodeLevel = level.get(node.nodeKey) ?? 0;
    const row = rows.get(nodeLevel) ?? [node.nodeKey];
    return { ...node, positionX: nodeLevel * 408, positionY: row.indexOf(node.nodeKey) * 352 };
  });
  const unhashed = { ...definition, nodes, definitionHash: "" };
  return { ...unhashed, definitionHash: hashWorkflowDefinition(unhashed) };
}

export function matchGoldenWorkflowTemplates(input: {
  readonly templates: readonly GoldenWorkflowTemplateDescriptor[];
  readonly requiredCapabilities: readonly WorkflowCapability[];
  readonly existingNodeTypes?: readonly string[];
  readonly configuredProviderCapabilities?: readonly string[];
}): readonly GoldenWorkflowTemplateMatch[] {
  const required = [...new Set(input.requiredCapabilities)];
  const existing = new Set(input.existingNodeTypes ?? []);
  const configured = new Set(input.configuredProviderCapabilities ?? []);
  return input.templates.map((template) => {
    const templateCapabilities = new Set(template.capabilities);
    const missingCapabilities = required.filter((capability) => !templateCapabilities.has(capability));
    const coverage = required.length ? (required.length - missingCapabilities.length) / required.length : 1;
    const estimatedAddedNodes = template.nodeTypes.filter((nodeType) => !existing.has(nodeType)).length;
    const pendingConfigurationCount = template.requiredProviderCapabilities.filter((capability) => !configured.has(capability)).length;
    return { templateKey: template.templateKey, templateVersion: template.templateVersion, capabilities: template.capabilities, coverage, missingCapabilities, estimatedAddedNodes, pendingConfigurationCount };
  }).filter((match) => match.coverage > 0 || required.length === 0).sort((left, right) =>
    right.coverage - left.coverage
    || left.estimatedAddedNodes - right.estimatedAddedNodes
    || left.pendingConfigurationCount - right.pendingConfigurationCount
    || left.templateKey.localeCompare(right.templateKey));
}

export function validateGoldenWorkflowTemplateDescriptor(descriptor: GoldenWorkflowTemplateDescriptor): readonly string[] {
  const issues: string[] = [];
  if (!descriptor.templateKey.trim()) issues.push("golden_template_key_required");
  if (!Number.isInteger(descriptor.templateVersion) || descriptor.templateVersion < 1) issues.push("golden_template_version_invalid");
  if (!descriptor.capabilities.length || descriptor.capabilities.some((capability) => !CAPABILITY_SET.has(capability))) issues.push("golden_template_capabilities_invalid");
  if (!descriptor.nodeTypes.length || descriptor.nodeTypes.some((type) => !workflowNodeRegistry.get(type))) issues.push("golden_template_node_types_invalid");
  return issues;
}

const boundaryIdentity = (ref: WorkflowGraphBoundaryRef) => `${ref.graphKind}\u0000${ref.graphKey}\u0000${ref.boundaryKey}`;
const composedNodeKey = (kind: string, graph: string, key: string) => `n:${encodeURIComponent(kind)}:${encodeURIComponent(graph)}:${encodeURIComponent(key)}`;
const composedEdgeKey = (kind: string, graph: string, key: string) => `e:${encodeURIComponent(kind)}:${encodeURIComponent(graph)}:${encodeURIComponent(key)}`;

/** Compose one primary graph with explicitly registered boundary-based subgraphs. */
export function composeWorkflowComposableGraphs(input: {
  readonly primary: WorkflowComposableGraphDescriptor;
  readonly subgraphs: readonly WorkflowComposableGraphDescriptor[];
  readonly bindings: readonly WorkflowGraphBinding[];
  /** Registry-owned allowlist. Omit to reject every subgraph as unregistered. */
  readonly registeredSubgraphKeys?: readonly string[];
}): WorkflowGraphCompositionResult {
  const issues: WorkflowGraphCompositionIssue[] = [];
  if (input.primary.graphKind !== "primary") issues.push({ code: "invalid_composed_graph", message: "Exactly one primary graph is required" });
  const graphs = [input.primary, ...input.subgraphs];
  const graphByKey = new Map(graphs.map((graph) => [`${graph.graphKind}\u0000${graph.graphKey}`, graph]));
  for (const graph of input.subgraphs) {
    const candidate = graph as Partial<WorkflowGoldenSubgraphDescriptor>;
    if (candidate.graphKind !== "subgraph" || !candidate.subgraphKey || !Number.isInteger(candidate.subgraphVersion) || !candidate.validatedProvenance || candidate.registered !== true || !input.registeredSubgraphKeys?.includes(candidate.subgraphKey)) issues.push({ code: "full_template_not_composable", message: `Graph ${graph.graphKey} is not a registered validated subgraph` });
  }
  const lookup = (ref: WorkflowGraphBoundaryRef, direction: "input" | "output") => {
    const graph = graphByKey.get(`${ref.graphKind}\u0000${ref.graphKey}`);
    if (!graph) return undefined;
    return graph[direction === "input" ? "inputs" : "outputs"].find((boundary) => boundary.boundaryKey === ref.boundaryKey);
  };
  const bindingCounts = new Map<string, number>();
  for (const binding of input.bindings) {
    const source = lookup(binding.from, "output");
    const target = lookup(binding.to, "input");
    if (!source || !target) { issues.push({ code: "unknown_boundary", message: "Binding references an unknown boundary" }); continue; }
    if (source.disposition !== "bindable" || target.disposition !== "bindable") { issues.push({ code: "incompatible_boundary_port", message: "Only bindable boundaries may be bound" }); continue; }
    if (source.dataType !== target.dataType) { issues.push({ code: "incompatible_boundary_port", message: `Boundary data types differ: ${source.dataType} -> ${target.dataType}` }); continue; }
    for (const [ref, boundary] of [[binding.from, source], [binding.to, target]] as const) {
      const key = boundaryIdentity(ref); const count = (bindingCounts.get(key) ?? 0) + 1;
      if (boundary.maxBindings !== "many" && count > boundary.maxBindings) issues.push({ code: "boundary_binding_cardinality_exceeded", boundaryKey: boundary.boundaryKey, message: `Boundary ${boundary.boundaryKey} exceeds maxBindings` });
      bindingCounts.set(key, count);
    }
  }
  const nodes: WorkflowDefinitionEnvelope["nodes"] = [];
  const edges: WorkflowDefinitionEnvelope["edges"] = [];
  const nodeKeys = new Set<string>();
  for (const graph of graphs) {
    for (const node of graph.definition.nodes) {
      const nodeKey = composedNodeKey(graph.graphKind, graph.graphKey, node.nodeKey);
      if (nodeKey.length > 120) issues.push({ code: "composed_key_too_long", message: `Composed node key exceeds 120 characters: ${nodeKey}`, boundaryKey: node.nodeKey });
      if (nodeKeys.has(nodeKey)) issues.push({ code: "duplicate_node_key", message: `Duplicate composed node key: ${nodeKey}` });
      nodeKeys.add(nodeKey); nodes.push({ ...node, nodeKey });
    }
    for (const edge of graph.definition.edges) edges.push({ ...edge, edgeKey: composedEdgeKey(graph.graphKind, graph.graphKey, edge.edgeKey), sourceNodeKey: composedNodeKey(graph.graphKind, graph.graphKey, edge.sourceNodeKey), targetNodeKey: composedNodeKey(graph.graphKind, graph.graphKey, edge.targetNodeKey) });
  }
  const bindingEdgeKeys = new Set<string>();
  for (const binding of input.bindings) {
    const source = lookup(binding.from, "output"); const target = lookup(binding.to, "input");
    if (!source || !target || source.dataType !== target.dataType) continue;
    const edgeKey = `b:${[binding.from.graphKind, binding.from.graphKey, binding.from.boundaryKey, binding.to.graphKind, binding.to.graphKey, binding.to.boundaryKey].map(encodeURIComponent).join(":")}`;
    if (bindingEdgeKeys.has(edgeKey)) issues.push({ code: "duplicate_node_key", message: `Duplicate binding edge key: ${edgeKey}` });
    bindingEdgeKeys.add(edgeKey);
    edges.push({ edgeKey, sourceNodeKey: composedNodeKey(binding.from.graphKind, binding.from.graphKey, source.nodeKey), sourcePortId: source.portId, targetNodeKey: composedNodeKey(binding.to.graphKind, binding.to.graphKey, target.nodeKey), targetPortId: target.portId });
  }
  const publicBoundaries = (direction: "input" | "output") => {
    const consumed = new Set(input.bindings.flatMap((binding) => direction === "input" ? [boundaryIdentity(binding.to)] : [boundaryIdentity(binding.from)]));
    const seen = new Set<string>(); const result: WorkflowGraphBoundary[] = [];
    for (const graph of graphs) for (const boundary of graph[direction === "input" ? "inputs" : "outputs"]) {
      if (consumed.has(boundaryIdentity({ graphKind: graph.graphKind, graphKey: graph.graphKey, boundaryKey: boundary.boundaryKey }))) continue;
      if (boundary.disposition !== "external") continue;
      if (seen.has(boundary.boundaryKey)) { issues.push({ code: direction === "input" ? "duplicate_entry_boundary" : "duplicate_output_boundary", boundaryKey: boundary.boundaryKey, message: `Duplicate public ${direction} boundary: ${boundary.boundaryKey}` }); continue; }
      seen.add(boundary.boundaryKey);
      result.push({ ...boundary, nodeKey: composedNodeKey(graph.graphKind, graph.graphKey, boundary.nodeKey) });
    }
    return result;
  };
  const inputs = publicBoundaries("input"); const outputs = publicBoundaries("output");
  const definition: WorkflowDefinitionEnvelope = { schemaVersion: 2, revision: Math.max(...graphs.map((graph) => graph.definition.revision), 1), definitionHash: "", nodes, edges, metadata: { composedFrom: graphs.map((graph) => `${graph.graphKind}:${graph.graphKey}`) } };
  const graphIssues = validateWorkflowDefinition({ ...definition, definitionHash: hashWorkflowDefinition(definition) });
  if (graphIssues.length) issues.push({ code: "invalid_composed_graph", message: graphIssues.map((issue) => issue.message).join("; ") });
  if (issues.length) return { ok: false, issues };
  return { ok: true, definition: { ...definition, definitionHash: hashWorkflowDefinition(definition) }, inputs, outputs };
}
