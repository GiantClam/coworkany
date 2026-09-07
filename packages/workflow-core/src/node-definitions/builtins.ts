import type { WorkflowFieldDefinition, WorkflowNodeDefinitionV2, WorkflowNodeType, WorkflowPortDefinition, WorkflowValueKind } from "./types";

const textPort = (id = "text", role?: WorkflowPortDefinition["role"]): WorkflowPortDefinition => ({ id, valueKind: "text", role, required: false, cardinality: "many" });
const inputPort = (valueKind: WorkflowValueKind, id: string = valueKind, role?: WorkflowPortDefinition["role"], limits: Pick<WorkflowPortDefinition, "minItems" | "maxItems"> = {}): WorkflowPortDefinition => ({ id, valueKind, role, required: false, cardinality: "many", ...limits });
const outputPort = (valueKind: WorkflowValueKind, id: string = valueKind): WorkflowPortDefinition => ({ id, valueKind, required: false, cardinality: "many" });
const fields = (...items: WorkflowFieldDefinition[]) => items;
const builtinFieldLabels: Record<string, { zh: string; en: string }> = {
  "上传文件": { zh: "上传文件", en: "Uploaded files" },
  "引用资产": { zh: "引用资产", en: "Referenced assets" },
  "文本": { zh: "文本", en: "Text" },
  "文件名称": { zh: "文件名称", en: "File name" },
  "File name": { zh: "文件名称", en: "File name" },
  "文件格式": { zh: "文件格式", en: "File format" },
  Provider: { zh: "提供商", en: "Provider" },
  Model: { zh: "模型", en: "Model" },
  Prompt: { zh: "提示词", en: "Prompt" },
  Script: { zh: "脚本", en: "Script" },
  Text: { zh: "文本", en: "Text" },
  "Provider file ID": { zh: "提供商文件 ID", en: "Provider file ID" },
  "Voice ID": { zh: "音色 ID", en: "Voice ID" },
  "Preview text": { zh: "预览文本", en: "Preview text" },
  Query: { zh: "查询", en: "Query" },
  Title: { zh: "标题", en: "Title" },
  "Collect 节点": { zh: "汇总节点", en: "Collect node" },
  "输入集合": { zh: "输入集合", en: "Input collection" },
  "失败策略": { zh: "失败策略", en: "Failure policy" },
  "并发数": { zh: "并发数", en: "Concurrency" },
  "最大轮数": { zh: "最大轮数", en: "Max iterations" },
  "展示名称": { zh: "展示名称", en: "Display name" },
  "允许空输出": { zh: "允许空输出", en: "Allow empty output" },
  "要求全部成功": { zh: "要求全部成功", en: "Require all succeeded" },
};
const localizeBuiltinFieldLabel = (label: string) => builtinFieldLabels[label] ?? { zh: label, en: label };
const textField = (id: string, label: string, defaultValue = "", rendererId: WorkflowFieldDefinition["rendererId"] = "text"): WorkflowFieldDefinition => ({ id, label: localizeBuiltinFieldLabel(label), rendererId, valueType: "string", required: false, defaultValue });
const selectField = (id: string, label: string, options: Array<{ label: string; value: string }>, defaultValue?: string): WorkflowFieldDefinition => ({ id, label: localizeBuiltinFieldLabel(label), rendererId: "select", valueType: "string", required: false, options, defaultValue });
const assetField = (id: string, label: string, valueType: WorkflowFieldDefinition["valueType"] = "object"): WorkflowFieldDefinition => ({ id, label: localizeBuiltinFieldLabel(label), rendererId: "asset", valueType, required: false });
const numberField = (id: string, label: string, defaultValue: number, min?: number, max?: number): WorkflowFieldDefinition => ({ id, label: localizeBuiltinFieldLabel(label), rendererId: "number", valueType: "number", required: false, defaultValue, min, max });
const toggleField = (id: string, label: string, defaultValue: boolean): WorkflowFieldDefinition => ({ id, label: localizeBuiltinFieldLabel(label), rendererId: "toggle", valueType: "boolean", required: false, defaultValue });
const identityMigration = (config: Record<string, unknown>) => ({ ...config });
const editorTextField = (id: string, zh: string, en: string, defaultValue = "", rendererId: WorkflowFieldDefinition["rendererId"] = "text"): WorkflowFieldDefinition => ({ id, label: { zh, en }, rendererId, valueType: "string", required: false, defaultValue });
const editorSelectField = (id: string, zh: string, en: string, options: Array<{ label: string; value: string }>, defaultValue: string): WorkflowFieldDefinition => ({ id, label: { zh, en }, rendererId: "select", valueType: "string", required: false, options, defaultValue });
const editorNumberField = (id: string, zh: string, en: string, defaultValue: number, min?: number, max?: number): WorkflowFieldDefinition => ({ id, label: { zh, en }, rendererId: "number", valueType: "number", required: false, defaultValue, min, max });
const editorToggleField = (id: string, zh: string, en: string, defaultValue: boolean): WorkflowFieldDefinition => ({ id, label: { zh, en }, rendererId: "toggle", valueType: "boolean", required: false, defaultValue });
type BuiltinSpec = Omit<WorkflowNodeDefinitionV2, "type" | "version" | "migrate"> & { type: WorkflowNodeType; version?: number };

