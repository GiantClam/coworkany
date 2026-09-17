import {
  executeWorkflow,
  migrateWorkflowDefinitionToCurrent,
  type WorkflowDefinitionEnvelope,
} from "@coworkany/workflow-core"

import {
  createWorkflowNodeInputBundle,
  resolveWorkflowNodeExecutor,
  type WorkflowNodeExecutionContext,
  type WorkflowNodeExecutionResult,
  type WorkflowNodeInputBundle,
  type WorkflowNodeOutputBundle,
  type WorkflowMediaRef,
} from "@/lib/workflows/node-executors"
import type { WorkflowNodeRunState } from "@/lib/workflows/execution"
import type { WorkflowDefinition } from "@/lib/workflows/store"

type SharedSaasWorkflowExecutionInput = {
  enterpriseId: number
  ownerUserId: number
  nodes: WorkflowDefinition["nodes"]
  edges: WorkflowDefinition["edges"]
  seedInput?: Partial<WorkflowNodeInputBundle>
  executorContext?: Omit<WorkflowNodeExecutionContext, "enterpriseId" | "ownerUserId" | "node" | "input">
  signal?: AbortSignal
  initialNodeStates?: Record<string, WorkflowNodeRunState>
  rerunNodeKeys?: readonly string[]
  onNodeStateChange?: (state: WorkflowNodeRunState) => Promise<void> | void
}

export type SharedSaasWorkflowExecutionResult = {
  status: "succeeded" | "failed"
  definition: WorkflowDefinitionEnvelope
  nodeStates: Record<string, WorkflowNodeRunState>
  finalNodeKeys: string[]
}

function cloneOutput(output: WorkflowNodeOutputBundle): WorkflowNodeOutputBundle {
  return {
    ...(output.text ? { text: [...output.text] } : {}),
    ...(output.asset ? { asset: [...output.asset] } : {}),
    ...(output.image ? { image: [...output.image] } : {}),
    ...(output.video ? { video: [...output.video] } : {}),
    ...(output.audio ? { audio: [...output.audio] } : {}),
    ...(output.ppt ? { ppt: [...output.ppt] } : {}),
  }
}

function portKind(portId: string): keyof WorkflowNodeInputBundle | null {
  const normalized = portId.replace(/^items\./, "")
  if (normalized === "text") return "text"
  if (normalized === "asset" || normalized === "assets") return "asset"
  if (normalized === "image" || normalized === "images" || normalized === "coverImage" || normalized === "image.reference" || normalized === "image.last_frame") return "image"
  if (normalized === "video" || normalized === "videos") return "video"
  if (normalized === "audio" || normalized === "audios") return "audio"
  if (normalized === "ppt" || normalized === "presentations" || normalized === "presentation") return "ppt"
  return null
}

function mediaKindMatchesAsset(kind: Exclude<keyof WorkflowNodeInputBundle, "text" | "asset">, mimeType: unknown) {
  const mime = typeof mimeType === "string" ? mimeType.toLowerCase() : "application/octet-stream"
  if (kind === "image") return mime.startsWith("image/")
  if (kind === "video") return mime.startsWith("video/")
  if (kind === "audio") return mime.startsWith("audio/")
  return mime.includes("presentation") || mime.includes("powerpoint")
}

function asArray(value: unknown) { return Array.isArray(value) ? value : value === undefined ? [] : [value] }

function mediaRef(value: unknown, sourceNodeKey: string): WorkflowMediaRef {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return {
    url: typeof record.url === "string" ? record.url : null,
    downloadUrl: typeof record.downloadUrl === "string" ? record.downloadUrl : null,
    title: typeof record.title === "string" ? record.title : typeof record.fileName === "string" ? record.fileName : null,
    mimeType: typeof record.mimeType === "string" ? record.mimeType : null,
    artifactId: typeof record.artifactId === "number" ? record.artifactId : undefined,
    assetId: typeof record.assetId === "string" ? record.assetId : null,
    storageKey: typeof record.storageKey === "string" ? record.storageKey : undefined,
    sourceNodeKey: typeof record.sourceNodeKey === "string" ? record.sourceNodeKey : sourceNodeKey,
  }
}

function appendMedia(bundle: WorkflowNodeInputBundle, kind: "image" | "video" | "audio" | "ppt", values: WorkflowMediaRef[]) {
  if (kind === "image") bundle.image.push(...values)
  else if (kind === "video") bundle.video.push(...values)
  else if (kind === "audio") bundle.audio.push(...values)
  else bundle.ppt.push(...values)
}

