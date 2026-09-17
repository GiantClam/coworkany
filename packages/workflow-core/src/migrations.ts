import { workflowNodeRegistry } from "./node-definitions/registry";
import { CURRENT_WORKFLOW_SCHEMA_VERSION, LEGACY_WORKFLOW_SCHEMA_VERSION, canonicalizeWorkflowDefinition, hashWorkflowDefinition, parseWorkflowDefinitionEnvelope, type WorkflowDefinitionEdgeV2, type WorkflowDefinitionEnvelope, type WorkflowDefinitionNodeV2 } from "./definition";

export type LegacyWorkflowDefinitionNode = { nodeKey: string; type: string; title?: string | null; positionX?: number | null; positionY?: number | null; config?: Record<string, unknown> | null; nodeVersion?: number | null; [key: string]: unknown };
export type LegacyWorkflowDefinitionEdge = { id?: number | string | null; sourceNodeKey: string; targetNodeKey: string; inputName?: string | null; [key: string]: unknown };
export type LegacyWorkflowDefinition = { schemaVersion?: number | null; revision?: number | null; definitionHash?: string | null; nodes: LegacyWorkflowDefinitionNode[]; edges: LegacyWorkflowDefinitionEdge[]; [key: string]: unknown };
export type WorkflowDefinitionMigrationOptions = { revision?: number; edgeIds?: Array<number | string | null | undefined> };

const inputPort = (name: string | null | undefined) => ({ text: "text", assets: "assets", asset: "assets", images: "images", image: "images", videos: "videos", video: "videos", audios: "audios", audio: "audios", presentations: "presentations", presentation: "presentations", ppt: "presentations" })[name ?? ""] ?? name ?? "input";
const outputPort = (name: string | null | undefined) => ({ text: "text", assets: "asset", asset: "asset", images: "image", image: "image", videos: "video", video: "video", audios: "audio", audio: "audio", presentations: "ppt", presentation: "ppt", ppt: "ppt" })[name ?? ""] ?? name ?? "output";

function compareStrings(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }
function compareLegacyIds(left: number | string | null | undefined, right: number | string | null | undefined) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (left == null && right != null) return 1;
  if (left != null && right == null) return -1;
  return String(left ?? "").localeCompare(String(right ?? ""));
}
function normalizeOptions(value?: number | WorkflowDefinitionMigrationOptions): WorkflowDefinitionMigrationOptions { return typeof value === "number" ? { revision: value } : value ?? {}; }
function registeredPort(node: WorkflowDefinitionNodeV2 | undefined, inputName: string | null | undefined, direction: "inputs" | "outputs") {
  const fallback = direction === "inputs" ? inputPort(inputName) : outputPort(inputName);
  const definition = node ? workflowNodeRegistry.get(node.type) : null;
  if (!definition) return fallback;
  if (direction === "inputs" && node?.type === "video_compose" && ["image", "images"].includes(fallback)) return "coverImage";
  return definition[direction].some((port) => port.id === fallback) ? fallback : definition[direction][0]?.id ?? fallback;
}
function semanticTuple(value: { sourceNodeKey: string; sourcePortId: string; targetNodeKey: string; targetPortId: string; inputName: string | null }) {
  return [value.sourceNodeKey, value.sourcePortId, value.targetNodeKey, value.targetPortId, value.inputName ?? ""].map((entry) => `${entry.length}:${entry}`).join("|");
}

/**
 * Older versions represented a still-image composition as an external
 * video_generate node. Migrate only the unambiguous shape emitted by the
 * character-swap template: subtitle binding + image + audio, with no video
 * asset inputs. Ordinary AI video workflows remain unchanged.
 */
