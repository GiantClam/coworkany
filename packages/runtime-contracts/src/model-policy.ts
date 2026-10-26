const GPT_VERSION_PATTERN = /(?:^|[^a-z0-9])gpt[-_\s]?(\d+)(?:[._-](\d+))?/iu
const CLAUDE_VERSION_PATTERN = /claude(?:[-_\s]+(?:(?:opus|sonnet|haiku|instant)[-_\s]+)?)(\d+)(?:[._-](\d+))?/iu

/** GPT 5.x and earlier, and Claude 5.x and earlier, are retired. */
export function isDeprecatedTextModelId(value: unknown): boolean {
  if (typeof value !== "string") return false
  const modelId = value.trim()
  if (!modelId) return false

  const gptVersion = modelId.match(GPT_VERSION_PATTERN)
  if (gptVersion) {
    const major = Number(gptVersion[1])
    const minor = Number(gptVersion[2] ?? 0)
    return major < 6
  }

  if (!/claude/iu.test(modelId)) return false
  const claudeVersion = modelId.match(CLAUDE_VERSION_PATTERN)
  if (!claudeVersion) return true

  const major = Number(claudeVersion[1])
  const minor = Number(claudeVersion[2] ?? 0)
  return major < 6
}