function bundleForNode(input: {
  nodeKey: string
  edges: WorkflowDefinitionEnvelope["edges"]
  outputs: ReadonlyMap<string, Record<string, unknown>>
  seed?: Partial<WorkflowNodeInputBundle>
}): WorkflowNodeInputBundle {
  const bundle = createWorkflowNodeInputBundle()
  let receivedInput = false
  for (const edge of input.edges.filter((candidate) => candidate.targetNodeKey === input.nodeKey)) {
    const value = input.outputs.get(edge.sourceNodeKey)?.[edge.sourcePortId ?? ""]
    if (value === undefined) continue
    const kind = portKind(edge.targetPortId ?? edge.inputName ?? "")
    if (!kind) continue
    receivedInput = true
    if (kind === "text") {
      bundle.text.push(...asArray(value).filter((item): item is string => typeof item === "string"))
    } else if (kind === "asset") {
      bundle.asset.push(...asArray(value) as typeof bundle.asset)
    } else {
      const values = asArray(value)
      if (edge.sourcePortId === "asset") {
        for (const asset of values) {
          const record = asset && typeof asset === "object" ? asset as Record<string, unknown> : {}
          if (!mediaKindMatchesAsset(kind, record.mimeType)) throw new Error(`workflow_edge_asset_type_mismatch:${input.nodeKey}:${kind}`)
          appendMedia(bundle, kind, [mediaRef(asset, edge.sourceNodeKey)])
        }
      } else {
        appendMedia(bundle, kind, values.map((item) => mediaRef(item, edge.sourceNodeKey)))
      }
    }
  }
  if (!receivedInput) {
    if (input.seed?.text) bundle.text = [...input.seed.text]
    if (input.seed?.asset) bundle.asset = [...input.seed.asset]
    if (input.seed?.image) bundle.image = [...input.seed.image]
    if (input.seed?.video) bundle.video = [...input.seed.video]
    if (input.seed?.audio) bundle.audio = [...input.seed.audio]
    if (input.seed?.ppt) bundle.ppt = [...input.seed.ppt]
  }
  return bundle
}

function newState(nodeKey: string, status: WorkflowNodeRunState["status"], output: WorkflowNodeOutputBundle = {}, errorMessage: string | null = null, result?: WorkflowNodeExecutionResult, previous?: WorkflowNodeRunState): WorkflowNodeRunState {
  const now = new Date()
  return {
    nodeKey,
    status,
    attemptCount: previous?.status === "running" ? previous.attemptCount : (previous?.attemptCount ?? 0) + 1,
    output: cloneOutput(output),
    startedAt: now,
    finishedAt: status === "running" ? null : now,
    providerId: result?.providerId ?? null,
    modelId: result?.modelId ?? null,
    taskRunId: result?.taskRunId ?? null,
    creditsConsumed: result?.creditsConsumed ?? 0,
    errorMessage,
    metadata: result?.metadata ?? null,
  }
}

function legacyDefinition(nodes: WorkflowDefinition["nodes"], edges: WorkflowDefinition["edges"]): WorkflowDefinitionEnvelope {
  return migrateWorkflowDefinitionToCurrent({
    nodes: nodes.map((node) => ({ ...node })),
    edges: edges.map((edge) => ({ ...edge })),
  })
}

function collectBlockedRetryNodeKeys(input: {
  definition: WorkflowDefinitionEnvelope
  initialNodeStates: Record<string, WorkflowNodeRunState> | undefined
  rerunNodeKeys: ReadonlySet<string>
}) {
  const blocked = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const edge of input.definition.edges) {
      if (!input.rerunNodeKeys.has(edge.targetNodeKey) || blocked.has(edge.targetNodeKey)) continue
      const sourceState = input.initialNodeStates?.[edge.sourceNodeKey]
      const sourceIsTerminalAndUnretried = !input.rerunNodeKeys.has(edge.sourceNodeKey)
        && (sourceState?.status === "failed" || sourceState?.status === "cancelled")
      if (sourceIsTerminalAndUnretried || blocked.has(edge.sourceNodeKey)) {
        blocked.add(edge.targetNodeKey)
        changed = true
      }
    }
  }
  return blocked
}

/**
 * SaaS composition for ordinary DAGs.  Capability execution remains in the
 * existing host layer so billing, task persistence and artifact behavior are
 * unchanged; only graph scheduling and typed port propagation are shared.
 */
