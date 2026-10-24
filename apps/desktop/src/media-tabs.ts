import type { WorkbenchMediaFeature, WorkbenchMediaFeatureId } from "@coworkany/workbench-ui/desktop";
import type { DesktopImageSettings } from "./image-model-parameters";

export type DesktopMediaTabState = {
  id: WorkbenchMediaFeatureId;
  featureId: WorkbenchMediaFeatureId;
  values: Record<string, string>;
  prompt: string;
  imageSettings: DesktopImageSettings;
  uploadedFileName: string | null;
};

export function createDesktopMediaTab(feature: WorkbenchMediaFeature): DesktopMediaTabState {
  return {
    id: feature.id,
    featureId: feature.id,
    values: Object.fromEntries(feature.fields.map((field) => [field.id, field.defaultValue ?? ""])),
    prompt: "",
    imageSettings: {
      quality: "standard",
      size: "1024x1024",
      count: "1",
      referenceImages: "",
    },
    uploadedFileName: null,
  };
}

export function openDesktopMediaTab(
  tabs: readonly DesktopMediaTabState[],
  feature: WorkbenchMediaFeature,
): DesktopMediaTabState[] {
  return tabs.some((tab) => tab.id === feature.id) ? [...tabs] : [...tabs, createDesktopMediaTab(feature)];
}

/**
 * Refresh a tab's model after the capability profile changes. Tabs remain
 * intentionally independent, but a stale empty/placeholder model must never
 * hide the newly selected Provider model from the submit path.
 */
export function syncDesktopMediaTabModel(tab: DesktopMediaTabState, feature: WorkbenchMediaFeature): DesktopMediaTabState {
  const modelField = feature.fields.find((field) => field.id === "model");
  if (!modelField) return tab;
  const options = modelField.options?.map((option) => option.value.trim()).filter(Boolean) ?? [];
  const current = tab.values.model?.trim() ?? "";
  const next = current && (options.length === 0 || options.includes(current))
    ? current
    : modelField.defaultValue?.trim() || options[0] || current;
  if (next === current) return tab;
  return { ...tab, values: { ...tab.values, model: next } };
}

export function closeDesktopMediaTab(
  tabs: readonly DesktopMediaTabState[],
  activeTabId: WorkbenchMediaFeatureId | null,
  featureId: WorkbenchMediaFeatureId,
): { tabs: DesktopMediaTabState[]; activeTabId: WorkbenchMediaFeatureId | null } {
  const nextTabs = tabs.filter((tab) => tab.id !== featureId);
  return {
    tabs: nextTabs,
    activeTabId: activeTabId === featureId ? nextTabs.at(-1)?.id ?? null : activeTabId,
  };
}
