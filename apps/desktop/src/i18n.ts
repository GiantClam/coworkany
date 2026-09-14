export type DesktopLocale = "zh" | "en";
export type DesktopLocalePreference = "auto" | DesktopLocale;

/** Resolve the UI locale from the user's explicit preference or Windows/WebView language. */
export function detectDesktopLocale(systemLanguage?: string): DesktopLocale {
  const language = systemLanguage ?? (typeof navigator === "undefined" ? "" : navigator.language);
  return /^zh(?:-|$)/iu.test(language) ? "zh" : "en";
}

export function resolveDesktopLocale(preference: DesktopLocalePreference, systemLanguage?: string): DesktopLocale {
  return preference === "auto" ? detectDesktopLocale(systemLanguage) : preference;
}

export const desktopCopy = {
  zh: {
    localWorkspace: "本地工作区 · FULL ACCESS",
    runtimeReady: "运行环境已就绪",
    welcome: "欢迎回来，伙伴",
    welcomeSubtitle: "你的营销工作台已准备好。今天想创建什么？",
    homePlaceholder: "输入你的问题...",
    send: "发送",
    stop: "停止",
    language: "界面语言",
    languageAuto: "跟随系统",
    languageZh: "中文",
    languageEn: "English",
  },
  en: {
    localWorkspace: "LOCAL WORKSPACE · FULL ACCESS",
    runtimeReady: "Runtime ready",
    // The cloud home uses the same fallback display name when no account is
    // present; keep the local account-free adapter text identical.
    welcome: "Welcome back, there",
    welcomeSubtitle: "Your marketing workspace is ready. What would you like to create today?",
    homePlaceholder: "Ask anything...",
    send: "Send",
    stop: "Stop",
    language: "Interface language",
    languageAuto: "System",
    languageZh: "中文",
    languageEn: "English",
  },
} as const;

export const desktopQuickPrompts = {
  zh: ["帮我拆解这个问题，直接给出结论、步骤和交付物。", "把下面的信息整理成结构化方案，优先输出可执行动作。", "基于这段背景，给我一版清晰、专业、可直接使用的回复。"],
  en: ["Break this down and give me conclusions, steps, and deliverables directly.", "Turn the context below into a structured plan with execution-ready actions.", "Based on this background, draft a clear professional response I can use right away."],
} as const;

/** Keep retained Agent-entry prompts aligned with the cloud AI-entry catalog. */
export const desktopAgentQuickPrompts: Record<string, { zh: readonly string[]; en: readonly string[] }> = {
  "executive-brand": {
    zh: ["基于这段业务介绍，重写品牌定位、价值主张和一句话口号。", "帮我梳理品牌叙事结构，并给出首页最该强调的核心表达。", "分析竞品后，给出品牌差异化策略和传播重点。"],
    en: ["Based on this business intro, rewrite the positioning, value proposition, and one-line slogan.", "Structure the brand narrative and tell me what the homepage should emphasize most.", "Review the competitors and give me a differentiation strategy with communication priorities."],
  },
  "executive-growth": {
    zh: ["分析当前增长瓶颈，给我未来 30 天实验排期和优先级。", "基于这个渠道数据，输出漏斗诊断、关键假设和第一批动作。", "给我一套获客、转化、留存联动的增长计划，直接列执行节奏。"],
    en: ["Analyze the current growth bottleneck and give me a prioritized 30-day experiment plan.", "Based on this channel data, produce a funnel diagnosis, key hypotheses, and the first actions.", "Create an acquisition, conversion, and retention plan with a concrete execution cadence."],
  },
  "executive-ppt": {
    zh: ["根据这份 brief，生成一套可编辑 PPT 的目录、页稿和设计要求。", "把这段方案整理成适合汇报的可编辑 PPT 结构，并补齐每页要点。", "基于目标受众和场景，输出可编辑 PPT 的完整制作指令。"],
    en: ["Turn this brief into an editable PPT outline, page copy, and design requirements.", "Restructure this proposal into an editable presentation deck and fill in the key points for each page.", "Based on the audience and use case, generate a complete editable PPT production brief."],
  },
  "executive-presentation-ppt": {
    zh: ["围绕这个主题通过 Dashi 多轮生成一套演讲型 PPT，大纲要有起承转合。", "把这份材料改写成适合路演的演讲型展示稿，突出叙事节奏。", "为 10 分钟现场分享设计一套有节奏的演示结构和讲述重点。"],
    en: ["Use the Dashi presentation skill to build a presentation-first deck around this topic with a clear narrative arc.", "Rewrite this material into a pitch-style presentation deck with stronger storytelling flow.", "Design a paced presentation structure for a 10-minute live talk, including speaking beats."],
  },
};

