import {
  resolveClickConnectPorts as resolveClickConnectPortsFromCore,
  workflowNodeRegistry,
  workflowValueKindToInputName as workflowValueKindToInputNameFromCore,
  type WorkflowNodeType,
  type WorkflowPortDefinition,
  type WorkflowValueKind,
} from "@coworkany/workflow-core"
import type { WorkflowFeatures } from "@/lib/workflows/features"

export {
  areWorkflowPortsCompatible,
  resolveClickConnectPorts,
  resolveWorkflowPortConnection,
  workflowInputNameToValueKind,
  workflowValueKindToInputName,
} from "@coworkany/workflow-core"
export type { WorkflowPortConnection } from "@coworkany/workflow-core"

export function isWorkflowV2OnlyPort(port: WorkflowPortDefinition) {
  return port.role === "image.first_frame" || port.role === "image.last_frame" || port.role === "image.mask"
}

export function isWorkflowPortCreatable(port: WorkflowPortDefinition, features?: Pick<WorkflowFeatures, "definitionV2Write">) {
  return !(features?.definitionV2Write === false && isWorkflowV2OnlyPort(port))
}

export function getWorkflowPortLabel(locale: "zh" | "en", port: WorkflowPortDefinition): string {
  const roleLabels: Record<string, [string, string]> = {
    "image.reference": ["参考图片", "Image reference"],
    "image.first_frame": ["首帧图片", "First frame"],
    "image.last_frame": ["尾帧图片", "Last frame"],
    "image.mask": ["遮罩图片", "Mask"],
    "image.cover": ["封面图片", "Cover image"],
    "video.source": ["成片视频", "Source video"],
    "text.prompt": ["提示词", "Prompt"],
  }
  const role = port.role ? roleLabels[port.role] : undefined
  if (role) return locale === "zh" ? role[0] : role[1]
  const kindLabels: Record<WorkflowValueKind, [string, string]> = {
    text: ["文本", "Text"],
    asset: ["文件", "File"],
    image: ["图片", "Image"],
    video: ["视频", "Video"],
    audio: ["音频", "Audio"],
    ppt: ["PPT", "PPT"],
  }
  const labels = kindLabels[port.valueKind]
  return locale === "zh" ? labels[0] : labels[1]
}

// Resolves the inputName to wire a click-driven connection between two nodes,
// picking the first source output kind the target can accept. Returns null when
// the pair is not connectable. Mirrors the compatibility check used by the
// pointer-drag path so both connect flows agree on what is allowed.
export function resolveClickConnectInputName(
  sourceType: WorkflowNodeType,
  targetType: WorkflowNodeType,
): string | null {
  const connection = resolveClickConnectPortsFromCore(sourceType, targetType)
  if (!connection) return null
  const target = workflowNodeRegistry.require(targetType).inputs.find((port) => port.id === connection.targetPortId)
  return target ? workflowValueKindToInputNameFromCore(target.valueKind) : null
}