function migrateStillVideoComposition(nodes: WorkflowDefinitionNodeV2[], edges: WorkflowDefinitionEdgeV2[]) {
  const migratedKeys = new Set<string>();
  const nextNodes = nodes.map((node) => {
    if (node.type !== "video_generate" || node.config.requiresSubtitleBinding !== true) return node;
    const incoming = edges.filter((edge) => edge.targetNodeKey === node.nodeKey);
    const hasImage = incoming.some((edge) => ["image", "images", "referenceImages"].includes(edge.targetPortId));
    const hasAudio = incoming.some((edge) => ["audio", "audios", "referenceAudios"].includes(edge.targetPortId));
    const hasSubtitle = incoming.some((edge) => edge.targetPortId === "subtitle");
    const hasVideo = incoming.some((edge) => ["video", "videos", "referenceVideos"].includes(edge.targetPortId));
    if (!hasImage || !hasAudio || !hasSubtitle || hasVideo) return node;
    migratedKeys.add(node.nodeKey);
    const oldConfig = node.config;
    const config = Object.fromEntries(Object.entries(oldConfig).filter(([key]) => [
      "outputFormat", "subtitleMode", "fitMode", "fit", "width", "height", "fps", "ffmpegPath", "ffprobePath", "burnSubtitles",
    ].includes(key)));
    return {
      ...node,
      type: "video_compose" as const,
      config: {
        outputFormat: "mp4",
        subtitleMode: oldConfig.burnSubtitles === false ? "none" : "burn_in",
        fitMode: oldConfig.fitMode === "cover" || oldConfig.fit === "crop" ? "cover" : "contain",
        ...config,
      },
    };
  });
  if (!migratedKeys.size) return { nodes, edges };
  const nextEdges = edges.flatMap((edge) => {
    if (!migratedKeys.has(edge.targetNodeKey)) return [edge];
    if (["text", "prompt"].includes(edge.targetPortId)) return [];
    const targetPortId = ["image", "images", "referenceImages"].includes(edge.targetPortId)
      ? "coverImage"
      : ["audio", "audios", "referenceAudios"].includes(edge.targetPortId)
        ? "audio"
        : edge.targetPortId === "subtitle" ? "subtitle" : edge.targetPortId;
    return [{ ...edge, targetPortId }];
  });
  return { nodes: nextNodes, edges: nextEdges };
}

function migrateVideoComposeCoverPorts(nodes: WorkflowDefinitionNodeV2[], edges: WorkflowDefinitionEdgeV2[]) {
  const composeKeys = new Set(nodes.filter((node) => node.type === "video_compose").map((node) => node.nodeKey));
  if (!composeKeys.size) return { nodes, edges };
  return {
    nodes,
    edges: edges.map((edge) => composeKeys.has(edge.targetNodeKey) && ["image", "images"].includes(edge.targetPortId)
      ? { ...edge, targetPortId: "coverImage" }
      : edge),
  };
}