export function quickPromptsForDesktopRoute(path: string, locale: DesktopLocale) {
  const query = path.includes("?") ? new URLSearchParams(path.slice(path.indexOf("?") + 1)) : null;
  const agentId = query?.get("agent");
  const prompts = agentId ? desktopAgentQuickPrompts[agentId]?.[locale] : undefined;
  return prompts ? [...prompts] : [...desktopQuickPrompts[locale]];
}

export const workflowActionEnglish: Record<string, string> = {
  upload: "Upload asset", text_input: "Text input", file_create: "Local file", writer: "Content writing", llm_generate: "Model generation", agent_execute: "Agent execution", ppt_generate: "PPT (ppt-master)", image_generate: "Image generation", video_generate: "Video generation", video_compose: "Video composition", digital_human: "Digital human", music_generate: "Music generation", voice_synthesis: "Voice synthesis", voice_clone: "Voice cloning", audio_generate: "General audio", video_process: "Video processing", audio_process: "Audio processing", knowledge_retrieve: "Obsidian retrieval", knowledge_write: "Write to Obsidian", product_store: "Save to Asset Library", foreach: "Process each", collect: "Collect results", output: "Result Preview",
};

/** Home group headings are shared as stable English identifiers with SaaS;
 * Desktop localizes the visible heading at the presentation boundary. */
export const homeGroupLabels: Record<string, { zh: string; en: string }> = {
  "AI TEAM": { zh: "AI 团队", en: "AI TEAM" },
  "OFFICE TOOLS": { zh: "办公工具", en: "OFFICE TOOLS" },
  WORKFLOWS: { zh: "工作流", en: "WORKFLOWS" },
  "CONTENT CREATION": { zh: "内容创作", en: "CONTENT CREATION" },
  MORE: { zh: "更多", en: "MORE" },
};

export const mediaEnglish: Record<string, string> = {
  "ai-music": "AI music", "audio-generate": "General audio", "voice-clone": "Voice cloning", "voice-synthesis": "Voice synthesis", "text-to-video": "Text to video", "image-to-video": "Image to video", "reference-to-video": "Reference to video", "video-edit": "Video editing", "digital-human": "Digital human", "video-enhance": "Video enhancement",
};

export const mediaSummaryEnglish: Record<string, string> = {
  "ai-music": "Create songs and soundtracks with manual or AI-generated lyrics.", "audio-generate": "Generate ambience, sound effects, and other general audio.", "voice-clone": "Use reference audio to clone a voice and create a preview.", "voice-synthesis": "Submit long text for asynchronous speech generation and download the audio.", "text-to-video": "Enter a prompt to generate a video.", "image-to-video": "Choose a first-frame image and generate a video.", "reference-to-video": "Use one or more reference images to preserve subject identity.", "video-edit": "Upload a video and apply text-directed edits.", "digital-human": "Use audio and an avatar image, or drive the avatar with TTS copy.", "video-enhance": "Repair and upscale a source video.",
};
export const mediaSubmitEnglish: Record<string, string> = { "ai-music": "Generate audio", "audio-generate": "Generate audio", "voice-clone": "Clone voice", "voice-synthesis": "Synthesize speech", "text-to-video": "Generate video", "image-to-video": "Generate video", "reference-to-video": "Generate video", "video-edit": "Edit video", "digital-human": "Generate avatar video", "video-enhance": "Start enhancement" };
export const mediaFieldEnglish: Record<string, string> = {
  "风格 / 情绪 / 场景": "Style / mood / scene", "歌词来源": "Lyrics source", "歌词": "Lyrics", "AI 写词提示": "AI lyric prompt", "音频提示词": "Audio prompt", "翻唱源音频 URL": "Cover source audio URL", "时长（秒）": "Duration (seconds)", "格式": "Format", "新音色 ID": "New voice ID", "试听文本": "Preview text", "示例音频文本": "Sample audio text", "降噪": "Noise reduction", "文本内容": "Text content", "音色": "Voice", "模型": "Model", "语言增强": "Language boost", "语速": "Speed", "音量": "Volume", "音高": "Pitch", "视频提示词": "Video prompt", "提示词": "Prompt", "首帧图片": "First-frame image", "尾帧图片地址": "Last frame URL", "附加图片地址": "Additional image URLs", "动作提示": "Motion prompt", "参考图片": "Reference images", "参考图片地址": "Reference image URLs", "参考视频地址": "Reference video URL", "参考音频地址": "Reference audio URL", "场景提示": "Scene prompt", "源视频": "Source video", "源视频地址": "Source video URL", "源视频 URL": "Source video URL", "编辑指令": "Edit instruction", "音频": "Audio", "音频 URL": "Audio URL", "音频设置": "Audio", "人物图片": "Avatar image", "人物图片 URL": "Avatar image URL", "口播文案": "Spoken copy", "分辨率": "Resolution", "画面比例": "Aspect ratio", "时长": "Duration", "水印": "Watermark", "生成音频": "Generate audio", "联网搜索": "Web search", "返回尾帧": "Return last frame", "真人模式": "Real person mode", "增强目标": "Enhancement target", "处理时长上限（秒）": "Maximum duration (seconds)", Seed: "Seed",
};
/** Placeholders are part of the shared media feature catalog, so translate
 * them at the desktop boundary instead of leaking Chinese copy into English
 * WebView sessions. */
