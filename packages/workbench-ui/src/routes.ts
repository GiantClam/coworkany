export type WorkbenchRouteMode = "home" | "chat" | "writer" | "workflow" | "library";
export type WorkbenchRoute = { path: string; label: { zh: string; en: string }; description: { zh: string; en: string }; mode: WorkbenchRouteMode; section?: { zh: string; en: string }; glyph?: string; placement?: "main" | "footer" | "hidden" };

export type WorkbenchHomeEntry = { label: { zh: string; en: string }; description: { zh: string; en: string }; path: string; glyph: string; tone: "gold" | "ink" | "soft" };
export type WorkbenchHomeGroup = { label: string; entries: readonly WorkbenchHomeEntry[] };

/** Keep the model value in the compact form used by the online Standard selector. */
export function formatWorkbenchModelLabel(model: string | undefined, fallback: { zh: string; en: string }, locale: "zh" | "en") {
  const normalized = model?.trim() ?? "";
  if (!normalized) return fallback[locale];
  const separator = normalized.indexOf("/");
  return separator > 0 ? normalized.slice(separator + 1) : normalized;
}

/** The home-card copy and ordering are shared with the online dashboard. */
export const WORKBENCH_HOME_GROUPS: readonly WorkbenchHomeGroup[] = [
  { label: "AI TEAM", entries: [
    { label: { zh: "AI 对话", en: "AI Chat" }, description: { zh: "通用 AI 对话入口", en: "General-purpose AI chat" }, path: "/dashboard/ai", glyph: "✦", tone: "gold" },
    { label: { zh: "咨询专家", en: "Consulting Advisor" }, description: { zh: "围绕品牌、增长和经营问题获得结构化建议", en: "Structured advice for brand, growth, and operating questions" }, path: "/dashboard/ai?entry=consulting-advisor", glyph: "◎", tone: "ink" },
    { label: { zh: "智能体中心", en: "Agent Center" }, description: { zh: "查找已安装的本地智能体与 Skills", en: "Find installed local agents and Skills" }, path: "/dashboard/agent-platform", glyph: "◈", tone: "soft" },
  ] },
  { label: "OFFICE TOOLS", entries: [
    { label: { zh: "PPT Assistant", en: "PPT Assistant" }, description: { zh: "生成可编辑的演示文稿", en: "Create editable presentations" }, path: "/dashboard/ai?agent=executive-ppt", glyph: "▣", tone: "gold" },
    { label: { zh: "Writer 写作", en: "Writer" }, description: { zh: "长文、SEO、社媒与内容生产工作台", en: "Long-form, SEO, social, and content production" }, path: "/dashboard/writer", glyph: "✎", tone: "soft" },
    { label: { zh: "AI 文档", en: "AI Docs" }, description: { zh: "用对话整理方案、文档和可交付结果", en: "Turn conversations into structured, usable documents" }, path: "/dashboard/ai", glyph: "▤", tone: "ink" },
  ] },
  { label: "WORKFLOWS", entries: [
    { label: { zh: "工作流", en: "Workflows" }, description: { zh: "启动可复用的营销任务流程", en: "Launch reusable marketing task flows" }, path: "/dashboard/workflows", glyph: "⌘", tone: "gold" },
    { label: { zh: "任务中心", en: "Task Center" }, description: { zh: "查看运行中和已完成的后台任务", en: "Track running and completed background tasks" }, path: "/dashboard/tasks", glyph: "≡", tone: "ink" },
    { label: { zh: "知识库", en: "Knowledge Base" }, description: { zh: "管理可复用的 Obsidian 知识资料", en: "Manage reusable Obsidian knowledge" }, path: "/dashboard/knowledge-base", glyph: "⌑", tone: "soft" },
  ] },
  { label: "CONTENT CREATION", entries: [
    { label: { zh: "AI 图片", en: "AI Image" }, description: { zh: "图片生成与设计助手", en: "Image generation and design" }, path: "/dashboard/image-assistant", glyph: "▧", tone: "gold" },
    { label: { zh: "AI 视频", en: "AI Video" }, description: { zh: "视频脚本与生成工作台", en: "Video scripts and generation" }, path: "/dashboard/video", glyph: "▶", tone: "ink" },
    { label: { zh: "素材库", en: "Asset Library" }, description: { zh: "集中查看和复用生成的素材", en: "Browse and reuse generated assets" }, path: "/dashboard/assets", glyph: "▱", tone: "soft" },
  ] },
] as const;

/** Canonical home-surface copy shared by the online dashboard and Tauri. */
export const WORKBENCH_HOME_COPY = {
  zh: {
    workspaceReady: "工作区已就绪",
    viewUsage: "查看用量",
    welcomePrefix: "欢迎回来，",
    welcomeDefaultName: "伙伴",
    welcomeSubtitle: "你的营销工作台已准备好。今天想创建什么？",
  },
  en: {
    workspaceReady: "Workspace ready",
    viewUsage: "View usage",
    welcomePrefix: "Welcome back, ",
    welcomeDefaultName: "there",
    welcomeSubtitle: "Your marketing workspace is ready. What would you like to create today?",
  },
} as const;