const definitions: BuiltinSpec[] = [
  { type: "upload", category: "input", title: { zh: "上传", en: "Upload" }, icon: "upload", colorToken: "amber", inputs: [], outputs: [outputPort("asset"), outputPort("image"), outputPort("video"), outputPort("audio")], configSchema: fields(assetField("uploadedFiles", "上传文件", "object"), assetField("referencedArtifactIds", "引用资产", "string[]")), defaultConfig: { uploadedFiles: [], referencedArtifactIds: [] }, executorId: "upload", sideEffect: "persistent" },
  { type: "text_input", category: "input", title: { zh: "文本输入", en: "Text Input" }, icon: "text", colorToken: "sky", inputs: [], outputs: [outputPort("text")], configSchema: fields(textField("text", "文本")), defaultConfig: { text: "" }, executorId: "text_input", sideEffect: "none" },
  { type: "file_create", category: "output", title: { zh: "文件", en: "File" }, icon: "file", colorToken: "lime", inputs: [textPort()], outputs: [outputPort("asset")], configSchema: fields(textField("fileName", "文件名称"), selectField("fileFormat", "文件格式", [{ label: "Markdown", value: "md" }, { label: "Text", value: "txt" }, { label: "HTML", value: "html" }, { label: "JSON", value: "json" }], "md")), defaultConfig: { fileName: "", fileFormat: "md" }, executorId: "file_create", sideEffect: "persistent" },
  { type: "writer", category: "ai", title: { zh: "文章写作", en: "Writer" }, icon: "pen", colorToken: "indigo", inputs: [textPort("text", "text.prompt")], outputs: [outputPort("text")], configSchema: fields(textField("selectedProviderId", "Provider"), textField("selectedModelId", "Model")), defaultConfig: {}, executorId: "writer", sideEffect: "external" },
  { type: "llm_generate", category: "ai", title: { zh: "模型生成", en: "LLM Generate" }, icon: "sparkles", colorToken: "fuchsia", inputs: [textPort("text", "text.prompt")], outputs: [outputPort("text")], configSchema: fields(textField("selectedProviderId", "Provider"), textField("selectedModelId", "Model")), defaultConfig: {}, executorId: "llm_generate", sideEffect: "external", legacyTitles: ["文案生成", "大模型"] },
  { type: "agent_execute", category: "ai", title: { zh: "智能体", en: "Agent" }, icon: "bot", colorToken: "amber", inputs: [textPort(), inputPort("asset"), inputPort("image"), inputPort("video"), inputPort("audio"), inputPort("ppt")], outputs: [outputPort("text")], configSchema: fields(textField("prompt", "Prompt"), textField("selectedProviderId", "Provider"), textField("selectedModelId", "Model")), defaultConfig: {}, executorId: "agent_execute", sideEffect: "external" },
  { type: "image_generate", category: "media", title: { zh: "图片生成", en: "Image Generate" }, icon: "image", colorToken: "emerald", inputs: [textPort("text", "text.prompt"), inputPort("image", "images", "image.reference", { maxItems: 9 })], outputs: [outputPort("image")], configSchema: fields(textField("prompt", "Prompt"), textField("selectedProviderId", "Provider"), textField("selectedModelId", "Model")), defaultConfig: {}, executorId: "image_generate", sideEffect: "external" },
  { type: "video_generate", category: "media", title: { zh: "视频生成", en: "Video Generate" }, icon: "video", colorToken: "rose", inputs: [textPort("text", "text.prompt"), inputPort("image", "images", "image.first_frame", { maxItems: 1 }), inputPort("image", "image.last_frame", "image.last_frame", { maxItems: 1 }), inputPort("image", "referenceImages", "image.reference", { maxItems: 9 }), inputPort("video", "videos", "video.source", { maxItems: 1 }), inputPort("video", "referenceVideos", "video.reference", { maxItems: 3 }), inputPort("audio", "referenceAudios", "audio.reference", { maxItems: 3 })], outputs: [outputPort("video")], configSchema: fields(textField("prompt", "Prompt"), textField("selectedProviderId", "Provider")), defaultConfig: {}, executorId: "video_generate", sideEffect: "external" },
  { type: "digital_human", category: "media", title: { zh: "口播数字人", en: "Digital Human" }, icon: "user", colorToken: "orange", inputs: [textPort("text", "text.prompt"), inputPort("image", "images"), inputPort("audio", "audios")], outputs: [outputPort("video")], configSchema: fields(textField("script", "Script")), defaultConfig: {}, executorId: "digital_human", sideEffect: "external" },
  { type: "music_generate", category: "media", title: { zh: "音乐生成", en: "Music Generate" }, icon: "music", colorToken: "cyan", inputs: [textPort("text", "text.prompt"), inputPort("audio", "audios")], outputs: [outputPort("audio")], configSchema: fields(textField("prompt", "Prompt")), defaultConfig: {}, executorId: "music_generate", sideEffect: "external" },
  { type: "voice_synthesis", category: "media", title: { zh: "语音合成", en: "Voice Synthesis" }, icon: "mic", colorToken: "teal", inputs: [textPort("text", "text.prompt")], outputs: [outputPort("audio")], configSchema: fields(textField("text", "Text")), defaultConfig: {}, executorId: "voice_synthesis", sideEffect: "external" },
  { type: "voice_clone", category: "media", title: { zh: "声音克隆", en: "Voice Clone" }, icon: "mic", colorToken: "teal", inputs: [inputPort("audio", "audios"), textPort("text", "text.prompt")], outputs: [outputPort("audio")], configSchema: fields(textField("sourceFileId", "Provider file ID"), textField("voiceId", "Voice ID"), textField("previewText", "Preview text")), defaultConfig: {}, executorId: "voice_clone", sideEffect: "external" },
  { type: "audio_generate", category: "media", title: { zh: "音频生成", en: "Audio Generate" }, icon: "audio", colorToken: "cyan", inputs: [textPort("text", "text.prompt"), inputPort("audio", "audios")], outputs: [outputPort("audio")], configSchema: fields(textField("prompt", "Prompt")), defaultConfig: {}, executorId: "audio_generate", sideEffect: "external" },
  { type: "ppt_generate", category: "media", title: { zh: "PPT 生成", en: "PPT Generate" }, icon: "presentation", colorToken: "violet", inputs: [textPort("text", "text.prompt"), inputPort("image", "images")], outputs: [outputPort("ppt")], configSchema: fields(textField("prompt", "Prompt")), defaultConfig: {}, executorId: "ppt_generate", sideEffect: "external" },
  { type: "knowledge_retrieve", category: "integration", title: { zh: "知识检索", en: "Knowledge Retrieve" }, icon: "link", colorToken: "sky", inputs: [textPort("text", "text.prompt"), inputPort("asset", "assets")], outputs: [outputPort("text")], configSchema: fields(textField("query", "Query")), defaultConfig: {}, executorId: "knowledge_retrieve", sideEffect: "external" },
  { type: "knowledge_write", category: "integration", title: { zh: "知识写入", en: "Knowledge Write" }, icon: "arrow-down", colorToken: "emerald", inputs: [textPort(), inputPort("asset"), inputPort("image"), inputPort("video"), inputPort("audio"), inputPort("ppt")], outputs: [outputPort("text"), outputPort("asset"), outputPort("image"), outputPort("video"), outputPort("audio"), outputPort("ppt")], configSchema: fields(textField("title", "Title")), defaultConfig: {}, executorId: "knowledge_write", sideEffect: "persistent" },
  { type: "product_store", category: "output", title: { zh: "保存到资产库", en: "Save to Asset Library" }, icon: "archive", colorToken: "slate", inputs: [textPort(), inputPort("asset", "assets"), inputPort("image", "images"), inputPort("video", "videos"), inputPort("audio", "audios"), inputPort("ppt", "presentations")], outputs: [], configSchema: fields(textField("title", "Title"), textField("fileName", "File name", "workflow-output.md")), defaultConfig: { fileName: "workflow-output.md" }, executorId: "product_store", sideEffect: "persistent", legacyTitles: ["资产库存储", "作品库存储", "素材库存储", "Asset Library", "Work Library"] },
  { type: "foreach", category: "control", title: { zh: "逐项处理", en: "For Each" }, icon: "repeat", colorToken: "amber", inputs: [inputPort("asset", "items.asset"), inputPort("image", "items.image")], outputs: [outputPort("asset", "item.asset"), outputPort("image", "item.image")], configSchema: fields(selectField("inputPortId", "输入集合", [{ label: "Image reference", value: "image.reference" }, { label: "Asset", value: "asset" }], "image.reference"), selectField("failurePolicy", "失败策略", [{ label: "Continue", value: "continue" }, { label: "Fail fast", value: "fail_fast" }], "continue"), numberField("concurrency", "并发数", 3, 1, 6), numberField("maxIterations", "最大轮数", 20, 1, 100), textField("collectNodeKey", "Collect 节点")), defaultConfig: { inputPortId: "image.reference", failurePolicy: "continue", concurrency: 3, maxIterations: 20, collectNodeKey: "" }, executorId: "foreach", sideEffect: "none" },
  { type: "collect", category: "control", title: { zh: "汇总结果", en: "Collect" }, icon: "list", colorToken: "sky", inputs: [inputPort("asset", "items.asset"), inputPort("image", "items.image"), inputPort("video", "items.video"), inputPort("audio", "items.audio"), inputPort("ppt", "items.ppt"), textPort("items.text")], outputs: [outputPort("asset", "assets"), outputPort("image", "images"), outputPort("video", "videos"), outputPort("audio", "audios"), outputPort("ppt", "presentations"), outputPort("text")], configSchema: fields(editorSelectField("order", "排序", "Order", [{ label: "Input order", value: "input" }], "input"), editorToggleField("includeFailures", "包含失败项", "Include failures", false)), defaultConfig: { order: "input", includeFailures: false }, executorId: "collect", sideEffect: "none" },
  { type: "output", category: "output", title: { zh: "结果预览", en: "Result Preview" }, icon: "check-circle", colorToken: "lime", inputs: [inputPort("asset", "assets"), inputPort("image", "images"), inputPort("video", "videos"), inputPort("audio", "audios"), inputPort("ppt", "presentations"), textPort()], outputs: [outputPort("asset", "assets"), outputPort("image", "images"), outputPort("video", "videos"), outputPort("audio", "audios"), outputPort("ppt", "presentations"), outputPort("text")], configSchema: fields(textField("displayName", "展示名称"), toggleField("allowEmpty", "允许空输出", false), toggleField("requireAllSucceeded", "要求全部成功", true)), defaultConfig: { displayName: "", allowEmpty: false, requireAllSucceeded: true }, executorId: "output", sideEffect: "none", legacyTitles: ["工作流输出", "Output"] },
];

