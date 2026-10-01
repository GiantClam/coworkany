import type { AppLocale } from "@/lib/i18n/config"

export const COWORKANY_RELEASES_URL = "https://github.com/GiantClam/coworkany/releases"
export const COWORKANY_REPOSITORY_URL = "https://github.com/GiantClam/coworkany"

export function getCoworkanyHomeCopy(locale: AppLocale) {
  const zh = locale === "zh"
  return {
    nav: zh ? ["能力", "使用场景", "桌面端", "常见问题"] : ["Capabilities", "Use cases", "Desktop", "FAQ"],
    start: zh ? "开始使用" : "Get started",
    skip: zh ? "跳至主要内容" : "Skip to content",
    menu: zh ? "导航菜单" : "Navigation menu",
    hero: zh ? ["有想法，", "就有下一步。"] : ["A little inspiration.", "A real next step."],
    description: zh
      ? "你的个人 AI 智能体。把调研、写作、设计与日常工作，推进到真正的交付。"
      : "Your personal AI agent. Turn research, writing, design, and everyday work into something you can use.",
    demo: zh ? "查看使用场景" : "Explore use cases",
    platforms: zh ? "Web 工作台 · macOS · Windows" : "Web workspace · macOS · Windows",
    example: zh ? "任务示例" : "Illustrative example",
    workspace: zh ? "工作空间" : "Workspace",
    newTask: zh ? "新任务" : "New task",
    personal: zh ? "个人空间" : "Personal space",
    prompt: zh ? "把这份产品资料，变成一份发布方案。" : "Turn these product notes into a launch plan.",
    response: zh ? "从理解资料开始，让想法一步步成形。" : "Start with the context. Make each next step count.",
    steps: zh ? ["梳理产品资料", "组织内容与结构", "撰写发布方案", "交付可继续修改的初稿"] : ["Review the product notes", "Organize the key ideas", "Draft the launch plan", "Deliver a draft to build on"],
    followup: zh ? "接下来，可以继续调整语气、补充内容。" : "Keep going: refine the tone or add more detail.",
    document: zh ? "产品发布方案.md" : "Product launch plan.md",
    documentTitle: zh ? ["让好想法，", "成为下一步。"] : ["Good ideas.", "Real next steps."],
    documentSubtitle: zh ? "Coworkany 产品发布方案" : "A product launch plan for Coworkany",
    documentSection: zh ? "产品定位" : "Product positioning",
    documentBody: zh ? "你的个人 AI 工作伙伴，让资料、想法与工具，在同一个工作空间里协作。" : "A personal AI work partner. Your context, ideas, and tools, working together in one place.",
    workLabel: zh ? "为真实的工作而来" : "MADE FOR REAL WORK",
    workTitle: zh ? ["从一个想法，", "到拿得出手的成果。"] : ["From a first thought", "to a finished thing."],
    workDescription: zh ? "把重复的步骤交给 Coworkany，\n把精力留给判断与创造。" : "Let Coworkany handle the steps.\nSave your energy for the ideas.",
    taskLink: zh ? "开始你的第一个任务" : "Start your first task",
    previewLabel: zh ? "成果示例" : "Example output",
    complete: zh ? "初稿已就绪" : "Draft ready",
    pillars: zh ? [
      { title: "一次说明，上下文接着用", description: "在同一会话里继续追问、补充资料，让修改顺着你的思路往下走。" },
      { title: "过程可见，结果可继续", description: "查看工具调用与任务状态，预览结果文件，再把成果打磨到满意。" },
      { title: "你的工具，你来选择", description: "在桌面端配置模型服务，让文字、图片与视频各用合适的工具。" },
    ] : [
      { title: "One brief. Keep the context.", description: "Follow up and add material in the same conversation. Every revision carries your thinking forward." },
      { title: "See the work. Shape the result.", description: "Follow tool activity and task status, preview the output, and keep refining it." },
      { title: "Your tools. Your choice.", description: "Configure model providers on desktop and choose the right tools for text, images, and video." },
    ],
    desktopLabel: zh ? "在你的桌面上" : "AT HOME ON YOUR DESKTOP",
    desktopTitle: zh ? ["离你的工作，", "更近一步。"] : ["A little closer", "to your work."],
    desktopDescription: zh ? "连接本地资料与 Obsidian 知识库，选择适合你的模型，在熟悉的工作空间里继续推进。" : "Bring local files and your Obsidian knowledge into the picture. Choose your models and work in a space that feels like yours.",
    download: zh ? "获取桌面版" : "Get the desktop app",
    downloadNote: zh ? "前往 Releases 查看可用版本与安装说明" : "Find available builds and setup instructions in Releases",
    folders: zh ? ["品牌资料", "研究笔记", "项目成果"] : ["Brand materials", "Research notes", "Project outputs"],
    folderType: zh ? "文件夹" : "Folder",
    myWorkspace: zh ? "我的工作空间" : "My workspace",
    local: zh ? "本地工作空间 · 自选模型服务" : "Local workspace · Your model providers",
    fileName: zh ? "名称" : "Name",
    fileType: zh ? "类型" : "Type",
    knowledge: zh ? "Obsidian 知识库" : "Obsidian knowledge",
    faqTitle: zh ? "你可能想知道" : "A few good questions.",
    faqs: zh ? [
      { question: "Coworkany 能帮我做什么？", answer: "你可以通过 AI 与 Agent 对话组织资料、撰写长文、生成可编辑 PPT、创作图片和视频，也可以把重复任务连接成可视化工作流。不同能力需要相应的模型服务配置。" },
      { question: "它和普通 AI 聊天工具有什么不同？", answer: "除了文字回复，Coworkany 将工具执行、任务过程和结果文件放在同一个工作空间。你可以查看执行状态，预览成果，再通过后续对话继续修改。官网展示的是任务示例，实际结果取决于资料、模型与配置。" },
      { question: "桌面端支持哪些系统？", answer: "项目提供 Windows 和 macOS 桌面端支持。请在 Releases 页面查看当前可用安装包、适用架构及运行时安装说明；具体发布包以该页面为准。你也可以从 Web 工作台开始使用。" },
      { question: "我的资料会发送到哪里？", answer: "桌面端的本地会话、文件与运行时数据保存在你的设备上。调用模型时，相关输入和参考媒体可能发送给你配置的模型服务商；本地存储不等于完全离线。使用前请确认所选服务的数据处理政策。" },
    ] : [
      { question: "What can Coworkany help me do?", answer: "Use AI and Agent conversations to organize material, write long-form content, create editable presentations, generate images and video, and connect repeatable tasks into visual workflows. Each capability requires its corresponding model provider configuration." },
      { question: "How is it different from an AI chat tool?", answer: "Coworkany brings tool execution, task progress, and output files into one workspace. Inspect the activity, preview the results, and keep refining them through follow-up conversations. This website shows illustrative examples; actual results depend on your material, models, and configuration." },
      { question: "Which desktop platforms are supported?", answer: "The project supports Windows and macOS. Check Releases for currently available packages, supported architectures, and runtime setup instructions. Available downloads are determined by the release listing. You can also start with the web workspace." },
      { question: "Where does my data go?", answer: "Desktop conversations, local files, and runtime data are stored on your device. Model calls may send relevant inputs and reference media to your configured provider. Local storage does not mean fully offline processing. Review your provider’s data policy before use." },
    ],
    closing: zh ? ["下一件事，", "一起完成。"] : ["Your next thing.", "Let’s do it together."],
    closingCta: zh ? "开始使用 Coworkany" : "Get started with Coworkany",
  }
}