/** Canonical retained dashboard routes. SaaS and Tauri adapters consume this manifest. */
export const WORKBENCH_ROUTE_MANIFEST: readonly WorkbenchRoute[] = [
  { path: "/dashboard", label: { zh: "首页", en: "Home" }, description: { zh: "工作台按能力统一组织。顾问负责策略与增长，写作负责多平台内容生产，图片助手负责图片生成与画布精修。", en: "A capability-oriented AI marketing workspace for strategy, writing, image generation, and execution." }, mode: "home", glyph: "⌂" },
  // Keep the visible copy identical to the online AI-entry surface. OpenCode
  // remains the desktop transport, but it is an implementation detail rather
  // than a different user-facing route description.
  { path: "/dashboard/ai", label: { zh: "AI 对话", en: "AI Chat" }, description: { zh: "通用 AI 对话入口", en: "General-purpose AI chat" }, mode: "chat", glyph: "✦" },
  { path: "/dashboard/ai?entry=consulting-advisor", label: { zh: "咨询专家", en: "Consulting Advisor" }, description: { zh: "围绕策略、增长与营销执行持续对话", en: "Iterate on strategy, growth, and execution" }, mode: "chat", section: { zh: "专家 Agent", en: "Expert agents" }, glyph: "◎" },
  { path: "/dashboard/ai?agent=executive-brand&entry=consulting-advisor", label: { zh: "品牌策略顾问", en: "Brand strategy advisor" }, description: { zh: "梳理定位、差异化价值与整体策略方向", en: "Clarify positioning and strategic direction" }, mode: "chat", section: { zh: "专家 Agent", en: "Expert agents" }, glyph: "◈" },
  { path: "/dashboard/ai?agent=executive-growth&entry=consulting-advisor", label: { zh: "增长顾问", en: "Growth advisor" }, description: { zh: "围绕渠道目标和业务指标制定增长动作", en: "Plan growth actions around goals and metrics" }, mode: "chat", section: { zh: "专家 Agent", en: "Expert agents" }, glyph: "↗" },
  // The cloud dashboard renders both PPT entries inside the AI-entry chat
  // surface (the query string selects the agent). Keep the desktop route in
  // the same mode so the shell, composer, message cards and OpenCode session
  // lifecycle do not fork into a workflow-only UI.
  { path: "/dashboard/ai?agent=executive-ppt", label: { zh: "可编辑 PPT 助手", en: "Editable PPT Assistant" }, description: { zh: "使用本地 ppt-master Skill 生成可编辑演示文稿", en: "Generate editable decks with the local ppt-master Skill" }, mode: "chat", section: { zh: "专家 Agent", en: "Expert agents" }, glyph: "▣" },
  { path: "/dashboard/ai?agent=executive-presentation-ppt", label: { zh: "演讲型 PPT 助手", en: "Presentation PPT Assistant" }, description: { zh: "生成演讲结构、讲稿与本地 PPT 产物", en: "Create talk structure, notes, and local PPT artifacts" }, mode: "chat", section: { zh: "专家 Agent", en: "Expert agents" }, glyph: "▤" },
  { path: "/dashboard/writer", label: { zh: "多平台写作", en: "Multi-platform writing" }, description: { zh: "统一生成多平台图文内容，并支持 Markdown 编辑与发布准备。", en: "Generate multi-platform written content with Markdown editing and publishing preparation." }, mode: "writer", section: { zh: "创作工作台", en: "Creative workspace" }, glyph: "✎" },
  { path: "/dashboard/image-assistant", label: { zh: "图片设计助手", en: "Image design assistant" }, description: { zh: "生成图片、编辑参考图并完成画布精修。", en: "Generate images, edit references, and refine the canvas." }, mode: "workflow", section: { zh: "创作工作台", en: "Creative workspace" }, glyph: "▧" },
  { path: "/dashboard/capabilities", label: { zh: "能力中心", en: "Capabilities" }, description: { zh: "查看本地可用的营销能力与 Skills", en: "Browse local marketing capabilities and Skills" }, mode: "library", section: { zh: "平台中台", en: "Platform" }, glyph: "▦" },
  { path: "/dashboard/agent-platform", label: { zh: "智能体中心", en: "Agent Center" }, description: { zh: "搜索已安装的本地智能体与 Skills，并启动本地对话", en: "Search installed local agents and Skills, then start a local conversation" }, mode: "library", section: { zh: "平台中台", en: "Platform" }, glyph: "◈" },
  { path: "/dashboard/workflows", label: { zh: "工作流", en: "Workflows" }, description: { zh: "编排内容、媒体、PPT 与 Obsidian 节点", en: "Compose content, media, PPT, and Obsidian nodes" }, mode: "workflow", section: { zh: "平台中台", en: "Platform" }, glyph: "⌘" },
  { path: "/dashboard/tasks", label: { zh: "任务中心", en: "Task Center" }, description: { zh: "查看本地任务、运行事件和恢复状态", en: "Inspect local runs, events, and recovery state" }, mode: "library", section: { zh: "资源入口", en: "Resources" }, glyph: "≡" },
  { path: "/dashboard/assets", label: { zh: "资产库", en: "Asset Library" }, description: { zh: "查看项目目录中的本地产物", en: "Browse local project artifacts" }, mode: "library", section: { zh: "资源入口", en: "Resources" }, glyph: "▱" },
  { path: "/dashboard/knowledge-base", label: { zh: "知识库", en: "Knowledge Base" }, description: { zh: "使用 Obsidian Vault 建立本地知识检索", en: "Search a local Obsidian Vault" }, mode: "library", section: { zh: "资源入口", en: "Resources" }, glyph: "⌑" },
  { path: "/dashboard/video", label: { zh: "视频生成 Agent", en: "Video generation agent" }, description: { zh: "生成视频、数字人、音乐、语音与通用音频", en: "Generate video, digital human, music, voice, and audio" }, mode: "workflow", glyph: "▶", placement: "hidden" },
  { path: "/dashboard/settings", label: { zh: "设置", en: "Settings" }, description: { zh: "模型、工作目录与本地运行环境配置", en: "Configure models, workspace, and local runtime" }, mode: "library", glyph: "⚙", placement: "footer" },
] as const;