export function migrateWorkflowDefinitionToCurrent(input: LegacyWorkflowDefinition | WorkflowDefinitionEnvelope, options?: number | WorkflowDefinitionMigrationOptions): WorkflowDefinitionEnvelope {
  if ((input as WorkflowDefinitionEnvelope).schemaVersion === CURRENT_WORKFLOW_SCHEMA_VERSION) {
    const current = input as WorkflowDefinitionEnvelope;
    const resolvedOptions = normalizeOptions(options);
    const stillComposition = migrateStillVideoComposition(
      current.nodes.map((node) => ({ ...node, config: node.config ? JSON.parse(JSON.stringify(node.config)) : {} })),
      current.edges.map((edge) => ({ ...edge })),
    );
    const migrated = migrateVideoComposeCoverPorts(stillComposition.nodes, stillComposition.edges);
    const canonical = canonicalizeWorkflowDefinition({ ...current, schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION, revision: Number.isInteger(current.revision) && current.revision > 0 ? current.revision : resolvedOptions.revision ?? 1, nodes: migrated.nodes, edges: migrated.edges });
    return { ...canonical, definitionHash: hashWorkflowDefinition(canonical) };
  }
  const legacy = input as LegacyWorkflowDefinition;
  const resolvedOptions = normalizeOptions(options);
  const nodes: WorkflowDefinitionNodeV2[] = legacy.nodes.map((node) => {
    const definition = workflowNodeRegistry.get(node.type);
    return { nodeKey: node.nodeKey, type: node.type, nodeVersion: node.nodeVersion && node.nodeVersion > 0 ? node.nodeVersion : definition?.version ?? 1, title: node.title ?? definition?.title.en ?? node.type, positionX: Number.isFinite(node.positionX) ? Number(node.positionX) : 0, positionY: Number.isFinite(node.positionY) ? Number(node.positionY) : 0, config: node.config ? JSON.parse(JSON.stringify(node.config)) : {} };
  });
  const nodesByKey = new Map(nodes.map((node) => [node.nodeKey, node]));
  const indexed = legacy.edges.map((edge, index) => {
    const inputName = edge.inputName ?? null;
    const sourcePortId = registeredPort(nodesByKey.get(edge.sourceNodeKey), inputName, "outputs");
    const targetPortId = registeredPort(nodesByKey.get(edge.targetNodeKey), inputName, "inputs");
    const id = edge.id ?? resolvedOptions.edgeIds?.[index] ?? null;
    return { edge, index, id, inputName, sourcePortId, targetPortId, tuple: semanticTuple({ sourceNodeKey: edge.sourceNodeKey, sourcePortId, targetNodeKey: edge.targetNodeKey, targetPortId, inputName }) };
  });
  const hasDatabaseIds = indexed.some((item) => item.id != null);
  indexed.sort((left, right) => hasDatabaseIds ? compareLegacyIds(left.id, right.id) || compareStrings(left.tuple, right.tuple) || left.index - right.index : compareStrings(left.tuple, right.tuple) || left.index - right.index);
  const ordinals = new Map<string, number>();
  const edges: WorkflowDefinitionEdgeV2[] = indexed.map(({ edge, inputName, sourcePortId, targetPortId, tuple }) => {
    const ordinal = ordinals.get(tuple) ?? 0; ordinals.set(tuple, ordinal + 1);
    return { edgeKey: `legacy:${edge.sourceNodeKey}:${edge.targetNodeKey}:${inputName ?? "input"}:${ordinal}`, sourceNodeKey: edge.sourceNodeKey, sourcePortId, targetNodeKey: edge.targetNodeKey, targetPortId, inputName };
  });
  const revision = Number.isInteger(resolvedOptions.revision) && Number(resolvedOptions.revision) > 0
    ? Number(resolvedOptions.revision)
    : Number.isInteger(legacy.revision) && Number(legacy.revision) > 0 ? Number(legacy.revision) : 1;
  const stillComposition = migrateStillVideoComposition(nodes, edges);
  const migrated = migrateVideoComposeCoverPorts(stillComposition.nodes, stillComposition.edges);
  const canonical = canonicalizeWorkflowDefinition({ schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION, revision, definitionHash: "", nodes: migrated.nodes, edges: migrated.edges });
  return { ...canonical, definitionHash: hashWorkflowDefinition(canonical) };
}

export function migrateLegacyWorkflowDefinition(input: LegacyWorkflowDefinition, options?: number | WorkflowDefinitionMigrationOptions) { return migrateWorkflowDefinitionToCurrent({ ...input, schemaVersion: input.schemaVersion ?? LEGACY_WORKFLOW_SCHEMA_VERSION }, options); }

/** Parse v2 or migrate v1, then validate the resulting envelope. */
export function parseAndMigrateWorkflowDefinition(input: LegacyWorkflowDefinition | WorkflowDefinitionEnvelope, options?: number | WorkflowDefinitionMigrationOptions) {
  return parseWorkflowDefinitionEnvelope(migrateWorkflowDefinitionToCurrent(input, options));
}
