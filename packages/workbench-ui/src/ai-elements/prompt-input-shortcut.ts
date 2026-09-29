export function shouldSubmitPromptInput(
  event: { key: string; ctrlKey: boolean; shiftKey: boolean; isComposing: boolean },
  compositionActive: boolean,
) {
  return event.key === "Enter"
    && event.ctrlKey
    && !event.shiftKey
    && !event.isComposing
    && !compositionActive;
}
