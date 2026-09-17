import { areWorkflowPortsCompatible, workflowNodeRegistry } from "./node-definitions/registry";
import { WORKFLOW_VALUE_KINDS, type WorkflowPortDefinition, type WorkflowPortRole, type WorkflowPortValueKind } from "./node-definitions/types";

export const CURRENT_WORKFLOW_SCHEMA_VERSION = 2 as const;
export const LEGACY_WORKFLOW_SCHEMA_VERSION = 1 as const;

export type WorkflowDefinitionPortValueKind = WorkflowPortValueKind | "workflow";
export type WorkflowDefinitionPortRole = WorkflowPortRole;
export type WorkflowDefinitionNodeV2 = { nodeKey: string; type: string; nodeVersion: number; title: string; positionX: number; positionY: number; config: Record<string, unknown> };
export type WorkflowDefinitionEdgeV2 = { edgeKey: string; sourceNodeKey: string; sourcePortId: string; targetNodeKey: string; targetPortId: string; inputName?: string | null };
export type WorkflowDefinitionEnvelope = { schemaVersion: typeof CURRENT_WORKFLOW_SCHEMA_VERSION; revision: number; definitionHash: string; nodes: WorkflowDefinitionNodeV2[]; edges: WorkflowDefinitionEdgeV2[]; metadata?: Record<string, unknown> };
export type WorkflowDefinitionEnvelopeV2 = WorkflowDefinitionEnvelope;
export type WorkflowValidationIssueCode = "duplicate_workflow_node_key" | "duplicate_workflow_edge_key" | "dangling_workflow_edge" | "workflow_cycle_detected" | "invalid_port_connection" | "invalid_workflow_port_role" | "invalid_workflow_port_cardinality" | "unsupported_node_type" | "unsupported_node_version" | "invalid_workflow_definition";
export type WorkflowValidationIssue = { code: WorkflowValidationIssueCode; nodeKey?: string; edgeKey?: string; field?: string; message: string };

export class WorkflowDefinitionValidationError extends Error {
  readonly issues: readonly WorkflowValidationIssue[];
  constructor(issues: readonly WorkflowValidationIssue[]) { super(issues.map((issue) => issue.message).join("; ") || "Invalid workflow definition"); this.name = "WorkflowDefinitionValidationError"; this.issues = issues; }
}

const VALID_PORT_ROLES = new Set<WorkflowPortRole>(["image.reference", "image.first_frame", "image.last_frame", "image.mask", "image.cover", "video.source", "video.reference", "audio.reference", "text.prompt"]);
const VALID_CARDINALITIES = new Set<WorkflowPortDefinition["cardinality"]>(["one", "many"]);
const compareStrings = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareStrings)) sorted[key] = sortObjectKeys(value[key]);
  return sorted;
}

/** Stable JSON encoding used for revision hashes. */
export function canonicalJson(value: unknown) { return JSON.stringify(sortObjectKeys(value)); }

// Keep the shared definition contract usable in Node, browser and Tauri WebView
// without importing Node-only crypto into the desktop renderer.
const SHA256_ROUNDS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
function sha256Hex(input: string) {
  const source = new TextEncoder().encode(input); const bitLength = source.length * 8; const paddedLength = ((source.length + 9 + 63) >> 6) << 6;
  const bytes = new Uint8Array(paddedLength); bytes.set(source); bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer); view.setUint32(paddedLength - 4, bitLength >>> 0, false); view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a; let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19; const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index++) { const s0 = rotr(words[index - 15], 7) ^ rotr(words[index - 15], 18) ^ (words[index - 15] >>> 3); const s1 = rotr(words[index - 2], 17) ^ rotr(words[index - 2], 19) ^ (words[index - 2] >>> 10); words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0; }
    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4; let f = h5; let g = h6; let h = h7;
    for (let index = 0; index < 64; index++) { const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25); const choice = (e & f) ^ (~e & g); const temp1 = (h + s1 + choice + SHA256_ROUNDS[index] + words[index]) >>> 0; const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22); const majority = (a & b) ^ (a & c) ^ (b & c); const temp2 = (s0 + majority) >>> 0; h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0; }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((value) => value.toString(16).padStart(8, "0")).join("");
}

function canonicalHashPayload(definition: WorkflowDefinitionEnvelope) {
  return { schemaVersion: definition.schemaVersion, nodes: [...definition.nodes].sort((left, right) => compareStrings(left.nodeKey, right.nodeKey)), edges: [...definition.edges].sort((left, right) => compareStrings(left.edgeKey, right.edgeKey)) };
}

