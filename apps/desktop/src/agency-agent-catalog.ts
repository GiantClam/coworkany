import type { WorkbenchAgentDirectoryCard, WorkbenchAgentDirectoryGroup } from "@coworkany/workbench-ui/desktop";
import { DESKTOP_AGENCY_AGENT_CATALOG } from "./generated-agency-agent-catalog";

const categoryLabels: Record<string, { zh: string; en: string }> = {
  academic: { zh: "学术研究", en: "Academic" }, design: { zh: "设计", en: "Design" }, engineering: { zh: "工程开发", en: "Engineering" }, finance: { zh: "财务", en: "Finance" }, "game-development": { zh: "游戏开发", en: "Game Development" }, gis: { zh: "地理空间", en: "GIS" }, marketing: { zh: "营销", en: "Marketing" }, "paid-media": { zh: "付费投放", en: "Paid Media" }, product: { zh: "产品", en: "Product" }, "project-management": { zh: "项目管理", en: "Project Management" }, sales: { zh: "销售", en: "Sales" }, security: { zh: "安全", en: "Security" }, "spatial-computing": { zh: "空间计算", en: "Spatial Computing" }, specialized: { zh: "专项顾问", en: "Specialized" }, support: { zh: "支持运营", en: "Support" }, testing: { zh: "测试与 QA", en: "Testing" },
};

function titleFromSlug(value: string) {
  return value.split("-").filter(Boolean).map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

export function buildAgencyAgentGroups(locale: "zh" | "en", configured: boolean): WorkbenchAgentDirectoryGroup[] {
  const start = locale === "zh" ? "开始本地对话" : "Start local chat";
  const needs = locale === "zh" ? "需要先在设置中配置可用模型" : "Configure an available model in Settings first";
  const groups = new Map<string, { id: string; label: string; cards: WorkbenchAgentDirectoryCard[] }>();
  for (const { id, category, name, description } of DESKTOP_AGENCY_AGENT_CATALOG) {
    const labels = categoryLabels[category] ?? { zh: category, en: category };
    const existing = groups.get(category) ?? { id: `agency:${category}`, label: labels[locale], cards: [] };
    existing.cards.push({
      id,
      title: name || titleFromSlug(id),
      description: locale === "zh" ? `来源分类：Agency Agents / ${labels.zh}。${description || "可在本地工作区直接启动。"}` : description || `Agency Agents / ${labels.en} specialist, available in the local workspace.`,
      meta: locale === "zh" ? "Agency Agents 导入" : "Imported from Agency Agents",
      availability: configured ? "ready" : "needs-config",
      unavailableReason: configured ? undefined : needs,
      primaryAction: { id: `start:${id}`, label: start, disabled: !configured },
    });
    groups.set(category, existing);
  }
  return [...groups.values()];
}