const editorFieldExtensions: Partial<Record<WorkflowNodeType, WorkflowFieldDefinition[]>> = {
  writer: [
    editorSelectField("platform", "平台", "Platform", [{ label: "WeChat", value: "wechat" }, { label: "Generic", value: "generic" }], "wechat"),
    editorSelectField("mode", "体裁", "Format", [{ label: "Article", value: "article" }, { label: "Social", value: "social" }, { label: "Campaign", value: "campaign" }], "article"),
    editorSelectField("language", "输出语言", "Output language", [{ label: "Auto", value: "auto" }, { label: "Chinese", value: "zh-CN" }, { label: "English", value: "en-US" }], "auto"),
  ],
  llm_generate: [editorTextField("systemPrompt", "系统提示词", "System prompt", "", "textarea")],
  agent_execute: [editorTextField("agentId", "智能体", "Agent"), editorToggleField("webSearchEnabled", "启用网络搜索", "Enable web search", false)],
  image_generate: [],
  video_generate: [
    editorTextField("model", "模型", "Model"),
    editorSelectField("mode", "模式", "Mode", [{ label: "Auto", value: "auto" }, { label: "Text to video", value: "text-to-video" }, { label: "Image to video", value: "image-to-video" }, { label: "First and last frame", value: "first-last-frame" }, { label: "Reference to video", value: "reference-to-video" }, { label: "Video edit", value: "video-edit" }], "auto"),
    editorSelectField("duration", "时长", "Duration", [{ label: "5s", value: "5" }, { label: "10s", value: "10" }], "5"),
    editorSelectField("ratio", "画幅", "Ratio", [{ label: "16:9", value: "16:9" }, { label: "9:16", value: "9:16" }, { label: "1:1", value: "1:1" }], "16:9"),
    editorSelectField("sound", "音频", "Sound", [{ label: "Off", value: "off" }, { label: "On", value: "on" }], "off"),
  ],
  digital_human: [
    editorTextField("workflowRef", "工作流引用", "Workflow reference"), editorTextField("model", "模型", "Model"), editorTextField("avatarImageUrl", "人物图片 URL", "Avatar image URL"), editorTextField("audioUrl", "音频 URL", "Audio URL"),
    editorTextField("scenePrompt", "场景提示词", "Scene prompt", "", "textarea"), editorNumberField("durationSeconds", "视频秒数", "Video seconds", 10, 1), editorNumberField("audioTrimStart", "音频起点", "Audio start", 0, 0), editorNumberField("audioTrimEnd", "音频终点", "Audio end", 0, 0), editorNumberField("seed", "随机种子", "Seed", -1),
  ],
  music_generate: [editorTextField("model", "模型", "Model"), editorSelectField("genre", "类型", "Genre", [{ label: "Electronic pop", value: "electronic-pop" }, { label: "Cinematic", value: "cinematic" }], "electronic-pop"), editorSelectField("mood", "情绪", "Mood", [{ label: "Uplifting", value: "uplifting" }, { label: "Calm", value: "calm" }], "uplifting"), editorSelectField("vocals", "演唱", "Vocals", [{ label: "Instrumental", value: "instrumental" }, { label: "Vocal", value: "vocal" }], "instrumental"), editorSelectField("lyricsSource", "歌词", "Lyrics", [{ label: "AI generate", value: "ai_generate" }, { label: "Custom", value: "custom" }], "ai_generate")],
  audio_generate: [editorTextField("model", "模型", "Model"), editorSelectField("genre", "类型", "Genre", [{ label: "Electronic pop", value: "electronic-pop" }, { label: "Cinematic", value: "cinematic" }], "electronic-pop"), editorSelectField("mood", "情绪", "Mood", [{ label: "Uplifting", value: "uplifting" }, { label: "Calm", value: "calm" }], "uplifting"), editorSelectField("vocals", "演唱", "Vocals", [{ label: "Instrumental", value: "instrumental" }, { label: "Vocal", value: "vocal" }], "instrumental"), editorSelectField("lyricsSource", "歌词", "Lyrics", [{ label: "AI generate", value: "ai_generate" }, { label: "Custom", value: "custom" }], "ai_generate")],
  voice_synthesis: [editorTextField("voiceId", "音色", "Voice"), editorTextField("model", "模型", "Model"), editorSelectField("languageBoost", "语言增强", "Language boost", [{ label: "Auto", value: "auto" }, { label: "Chinese", value: "zh" }, { label: "English", value: "en" }], "auto"), editorSelectField("speed", "语速", "Speed", [{ label: "0.8", value: "0.8" }, { label: "1", value: "1" }, { label: "1.2", value: "1.2" }], "1"), editorSelectField("volume", "音量", "Volume", [{ label: "0.8", value: "0.8" }, { label: "1", value: "1" }, { label: "1.2", value: "1.2" }], "1"), editorSelectField("pitch", "音高", "Pitch", [{ label: "-2", value: "-2" }, { label: "0", value: "0" }, { label: "2", value: "2" }], "0")],
  voice_clone: [editorTextField("model", "模型", "Model")],
  ppt_generate: [editorSelectField("previewRuntime", "PPT 类型", "PPT type", [{ label: "HTML PPT", value: "frontend-slides-agent" }, { label: "Editable PPT", value: "ppt-master-agent" }], "frontend-slides-agent"), editorTextField("model", "模型", "Model"), editorNumberField("pageCount", "页数", "Pages", 8, 1, 30), editorTextField("templateId", "模板", "Template"), editorSelectField("language", "语言", "Language", [{ label: "Chinese", value: "zh-CN" }, { label: "English", value: "en-US" }], "zh-CN"), editorSelectField("scenario", "场景", "Scenario", [{ label: "Marketing campaign", value: "marketing-campaign" }, { label: "Business report", value: "business-report" }], "marketing-campaign")],
  knowledge_retrieve: [editorTextField("prompt", "检索查询", "Retrieve query", "", "textarea"), editorNumberField("topK", "返回条数", "Top K", 4, 1, 10)],
  knowledge_write: [editorTextField("documentTitle", "知识标题", "Document title"), editorSelectField("knowledgeCategory", "知识分类", "Knowledge category", [{ label: "General", value: "general" }, { label: "Brand", value: "brand" }, { label: "Product", value: "product" }, { label: "Campaign", value: "campaign" }], "general")],
  product_store: [editorToggleField("persistToWorkLibrary", "同步到作品库", "Save to work library", true), editorToggleField("persistToKnowledgeBase", "加入知识入库队列", "Add to knowledge queue", false), editorTextField("knowledgeTargetType", "知识目标", "Knowledge target", "knowledge_base")],
};

export const WORKFLOW_BUILTIN_NODE_DEFINITIONS: readonly WorkflowNodeDefinitionV2[] = definitions.map((definition) => ({
  ...definition,
  configSchema: [...definition.configSchema, ...(editorFieldExtensions[definition.type] ?? [])],
  version: definition.version ?? 1,
  migrate: identityMigration,
}));