export async function runSaasWorkflowWithSharedCore(input: SharedSaasWorkflowExecutionInput): Promise<SharedSaasWorkflowExecutionResult> {
  const definition = legacyDefinition(input.nodes, input.edges)
  const sourceNodes = new Map(input.nodes.map((node) => [node.nodeKey, node]))
  const nodeStates: Record<string, WorkflowNodeRunState> = Object.fromEntries(Object.entries(input.initialNodeStates ?? {}).map(([nodeKey, state]) => [nodeKey, { ...state, output: cloneOutput(state.output) }]))
  const results = new Map<string, WorkflowNodeExecutionResult>()
  const rerunNodeKeys = new Set(input.rerunNodeKeys ?? [])
  const blockedRetryNodeKeys = collectBlockedRetryNodeKeys({ definition, initialNodeStates: input.initialNodeStates, rerunNodeKeys })
  const executionDefinition = input.initialNodeStates && rerunNodeKeys.size > 0
    ? {
        ...definition,
        nodes: definition.nodes.filter((node) => (rerunNodeKeys.has(node.nodeKey) && !blockedRetryNodeKeys.has(node.nodeKey)) || input.initialNodeStates?.[node.nodeKey]?.status === "succeeded"),
        edges: definition.edges.filter((edge) => ((rerunNodeKeys.has(edge.sourceNodeKey) && !blockedRetryNodeKeys.has(edge.sourceNodeKey)) || input.initialNodeStates?.[edge.sourceNodeKey]?.status === "succeeded") && ((rerunNodeKeys.has(edge.targetNodeKey) && !blockedRetryNodeKeys.has(edge.targetNodeKey)) || input.initialNodeStates?.[edge.targetNodeKey]?.status === "succeeded")),
      }
    : definition
  const completed = Object.fromEntries(
    Object.entries(input.initialNodeStates ?? {})
      .filter(([nodeKey, state]) => state.status === "succeeded" && !rerunNodeKeys.has(nodeKey))
      .map(([nodeKey, state]) => [nodeKey, cloneOutput(state.output) as Record<string, unknown>]),
  )
  const outputs = new Map<string, Record<string, unknown>>([
    ...Object.entries(completed),
  ])

  const result = await executeWorkflow(executionDefinition, {
    runId: "saas-workflow-adapter",
    signal: input.signal,
    completed,
    ports: {
      capability: {
        execute: async ({ nodeKey }) => {
          const node = sourceNodes.get(nodeKey)
          if (!node) throw new Error(`workflow_node_missing:${nodeKey}`)
          const execution = await resolveWorkflowNodeExecutor(node.type).execute({
            enterpriseId: input.enterpriseId,
            ownerUserId: input.ownerUserId,
            node,
            input: bundleForNode({ nodeKey, edges: definition.edges, outputs, seed: input.seedInput }),
            ...input.executorContext,
          })
          results.set(nodeKey, execution)
          outputs.set(nodeKey, execution.output as Record<string, unknown>)
          return execution.output as Record<string, unknown>
        },
      },
      events: {
        append: async (event) => {
          const nodeKey = typeof event.payload.nodeKey === "string" ? event.payload.nodeKey : null
          if (!nodeKey) return
          if (event.type === "node_started") {
            const state = newState(nodeKey, "running", {}, null, undefined, nodeStates[nodeKey])
            nodeStates[nodeKey] = state
            await input.onNodeStateChange?.(state)
          } else if (event.type === "node_succeeded") {
            const execution = results.get(nodeKey)
            const output = execution?.output ?? {}
            const state = newState(nodeKey, "succeeded", output, null, execution, nodeStates[nodeKey])
            nodeStates[nodeKey] = state
            await input.onNodeStateChange?.(state)
          } else if (event.type === "node_failed") {
            const message = typeof event.payload.message === "string" ? event.payload.message : "workflow_node_execution_failed"
            const state = newState(nodeKey, "failed", {}, message, undefined, nodeStates[nodeKey])
            nodeStates[nodeKey] = state
            await input.onNodeStateChange?.(state)
          }
        },
      },
    },
  })

  if (result.status === "cancelled") {
    const error = new Error("workflow_cancelled")
    error.name = "AbortError"
    throw error
  }
  if (result.status === "failed") {
    for (const node of executionDefinition.nodes) {
      if (nodeStates[node.nodeKey]) continue
      const state = newState(node.nodeKey, "cancelled", {}, "workflow_upstream_failed", undefined, nodeStates[node.nodeKey])
      nodeStates[node.nodeKey] = state
      await input.onNodeStateChange?.(state)
    }
  }
  const finalNodeKeys = definition.nodes
    .filter((node) => !definition.edges.some((edge) => edge.sourceNodeKey === node.nodeKey))
    .map((node) => node.nodeKey)
  const hasTerminalFailure = Object.values(nodeStates).some((state) => state.status === "failed" || state.status === "cancelled")
  return { status: result.status === "succeeded" && !hasTerminalFailure ? "succeeded" : "failed", definition, nodeStates, finalNodeKeys }
}