export function canonicalizeWorkflowDefinition(definition: WorkflowDefinitionEnvelope): WorkflowDefinitionEnvelope {
  return { schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION, revision: definition.revision, definitionHash: definition.definitionHash, nodes: [...definition.nodes].map((node) => ({ ...node, config: sortObjectKeys(node.config) as Record<string, unknown> })).sort((left, right) => compareStrings(left.nodeKey, right.nodeKey)), edges: [...definition.edges].sort((left, right) => compareStrings(left.edgeKey, right.edgeKey)), ...(definition.metadata ? { metadata: sortObjectKeys(definition.metadata) as Record<string, unknown> } : {}) };
}
export function canonicalizeWorkflowDefinitionJson(definition: WorkflowDefinitionEnvelope) { return canonicalJson(canonicalHashPayload(canonicalizeWorkflowDefinition(definition))); }
export function hashWorkflowDefinition(definition: WorkflowDefinitionEnvelope) { return sha256Hex(canonicalizeWorkflowDefinitionJson(definition)); }
/** Browser-safe SHA-256 for other deterministic workflow payloads. */
export function hashWorkflowText(value: string) { return sha256Hex(value); }

const issue = (code: WorkflowValidationIssueCode, message: string, fields: Partial<Pick<WorkflowValidationIssue, "nodeKey" | "edgeKey" | "field">> = {}): WorkflowValidationIssue => ({ code, message, ...fields });
function validatePortShape(port: unknown, nodeKey: string, field: string): WorkflowValidationIssue[] {
  if (!isRecord(port)) return [issue("invalid_port_connection", `${field} must be an object`, { nodeKey, field })];
  const issues: WorkflowValidationIssue[] = [];
  if (typeof port.id !== "string" || !port.id.trim()) issues.push(issue("invalid_port_connection", `${field}.id is required`, { nodeKey, field }));
  if (!VALID_CARDINALITIES.has(port.cardinality as WorkflowPortDefinition["cardinality"])) issues.push(issue("invalid_workflow_port_cardinality", `${field}.cardinality is invalid`, { nodeKey, field }));
  if (port.role !== undefined && (typeof port.role !== "string" || !VALID_PORT_ROLES.has(port.role as WorkflowPortRole))) issues.push(issue("invalid_workflow_port_role", `${field}.role is invalid`, { nodeKey, field }));
  if (typeof port.valueKind !== "string" || !(WORKFLOW_VALUE_KINDS as readonly string[]).includes(port.valueKind)) issues.push(issue("invalid_port_connection", `${field}.valueKind is invalid`, { nodeKey, field }));
  return issues;
}

function detectCycles(nodes: WorkflowDefinitionNodeV2[], edges: WorkflowDefinitionEdgeV2[]) {
  const adjacency = new Map<string, string[]>(); for (const node of nodes) adjacency.set(node.nodeKey, []); for (const edge of edges) adjacency.get(edge.sourceNodeKey)?.push(edge.targetNodeKey);
  const visiting = new Set<string>(); const visited = new Set<string>(); const issues: WorkflowValidationIssue[] = [];
  const visit = (nodeKey: string): boolean => { if (visiting.has(nodeKey)) return true; if (visited.has(nodeKey)) return false; visiting.add(nodeKey); for (const target of adjacency.get(nodeKey) ?? []) if (visit(target)) return true; visiting.delete(nodeKey); visited.add(nodeKey); return false; };
  for (const node of nodes) if (visit(node.nodeKey)) { issues.push(issue("workflow_cycle_detected", "Workflow graph contains a cycle", { nodeKey: node.nodeKey })); break; }
  return issues;
}