export const mediaPlaceholderEnglish: Record<string, string> = {
  "例如：独立电子流行，适合 AI 产品发布片头。": "For example: indie electronic pop for an AI product launch intro.",
  "手动填写歌词，或在结果区回显 AI 生成歌词。": "Enter lyrics manually, or show AI-generated lyrics in the result.",
  "例如：写一首关于新品牌发布夜的中文流行歌。": "For example: write a Chinese pop song about a new brand launch night.",
  "仅 music-cover 需要：原曲或参考音频的可访问 URL": "Music cover only: accessible URL for the original or reference audio.",
  "例如：生成一段适合科技产品发布会转场的短音效。": "For example: create a short transition sound for a technology product launch.",
  "留空则自动生成，例如 voice_brand_host": "Leave blank to generate one automatically, e.g. voice_brand_host.",
  "例如：欢迎来到 CoworkAny 新品发布会。": "For example: welcome to the CoworkAny product launch.",
  "上传示例音频时可填写。": "Optional when uploading a sample recording.",
  "从可用音色库选择": "Choose from the available voice library.",
  "输入需要合成的完整文本": "Enter the full text to synthesize.",
  "描述镜头、人物动作、风格和时长": "Describe the shots, subject motion, style, and duration.",
  "粘贴本地素材相对路径或 URL": "Paste a relative local asset path or URL.",
  "描述图片中的主体如何运动": "Describe how the subject in the image should move.",
  "粘贴本地素材路径，多个路径用逗号分隔": "Paste local asset paths, separated by commas.",
  "描述参考主体在镜头中的动作": "Describe how the reference subject should move in the shot.",
  "例如：把背景替换为夜景城市": "For example: replace the background with a city at night.",
  "粘贴本地视频路径或 URL": "Paste a local video path or URL.",
  "选择本地视频产物或粘贴路径": "Choose a local video artifact or paste its path.",
  "选择本地音频产物或粘贴路径": "Choose a local audio artifact or paste its path.",
  "选择本地人物图片或粘贴路径": "Choose a local avatar image or paste its path.",
  "上传音频后会自动填入，也可以粘贴素材库音频地址": "Uploading audio fills this automatically, or paste an existing asset URL.",
  "上传图片后会自动填入，也可以粘贴素材库图片地址": "Uploading an image fills this automatically, or paste an existing asset URL.",
  "上传视频后会自动填入，也可以粘贴素材库视频地址": "Uploading a video fills this automatically, or paste an existing asset URL.",
  "未上传音频时，这段文案会走 TTS 合成。": "Without uploaded audio, this script will be synthesized with TTS.",
  "例如：模特正在做产品展示，进行电商直播带货": "For example: a presenter is demonstrating a product in a live commerce setting.",
  "例如：提升细节、修复压缩模糊、强化人物边缘": "For example: recover detail, reduce compression blur, and sharpen subject edges.",
};
export const mediaOptionEnglish: Record<string, string> = { "手动填写": "Enter manually", "AI 自动生成": "Generate with AI", "关闭": "Off", "开启": "On", "自动": "Auto", "原始音频": "Original audio", "中文": "Chinese", "英文": "English", 标准: "Standard", 高清: "HD", "横版 · 1536×1024": "Landscape · 1536×1024", "竖版 · 1024×1536": "Portrait · 1024×1536" };

