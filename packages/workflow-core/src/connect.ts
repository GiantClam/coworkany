import { areWorkflowPortsCompatible, workflowNodeRegistry } from "./node-definitions/registry";
import type { WorkflowNodeType, WorkflowPortDefinition, WorkflowValueKind } from "./node-definitions/types";

export { areWorkflowPortsCompatible } from "./node-definitions/registry";

export type WorkflowPortConnection = { sourcePortId: string; targetPortId: string };
export function workflowValueKindToInputName(kind: WorkflowValueKind): string { return ({ text: "text", asset: "assets", image: "images", video: "videos", audio: "audios", ppt: "presentations" })[kind]; }
export function workflowInputNameToValueKind(inputName: string | null | undefined): WorkflowValueKind | null { return ({ text: "text", assets: "asset", asset: "asset", images: "image", image: "image", coverImage: "image", videos: "video", video: "video", audios: "audio", audio: "audio", presentations: "ppt", presentation: "ppt", ppt: "ppt" } as Record<string, WorkflowValueKind>)[inputName ?? ""] ?? null; }

export function resolveWorkflowPortConnection(sourceType: WorkflowNodeType, targetType: WorkflowNodeType, sourcePortId?: string | null, targetPortId?: string | null, inputName?: string | null): WorkflowPortConnection | null {
  const sourceDefinition = workflowNodeRegistry.require(sourceType);
  const targetDefinition = workflowNodeRegistry.require(targetType);
  if (sourcePortId || targetPortId) {
    const target = targetDefinition.inputs.find((port) => port.id === targetPortId) ?? targetDefinition.inputs[0];
    const source = sourceDefinition.outputs.find((port) => port.id === sourcePortId) ?? sourceDefinition.outputs.find((port) => target && areWorkflowPortsCompatible(port, target));
    return source && target && areWorkflowPortsCompatible(source, target) ? { sourcePortId: source.id, targetPortId: target.id } : null;
  }
  const wantedKind = inputName ? workflowInputNameToValueKind(inputName) : null;
  for (const source of sourceDefinition.outputs) for (const target of targetDefinition.inputs) {
    if (areWorkflowPortsCompatible(source, target) && (!wantedKind || source.valueKind === wantedKind || target.valueKind === wantedKind)) return { sourcePortId: source.id, targetPortId: target.id };
  }
  return null;
}

export function resolveClickConnectPorts(sourceType: WorkflowNodeType, targetType: WorkflowNodeType) { return resolveWorkflowPortConnection(sourceType, targetType); }
export function areWorkflowPortsCompatibleForHost(source: WorkflowPortDefinition, target: WorkflowPortDefinition) { return areWorkflowPortsCompatible(source, target); }