export function getCoworkanyScenarios(locale: AppLocale) {
  const zh = locale === "zh"
  return [
    {
      id: "writing", label: zh ? "调研与写作" : "Research & writing",
      title: zh ? ["从零散资料，", "到清晰表达。"] : ["Scattered notes.", "A clear story."],
      description: zh ? "围绕你的主题组织资料、撰写长文，再适配不同平台的表达方式。" : "Organize your source material, write a complete draft, and adapt the voice for different platforms.",
      steps: zh ? ["梳理资料", "组织结构", "交付初稿"] : ["Review sources", "Build an outline", "Deliver a draft"],
      outputTitle: zh ? "好内容，从理解开始。" : "Good writing starts with understanding.",
      outputBody: zh ? "从产品资料中提炼关键信息，用清晰的结构，讲述一个值得被听见的故事。" : "Find the ideas that matter in your product notes. Give them a structure and a voice worth listening to.",
      file: zh ? "产品发布方案.md" : "Product launch plan.md",
    },
    {
      id: "slides", label: zh ? "演示文稿" : "Presentations",
      title: zh ? ["把你的观点，", "变成全场重点。"] : ["Your ideas.", "Ready to present."],
      description: zh ? "把主题与资料交给 Coworkany，梳理叙事、组织页面，交付可继续编辑的 PPT。" : "Bring a topic and your material. Build the narrative, organize the slides, and take away an editable presentation.",
      steps: zh ? ["提炼观点", "编排页面", "生成 PPT"] : ["Find the story", "Lay out slides", "Create the deck"],
      outputTitle: zh ? "下一步，值得期待。" : "The next chapter starts here.",
      outputBody: zh ? "产品提案 / 从洞察到行动" : "Product proposal / From insight to action",
      file: zh ? "产品提案.pptx" : "Product proposal.pptx",
    },
    {
      id: "images", label: zh ? "图片创作" : "Image creation",
      title: zh ? ["把脑海里的画面，", "带到眼前。"] : ["Picture the idea.", "Bring it to life."],
      description: zh ? "描述你需要的封面、配图或视觉素材，通过已配置的图片服务生成，再围绕结果继续调整。" : "Describe a cover, illustration, or visual asset. Generate it with your configured image provider and keep refining your direction.",
      steps: zh ? ["描述画面", "选择模型", "生成素材"] : ["Describe the idea", "Choose a model", "Create the image"],
      outputTitle: zh ? "让想法，被看见。" : "Give your ideas a little space.",
      outputBody: zh ? "品牌封面 · 视觉方向示意" : "Brand cover · Visual direction example",
      file: zh ? "品牌封面.png" : "Brand cover.png",
    },
    {
      id: "workflows", label: zh ? "自动化工作流" : "Workflows",
      title: zh ? ["做过一次的事，", "不必每次从头来。"] : ["Find your flow.", "Then make it repeatable."],
      description: zh ? "在可视化画布上连接任务步骤，保存流程，追踪每次运行的状态、错误与结果。" : "Connect task steps on a visual canvas, save your workflow, and track each run’s status, errors, and outputs.",
      steps: zh ? ["连接节点", "执行任务", "查看结果"] : ["Connect steps", "Run the workflow", "Review results"],
      outputTitle: zh ? "你的每周内容工作流" : "Your weekly content workflow",
      outputBody: zh ? "输入主题 → 撰写初稿 → 输出文件" : "Topic → First draft → Output file",
      file: zh ? "内容工作流.workflow.json" : "Content workflow.workflow.json",
    },
  ] as const
}

export type CoworkanyHomeCopy = ReturnType<typeof getCoworkanyHomeCopy>
export type CoworkanyScenario = ReturnType<typeof getCoworkanyScenarios>[number]