export const writerPlatformEnglish: Record<string, string> = {
  wechat: "WeChat Official Account", xiaohongshu: "Xiaohongshu", weibo: "Weibo", douyin: "Douyin", x: "X", linkedin: "LinkedIn", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", reddit: "Reddit", generic: "General content",
};

export const writerContentTypeEnglish: Record<string, string> = {
  social_cn: "Chinese social", social_global: "Global social", longform: "Long-form", email: "Email", newsletter: "Newsletter", website_copy: "Website copy", ads: "Ad copy", case_study: "Case study", product: "Product content", speech: "Speech",
};

export const writerModeEnglish: Record<string, string> = { article: "Article", thread: "Thread" };

export const writerLanguageEnglish: Record<string, string> = { auto: "Auto-detect", zh: "Chinese", en: "English", ja: "Japanese", ko: "Korean", fr: "French", de: "German", es: "Spanish" };

export const desktopWriterCopy = {
  zh: {
    skill: "内容写作 Skill", quick: "快捷开始", quickStart: "快速开始", you: "你", assistant: "写作助手",
    preview: "预览", edit: "编辑内容", generateImage: "生成图片", copied: "已复制", rich: "复制富文本", markdown: "复制 Markdown", export: "导出 Markdown",
    status: "支持文案预览与配图生成", new: "新建", close: "关闭", done: "完成", send: "发送", stop: "停止",
    platform: "平台", content: "内容", mode: "模式", language: "语言", finalPreview: "最终预览",
    previewHint: "可继续编辑、导出或复制。", generateImageWithCopy: "生成图片配图",
    placeholder: "告诉我你的写作目标、受众和渠道。例如：写一篇面向品牌负责人的招商文章。",
  },
  en: {
    skill: "Content Writing Skill", quick: "Quick start", quickStart: "Quick start", you: "You", assistant: "Writing assistant",
    preview: "Preview", edit: "Edit content", generateImage: "Generate image", copied: "Copied", rich: "Copy rich text", markdown: "Copy Markdown", export: "Export Markdown",
    status: "Preview and image generation supported", new: "New", close: "Close", done: "Done", send: "Send", stop: "Stop",
    platform: "Platform", content: "Content", mode: "Mode", language: "Language", finalPreview: "Final preview",
    previewHint: "Continue editing, exporting, or copying.", generateImageWithCopy: "Generate image assets",
    placeholder: "Tell me your writing goal, audience, and channel. For example: write a partner acquisition article for brand leaders.",
  },
} as const;

export const capabilityEnglish: Record<string, { title: string; description: string }> = {
  writer: { title: "Content writing", description: "Generate, rewrite, and organize marketing content with the local OpenCode Writer Skill." },
  ppt_generate: { title: "AI PPT", description: "Generate editable PPTX files in the project directory with OpenCode + ppt-master." },
  image_generate: { title: "AI image", description: "Use the configured image Provider and register generated images locally." },
  video_generate: { title: "AI video", description: "Run video Providers and keep asynchronous tasks and files on this machine." },
  digital_human: { title: "Digital human", description: "Generate local video results with the digital-human media capability." },
  music_generate: { title: "AI music", description: "Generate music and manage audio files in the local artifact library." },
  voice_synthesis: { title: "Voice synthesis", description: "Convert text to speech and write the output directly to the project." },
  voice_clone: { title: "Voice cloning", description: "Create a reusable MiniMax voice from a provider-uploaded reference file and optional preview text." },
  audio_generate: { title: "General audio", description: "Generate general audio content with a configured Provider." },
  knowledge_retrieve: { title: "Obsidian knowledge", description: "Search local Vault indexes and open the cited source note." },
  knowledge_write: { title: "Write to Obsidian", description: "Write Agent output to the configured Vault while preserving the local index." },
};