/** Validate an envelope without throwing, useful for host diagnostics and tests. */
export function validateWorkflowDefinitionEnvelope(value: unknown): WorkflowValidationIssue[] {
  if (!isRecord(value)) return [issue("invalid_workflow_definition", "Workflow definition must be an object")];
  const issues: WorkflowValidationIssue[] = [];
  if (value.schemaVersion !== CURRENT_WORKFLOW_SCHEMA_VERSION) issues.push(issue("invalid_workflow_definition", "schemaVersion must be 2", { field: "schemaVersion" }));
  if (!Number.isInteger(value.revision) || Number(value.revision) < 1) issues.push(issue("invalid_workflow_definition", "revision must be a positive integer", { field: "revision" }));
  if (typeof value.definitionHash !== "string") issues.push(issue("invalid_workflow_definition", "definitionHash must be a string", { field: "definitionHash" }));
  if (!Array.isArray(value.nodes)) return [...issues, issue("invalid_workflow_definition", "nodes must be an array", { field: "nodes" })];
  if (!Array.isArray(value.edges)) return [...issues, issue("invalid_workflow_definition", "edges must be an array", { field: "edges" })];
  const nodeKeys = new Set<string>();
  for (const candidate of value.nodes) {
    if (!isRecord(candidate)) { issues.push(issue("invalid_workflow_definition", "node must be an object", { field: "nodes" })); continue; }
    const nodeKey = typeof candidate.nodeKey === "string" ? candidate.nodeKey : undefined;
    if (!nodeKey || nodeKey.length > 120) issues.push(issue("invalid_workflow_definition", "nodeKey is required and must be <= 120 characters", { nodeKey, field: "nodeKey" }));
    else if (nodeKeys.has(nodeKey)) issues.push(issue("duplicate_workflow_node_key", `Duplicate nodeKey: ${nodeKey}`, { nodeKey })); else nodeKeys.add(nodeKey);
    if (typeof candidate.type !== "string" || !candidate.type) issues.push(issue("invalid_workflow_definition", "node type is required", { nodeKey, field: "type" }));
    else { const registered = workflowNodeRegistry.get(candidate.type); if (!registered) issues.push(issue("unsupported_node_type", `Unsupported node type: ${candidate.type}`, { nodeKey, field: "type" })); else if (!Number.isInteger(candidate.nodeVersion) || Number(candidate.nodeVersion) < 1 || Number(candidate.nodeVersion) > registered.version) issues.push(issue("unsupported_node_version", `Unsupported node version for ${candidate.type}`, { nodeKey, field: "nodeVersion" })); }
    if (!Number.isFinite(candidate.positionX) || !Number.isFinite(candidate.positionY)) issues.push(issue("invalid_workflow_definition", "node position must be finite", { nodeKey, field: "position" }));
    if (!isRecord(candidate.config)) issues.push(issue("invalid_workflow_definition", "node config must be an object", { nodeKey, field: "config" }));
  }
  const edgeKeys = new Set<string>();
  for (const candidate of value.edges) {
    if (!isRecord(candidate)) { issues.push(issue("invalid_workflow_definition", "edge must be an object", { field: "edges" })); continue; }
    const edgeKey = typeof candidate.edgeKey === "string" ? candidate.edgeKey : undefined;
    if (!edgeKey) issues.push(issue("invalid_workflow_definition", "edgeKey is required", { edgeKey, field: "edgeKey" })); else if (edgeKeys.has(edgeKey)) issues.push(issue("duplicate_workflow_edge_key", `Duplicate edgeKey: ${edgeKey}`, { edgeKey })); else edgeKeys.add(edgeKey);
    const sourceNodeKey = typeof candidate.sourceNodeKey === "string" ? candidate.sourceNodeKey : undefined; const targetNodeKey = typeof candidate.targetNodeKey === "string" ? candidate.targetNodeKey : undefined;
    if (!sourceNodeKey || !targetNodeKey || !nodeKeys.has(sourceNodeKey) || !nodeKeys.has(targetNodeKey)) { issues.push(issue("dangling_workflow_edge", "Edge references a missing node", { edgeKey })); continue; }
    for (const field of ["sourcePortId", "targetPortId"] as const) if (typeof candidate[field] !== "string" || !candidate[field]) issues.push(issue("invalid_port_connection", `${field} is required`, { edgeKey, field }));
    const sourceNode = value.nodes.find((node) => isRecord(node) && node.nodeKey === sourceNodeKey); const targetNode = value.nodes.find((node) => isRecord(node) && node.nodeKey === targetNodeKey);
    const sourceDefinition = sourceNode && typeof sourceNode.type === "string" ? workflowNodeRegistry.get(sourceNode.type) : null; const targetDefinition = targetNode && typeof targetNode.type === "string" ? workflowNodeRegistry.get(targetNode.type) : null;
    if (sourceDefinition && typeof candidate.sourcePortId === "string" && !sourceDefinition.outputs.some((port) => port.id === candidate.sourcePortId)) issues.push(issue("invalid_port_connection", "sourcePortId is not declared by source node", { edgeKey, field: "sourcePortId" }));
    if (targetDefinition && typeof candidate.targetPortId === "string" && !targetDefinition.inputs.some((port) => port.id === candidate.targetPortId)) issues.push(issue("invalid_port_connection", "targetPortId is not declared by target node", { edgeKey, field: "targetPortId" }));
    if (sourceDefinition && targetDefinition && typeof candidate.sourcePortId === "string" && typeof candidate.targetPortId === "string") { const sourcePort = sourceDefinition.outputs.find((port) => port.id === candidate.sourcePortId); const targetPort = targetDefinition.inputs.find((port) => port.id === candidate.targetPortId); if (sourcePort && targetPort && !areWorkflowPortsCompatible(sourcePort, targetPort)) issues.push(issue("invalid_port_connection", "Source and target ports are not compatible", { edgeKey })); }
  }
  issues.push(...detectCycles(value.nodes as WorkflowDefinitionNodeV2[], value.edges as WorkflowDefinitionEdgeV2[]));
  if (typeof value.definitionHash === "string" && /^[a-f0-9]{64}$/.test(value.definitionHash)) { if (value.definitionHash !== hashWorkflowDefinition(value as WorkflowDefinitionEnvelope)) issues.push(issue("invalid_workflow_definition", "definitionHash does not match canonical definition", { field: "definitionHash" })); }
  else if (typeof value.definitionHash === "string") issues.push(issue("invalid_workflow_definition", "definitionHash must be a lowercase SHA-256 hex digest", { field: "definitionHash" }));
  return issues;
}

export function validateWorkflowDefinition(input: WorkflowDefinitionEnvelope): readonly WorkflowValidationIssue[] { return validateWorkflowDefinitionEnvelope(input); }
export function parseWorkflowDefinitionEnvelope(value: unknown): WorkflowDefinitionEnvelope { const issues = validateWorkflowDefinitionEnvelope(value); if (issues.length) throw new WorkflowDefinitionValidationError(issues); return canonicalizeWorkflowDefinition(value as WorkflowDefinitionEnvelope); }
export function validateWorkflowPortDefinition(port: unknown, field = "port") { return validatePortShape(port, "", field); }
