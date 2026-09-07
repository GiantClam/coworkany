import type { WorkbenchMediaFeature } from "@coworkany/workbench-ui"

function normalizedModels(models: readonly string[] | undefined, fallback: readonly string[]) {
  const configured = (models || []).map((value) => value.trim()).filter(Boolean)
  const values = (configured.length ? configured : fallback)
    .map((value) => value.trim())
    .filter(Boolean)
  return [...new Set(values)]
}

/** Keep feature-level media model fields on the configured capability catalog. */
export function applyConfiguredMediaModels(
  feature: WorkbenchMediaFeature,
  models: readonly string[] | undefined,
  selectedModel: string | undefined,
): WorkbenchMediaFeature {
  const modelField = feature.fields.find((field) => field.id === "model")
  if (!modelField) return feature

  const fallback = modelField.options?.map((option) => option.value) || []
  // The configured profile already supplies the capability boundary. Model IDs
  // are account-defined strings, so filtering them by names such as `video`,
  // `music`, or `speech` can silently hide valid account models.
  const available = normalizedModels(models?.length ? models : (selectedModel ? [selectedModel] : []), fallback)
  if (!available.length) return feature

  const requested = selectedModel?.trim() || modelField.defaultValue?.trim() || ""
  const resolved = available.includes(requested) ? requested : available[0]
  return {
    ...feature,
    fields: feature.fields.map((field) =>
      field.id === "model"
        ? { ...field, defaultValue: resolved, options: available.map((value) => ({ value, label: value })) }
        : field,
    ),
  }
}
