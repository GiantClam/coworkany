import type {
  ImageAssistantSkillId,
  ImageAssistantSkillSelection,
  ImageAssistantTaskType,
  ImageAssistantUsagePresetId,
} from "@/lib/image-assistant/types"

export const IMAGE_ASSISTANT_MAX_REFERENCE_ATTACHMENTS = 10
export const IMAGE_ASSISTANT_MAX_BRIEF_TURNS = 5
export const IMAGE_ASSISTANT_TEXT_MODEL =
  process.env.IMAGE_ASSISTANT_TEXT_MODEL ||
  process.env.WRITER_TEXT_MODEL ||
  process.env.WRITER_SKILL_MODEL ||
  "claude-sonnet-6.1"
export const IMAGE_ASSISTANT_SKILL_MODEL =
  process.env.IMAGE_ASSISTANT_SKILL_MODEL ||
  process.env.WRITER_SKILL_MODEL ||
  process.env.WRITER_TEXT_MODEL ||
  "claude-sonnet-6.1"

type ImageAssistantSkillDefinition = ImageAssistantSkillSelection & {
  description: string
  system_prompt: string
}

const IMAGE_ASSISTANT_SKILLS: Record<ImageAssistantSkillId, ImageAssistantSkillDefinition> = {
  "graphic-design-brief": {
    id: "graphic-design-brief",
    label: "Graphic Design Brief",
    stage: "briefing",
    description: "Clarify objective, subject, style, composition, and design constraints before any image generation.",
    system_prompt: [
      "You are an image design brief strategist.",
      "Act like a design collaborator, not a raw prompt expander.",
      "Turn vague requests into a concrete creative brief.",
      "Prioritize design objective, audience fit, subject clarity, visual style, composition, and non-negotiable constraints.",
      "Ask concise follow-up questions and keep the user moving toward a production-ready brief.",
      "Do not generate the final image prompt until the brief is complete.",
    ].join(" "),
  },
  "canvas-design-execution": {
    id: "canvas-design-execution",
    label: "Canvas Design Execution",
    stage: "execution",
    description: "Translate a collected creative brief plus reference images into a concrete, image-model-ready execution plan.",
    system_prompt: [
      "You are an image design execution planner.",
      "Translate the approved brief into a clear generation or editing prompt.",
      "Respect uploaded references, protected elements, composition requirements, and editing boundaries.",
      "Think in terms of layout, focal hierarchy, whitespace, and production-safe output.",
      "Keep the execution prompt concrete and visually directive.",
    ].join(" "),
  },
  "enterprise-ad-image": {
    id: "enterprise-ad-image",
    label: "Enterprise Ad Image",
    stage: "execution",
    description: "Generate marketing and ad-focused visuals with production-safe framing, channel fit, and brand constraints.",
    system_prompt: [
      "You are an enterprise advertising image execution specialist.",
      "Translate approved briefs into high-conversion marketing visuals.",
      "Prioritize brand safety, clear focal hierarchy, ad-friendly whitespace, and channel-ready framing.",
      "Keep output actionable for campaign creatives, posters, covers, and hero visuals.",
    ].join(" "),
  },
}

export function selectImageAssistantSkill(params: {
  taskType: ImageAssistantTaskType
  readyForGeneration: boolean
  prompt?: string | null
  usagePreset?: ImageAssistantUsagePresetId | ""
  goal?: string | null
}): ImageAssistantSkillSelection {
  if (!params.readyForGeneration) {
    const skill = IMAGE_ASSISTANT_SKILLS["graphic-design-brief"]
    return { id: skill.id, label: skill.label, stage: skill.stage }
  }

  const adSignal = `${params.prompt || ""} ${params.goal || ""}`.toLowerCase()
  const shouldUseEnterpriseAdExecution =
    params.usagePreset === "ad_poster" ||
    /(?:\b(ad|ads|advertising|campaign|poster|promo|promotion|performance|kv|hero)\b|\u5e7f\u544a|\u6d77\u62a5|\u6295\u653e|\u4fc3\u9500|\u6d3b\u52a8\u4e3b\u89c6\u89c9)/iu.test(
      adSignal,
    )

  if (shouldUseEnterpriseAdExecution) {
    const skill = IMAGE_ASSISTANT_SKILLS["enterprise-ad-image"]
    return { id: skill.id, label: skill.label, stage: skill.stage }
  }

  const skill = IMAGE_ASSISTANT_SKILLS["canvas-design-execution"]
  return { id: skill.id, label: skill.label, stage: skill.stage }
}

export function getImageAssistantSkillDefinition(skillId: ImageAssistantSkillId) {
  return IMAGE_ASSISTANT_SKILLS[skillId]
}

export function isImageAssistantSkillId(value: unknown): value is ImageAssistantSkillId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(IMAGE_ASSISTANT_SKILLS, value)
}
