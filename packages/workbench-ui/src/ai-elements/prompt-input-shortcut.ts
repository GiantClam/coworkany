export type PromptInputSubmitMode = "modifier-enter" | "enter";

export function shouldSubmitPromptInput(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; isComposing: boolean },
  compositionActive: boolean,
  mode: PromptInputSubmitMode = "modifier-enter",
) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || compositionActive) return false;
  return mode === "enter" || event.ctrlKey || event.metaKey;
}
