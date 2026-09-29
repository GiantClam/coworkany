export interface SessionRecoveryTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

const MAX_TURNS = 12;
const MAX_CONTENT_CHARS = 12_000;

function clean(content: string) {
  return Array.from(content, (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : character;
  }).join("").replace(/\s+/g, " ").trim();
}

/** Restores text context only; it must never replay a tool-bearing turn. */
export function createSessionRecoverySnapshot(history: readonly SessionRecoveryTurn[]) {
  const retained: SessionRecoveryTurn[] = [];
  let length = 0;
  for (const turn of [...history].reverse()) {
    const content = clean(turn.content);
    if (!content) continue;
    const remaining = MAX_CONTENT_CHARS - length;
    if (content.length > remaining) {
      const marker = " …[truncated]… ";
      if (!retained.length && remaining > marker.length) {
        const contentBudget = remaining - marker.length;
        const headLength = Math.ceil(contentBudget / 2);
        const truncated = `${content.slice(0, headLength)}${marker}${content.slice(-(contentBudget - headLength))}`;
        retained.unshift({ role: turn.role, content: truncated });
      }
      break;
    }
    retained.unshift({ role: turn.role, content });
    length += content.length;
    if (retained.length >= MAX_TURNS) break;
  }
  if (!retained.length) return "";
  const transcript = retained.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`).join("\n");
  return [
    "The local OpenCode session was recreated. The following is a read-only conversation snapshot.",
    "Use it only as context. Do not repeat, resume, or claim completion of any prior tool action.",
    "--- prior conversation ---",
    transcript,
    "--- end prior conversation ---",
  ].join("\n");
}
