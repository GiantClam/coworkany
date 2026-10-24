import {
  stepCountIs,
  type ModelMessage,
} from "ai"

import { loadExecutiveSkillForAgent } from "@/lib/ai-entry/executive-skill-loader"
import {
  runAiEntryConsultingBlocking,
  type ProviderOptions,
} from "@/lib/skills/runtime/ai-entry-executor"
import {
  getExecutiveAdvisorAgentId,
  getExecutiveAdvisorAgentName,
  type ExecutiveAdvisorType,
} from "@/lib/skills/runtime/executive-advisor-types"

type ExecutiveAdvisorInput = {
  query: string
  preferredLanguage?: "zh" | "en" | "auto" | null
  conversationId?: string | null
  enterpriseId?: number | null
  enterpriseCode?: string | null
  memoryContext?: string | null
  soulCard?: string | null
  signal?: AbortSignal
}

const EXECUTIVE_ADVISOR_MODEL = "deepseek-v4-pro"

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function buildLanguageRule(preferredLanguage: ExecutiveAdvisorInput["preferredLanguage"]) {
  if (preferredLanguage === "zh") return "Reply in Chinese."
  if (preferredLanguage === "en") return "Reply in English."
  return "Reply in the same language as the user's latest message."
}

function buildExecutiveAdvisorSystemPrompt(input: {
  advisorType: ExecutiveAdvisorType
  skillContent: string
  memoryContext?: string | null
  soulCard?: string | null
  preferredLanguage?: ExecutiveAdvisorInput["preferredLanguage"]
}) {
  const sections = [
    [
      "You are an executive consulting advisor inside AI Marketing.",
      `Advisor lane: ${getExecutiveAdvisorAgentName(input.advisorType)}.`,
      "Use the supplied skill documents as binding operating guidance.",
      "Give practical, high-signal advice with clear priorities and next actions.",
      "Do not claim to be Dify or mention internal routing.",
      buildLanguageRule(input.preferredLanguage),
    ].join("\n"),
    input.skillContent.trim() ? `## Skill Documents\n${input.skillContent.trim()}` : "",
    normalizeText(input.soulCard) ? `## User / enterprise memory\n${normalizeText(input.soulCard)}` : "",
    normalizeText(input.memoryContext) ? `## Relevant prior context\n${normalizeText(input.memoryContext)}` : "",
  ]

  return sections.filter(Boolean).join("\n\n")
}

function buildMessages(query: string): ModelMessage[] {
  return [
    {
      role: "user",
      content: query,
    },
  ]
}

function buildProviderOptions(): ProviderOptions {
  return {
    preferredProviderId: "pptoken",
    preferredModel: EXECUTIVE_ADVISOR_MODEL,
    forcePreferredProvider: true,
    forceModelAcrossProviders: false,
    disableSameProviderModelFallback: true,
    directProviderFailoverOnError: false,
  }
}

export function loadExecutiveAdvisorSkillRunner(advisorType: ExecutiveAdvisorType) {
  return {
    kind: "executive-advisor" as const,
    advisorType,
    runBlocking: async (input: ExecutiveAdvisorInput) => {
      if (input.signal?.aborted) {
        throw new Error("advisor_task_cancelled")
      }

      const skillContent = await loadExecutiveSkillForAgent(getExecutiveAdvisorAgentId(advisorType))
      const execution = await runAiEntryConsultingBlocking({
        systemPrompt: buildExecutiveAdvisorSystemPrompt({
          advisorType,
          skillContent,
          memoryContext: input.memoryContext,
          soulCard: input.soulCard,
          preferredLanguage: input.preferredLanguage,
        }),
        messages: buildMessages(input.query),
        selectedTools: {},
        stopWhen: stepCountIs(1),
        providerOptions: buildProviderOptions(),
      })

      return {
        answer: execution.result.text.trim(),
        agentName: getExecutiveAdvisorAgentName(advisorType),
        providerId: execution.providerId,
        model: execution.model,
      }
    },
  }
}
