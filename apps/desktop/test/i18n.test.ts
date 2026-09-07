import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WORKBENCH_HOME_GROUPS, WORKBENCH_MEDIA_FEATURES, WORKBENCH_ROUTE_MANIFEST } from "@coworkany/workbench-ui";
import { validateWorkflowDefinition } from "@coworkany/workflow-core";
import { desktopCopy, desktopWriterCopy, detectDesktopLocale, homeGroupLabels, mediaEnglish, mediaFieldEnglish, mediaOptionEnglish, mediaPlaceholderEnglish, mediaSubmitEnglish, mediaSummaryEnglish, quickPromptsForDesktopRoute, resolveDesktopLocale } from "../src/i18n";
import { buildWorkflowDefinition, desktopExecutionPrompt, isDesktopErrorStatus, localizeDesktopStatus, localizeRuntimeStatus, localizedSkillSystemPrompt, parseImageInputs, resolveDesktopSkillId } from "../src/App";
import { promptRequestsArtifact } from "../src/artifact-intent";

test("desktop locale follows Windows/WebView language by default", () => {
  assert.equal(detectDesktopLocale("zh-CN"), "zh");
  assert.equal(detectDesktopLocale("zh-TW"), "zh");
  assert.equal(detectDesktopLocale("ja-JP"), "en");
  assert.equal(detectDesktopLocale("fr-FR"), "en");
  assert.equal(detectDesktopLocale("pt-BR"), "en");
  assert.equal(detectDesktopLocale(""), "en");
  assert.equal(resolveDesktopLocale("auto", "de-DE"), "en");
});

test("desktop locale preference overrides system language", () => {
  assert.equal(resolveDesktopLocale("zh", "en-US"), "zh");
  assert.equal(resolveDesktopLocale("en", "zh-CN"), "en");
});

test("desktop error statuses are promoted to the top tips surface", () => {
  const timeout = "Text provider request timed out after 300 seconds";
  const localized = localizeDesktopStatus(timeout, "zh");
  assert.equal(localized, "文本 Provider 请求超时，请检查 Provider 地址、API Key，或切换其他文本模型后重试。");
  assert.doesNotMatch(localized, /60|300/u);
  assert.equal(localizeDesktopStatus("Text provider request timed out.", "zh"), "文本 Provider 请求超时，请检查 Provider 地址、API Key，或切换其他文本模型后重试。");
  assert.equal(isDesktopErrorStatus(localized), true);
  assert.equal(isDesktopErrorStatus("正在分析请求…"), false);
  assert.equal(isDesktopErrorStatus("已发送，正在流式生成…"), false);
  const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(source, /function DesktopTopTip[\s\S]*?role="alert"[\s\S]*?onDismiss/u);
  assert.match(source, /const showTopTip = Boolean\(topTipMessage && dismissedTopTip !== topTipMessage\)/u);
  assert.match(source, /showTopTip \? <DesktopTopTip message=\{topTipMessage\} locale=\{locale\} onDismiss=\{\(\) => setDismissedTopTip\(topTipMessage\)\}/u);
  assert.match(source, /const status = isDesktopErrorStatus\(rawStatus\) \? "" : rawStatus;/u);
  assert.doesNotMatch(source, /workflow_host_response_timeout/u);
});

test("English desktop media fields do not leak untranslated Chinese placeholders", () => {
  const placeholders = WORKBENCH_MEDIA_FEATURES.flatMap((feature) => feature.fields.map((field) => field.placeholder).filter((value): value is string => Boolean(value && /[\u4e00-\u9fff]/u.test(value))));
  assert.ok(placeholders.length > 0);
  for (const placeholder of placeholders) {
    const translated = mediaPlaceholderEnglish[placeholder];
    assert.ok(translated, `missing English placeholder translation: ${placeholder}`);
    assert.doesNotMatch(translated, /[\u4e00-\u9fff]/u);
  }
});

test("English desktop media catalog translates every shared Chinese presentation field", () => {
  const containsChinese = (value: string | undefined) => Boolean(value && /[\u4e00-\u9fff]/u.test(value));
  for (const feature of WORKBENCH_MEDIA_FEATURES) {
    if (containsChinese(feature.title)) assert.ok(mediaEnglish[feature.id], `missing English media title: ${feature.id}`);
    if (containsChinese(feature.summary)) assert.ok(mediaSummaryEnglish[feature.id], `missing English media summary: ${feature.id}`);
    if (containsChinese(feature.submitLabel)) assert.ok(mediaSubmitEnglish[feature.id], `missing English media submit label: ${feature.id}`);
    for (const field of feature.fields) {
      if (containsChinese(field.label)) assert.ok(mediaFieldEnglish[field.label], `missing English media field: ${feature.id}/${field.label}`);
      if (containsChinese(field.placeholder)) assert.ok(mediaPlaceholderEnglish[field.placeholder!], `missing English media placeholder: ${feature.id}/${field.id}`);
      for (const option of field.options ?? []) {
        if (containsChinese(option.label)) assert.ok(mediaOptionEnglish[option.label], `missing English media option: ${feature.id}/${field.id}/${option.label}`);
      }
    }
  }
});

test("retained Agent routes use the same quick prompts as the cloud catalog", () => {
  assert.equal(quickPromptsForDesktopRoute("/dashboard/ai?agent=executive-brand", "zh")[0], "基于这段业务介绍，重写品牌定位、价值主张和一句话口号。");
  assert.equal(quickPromptsForDesktopRoute("/dashboard/ai?agent=executive-ppt", "en")[0], "Turn this brief into an editable PPT outline, page copy, and design requirements.");
  assert.deepEqual(quickPromptsForDesktopRoute("/dashboard/ai", "en"), [
    "Break this down and give me conclusions, steps, and deliverables directly.",
    "Turn the context below into a structured plan with execution-ready actions.",
    "Based on this background, draft a clear professional response I can use right away.",
  ]);
});

test("account-free home copy keeps the cloud fallback greeting", () => {
  assert.equal(desktopCopy.zh.welcome, "欢迎回来，伙伴");
  assert.equal(desktopCopy.en.welcome, "Welcome back, there");
});

test("desktop home group headings have explicit Chinese and English labels", () => {
  for (const group of WORKBENCH_HOME_GROUPS) {
    assert.ok(homeGroupLabels[group.label], `missing home group mapping: ${group.label}`);
  }
  for (const [key, labels] of Object.entries(homeGroupLabels)) {
    assert.ok(labels.zh, `missing Chinese home group label: ${key}`);
    assert.ok(labels.en, `missing English home group label: ${key}`);
    assert.doesNotMatch(labels.en, /[\u4e00-\u9fff]/u);
  }
  assert.equal(homeGroupLabels["AI TEAM"].zh, "AI 团队");
  assert.equal(homeGroupLabels["CONTENT CREATION"].zh, "内容创作");
});

test("every shared route has an English presentation without Chinese fallback text", () => {
  const containsChinese = (value: string | undefined) => Boolean(value && /[\u4e00-\u9fff]/u.test(value));
  for (const route of WORKBENCH_ROUTE_MANIFEST) {
    assert.ok(route.label.en, `missing English route label: ${route.path}`);
    assert.ok(route.description.en, `missing English route description: ${route.path}`);
    assert.equal(containsChinese(route.label.en), false, `Chinese route label leaked: ${route.path}`);
    assert.equal(containsChinese(route.description.en), false, `Chinese route description leaked: ${route.path}`);
    if (route.section?.en) assert.equal(containsChinese(route.section.en), false, `Chinese route section leaked: ${route.path}`);
  }
});

test("runtime repair failures are fully localized in the English shell", () => {
  assert.equal(localizeRuntimeStatus("运行环境修复失败：runtime_install_incomplete", "en"), "Runtime repair failed: runtime_install_incomplete");
  assert.equal(localizeRuntimeStatus("运行环境修复失败：runtime_install_incomplete", "zh"), "运行环境修复失败：runtime_install_incomplete");
});

test("active Writer workspace has a complete bilingual copy contract", () => {
  const keys = Object.keys(desktopWriterCopy.zh) as Array<keyof typeof desktopWriterCopy.zh>;
  assert.deepEqual(Object.keys(desktopWriterCopy.en).sort(), keys.sort());
  for (const key of keys) {
    assert.ok(desktopWriterCopy.zh[key]);
    assert.ok(desktopWriterCopy.en[key]);
    assert.doesNotMatch(desktopWriterCopy.en[key], /[\u4e00-\u9fff]/u);
  }
});

test("active Writer preview uses the bilingual copy contract", () => {
  const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const start = source.indexOf("function DesktopWriterCloudWorkspace(");
  const end = source.indexOf("type DesktopWorkflowWorkspaceProps", start);
  assert.ok(start >= 0 && end > start, "active Writer workspace source must be present");
  const activeWriter = source.slice(start, end);
  assert.match(activeWriter, /WriterPlatformPreview platform=\{platform\} locale=\{locale\} content=\{previewText\} images=\{previewImages\}/u);
  assert.match(source, /function WriterPlatformPreview[\s\S]*?MessageResponse content=\{content\}/u);
  assert.match(activeWriter, /writerCopy\.edit/u);
  assert.doesNotMatch(activeWriter, /label="AI RESPONSE"/u);
});

test("unreachable legacy Writer fallbacks cannot reintroduce untranslated UI", () => {
  const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.doesNotMatch(source, /function DesktopWriterWorkspace\(/u);
  assert.doesNotMatch(source, /function DesktopWriterCloudWorkspaceLegacy\(/u);
});

test("active conversation responses localize the assistant label", () => {
  const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const start = source.indexOf("function DesktopConversationWorkspace(");
  const end = source.indexOf("type DesktopWriterCloudWorkspaceProps", start);
  assert.ok(start >= 0 && end > start, "active conversation workspace source must be present");
  const activeConversation = source.slice(start, end);
  assert.match(activeConversation, /<WorkbenchMessageSurface[\s\S]*?locale=\{locale\}/u);
  assert.doesNotMatch(activeConversation, /label="AI RESPONSE"/u);
});

test("active media workspace keeps voice controls bilingual", () => {
  const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const start = source.indexOf("function DesktopMediaWorkspaceBody(");
  const end = source.indexOf("type DesktopMediaWorkspaceProps", start);
  assert.ok(start >= 0 && end > start, "active media workspace source must be present");
  const activeMedia = source.slice(start, end);
  assert.match(activeMedia, /eyebrow: "CONTENT CREATION"/u);
  assert.match(activeMedia, /eyebrow: "内容创作"/u);
  assert.match(activeMedia, /Reload voices/u);
  assert.match(activeMedia, /刷新音色/u);
  assert.match(activeMedia, /正在加载可用音色/u);
  assert.match(activeMedia, /推荐音色/u);
});

test("image parameters follow the active media locale and use structured provider input", () => {
  const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const start = source.indexOf("function DesktopMediaWorkspaceBody(");
  const end = source.indexOf("type DesktopMediaWorkspaceProps", start);
  assert.ok(start >= 0 && end > start, "active media workspace source must be present");
  const activeMedia = source.slice(start, end);
  assert.match(activeMedia, /getDesktopImageParameterSchema\(model, locale\)/u);
  assert.match(activeMedia, /buildDesktopImageRunInput\(model, imageSettings, localAttachmentPaths\)/u);
  assert.doesNotMatch(activeMedia, /参考素材：\$\{imageSettings\.referenceImages\}/u);
  assert.doesNotMatch(activeMedia, /图片质量：\$\{imageSettings\.quality\}/u);
});

test("image prompt metadata parses both localized label forms", () => {
  assert.deepEqual(parseImageInputs("subject\nQuality: hd\nSize: 256x256\nCount: 1\nReference assets: local.png"), {
    quality: "hd",
    size: "256x256",
    n: 1,
    referenceImages: "local.png",
  });
  assert.deepEqual(parseImageInputs("主体\n图片质量：standard\n图片尺寸：1024x1024\n生成数量：4\n参考素材：本地产物.png"), {
    quality: "standard",
    size: "1024x1024",
    n: 4,
    referenceImages: "本地产物.png",
  });
});

test("writer image shortcut defaults to a gpt-image-2 compatible quality", () => {
  assert.equal(parseImageInputs("Generate a product image").quality, "auto");
});

test("new workflow definitions use the active locale for persisted node titles", () => {
  const provider = { id: "local", model: "demo", baseUrl: "http://127.0.0.1:11434" };
  const english = buildWorkflowDefinition("draft", "writer", provider, {}, "en");
  const chinese = buildWorkflowDefinition("撰写", "writer", provider, {}, "zh");
  assert.deepEqual(english.nodes.map((node) => node.title), ["Input task", "Content writing", "Save to Asset Library"]);
  assert.deepEqual(chinese.nodes.map((node) => node.title), ["输入任务", "内容写作", "保存到资产库"]);
  assert.deepEqual(english.nodes.map((node) => node.type), ["text_input", "writer", "product_store"]);
  assert.deepEqual(chinese.edges.at(-1), {
    edgeKey: "capability-asset-library",
    sourceNodeKey: "capability",
    sourcePortId: "text",
    targetNodeKey: "asset-library",
    targetPortId: "text",
  });
  assert.deepEqual(validateWorkflowDefinition(english), []);
  assert.deepEqual(validateWorkflowDefinition(chinese), []);
});

test("new desktop workflow nodes initialize the online parameter contract", () => {
  const provider = { id: "openai", model: "gpt-5", baseUrl: "https://api.example.test/v1" };
  const image = buildWorkflowDefinition("campaign launch", "image_generate", provider, {}, "en");
  const ppt = buildWorkflowDefinition("campaign launch", "ppt_generate", provider, {}, "en");
  const imageConfig = image.nodes.find((node) => node.nodeKey === "capability")?.config ?? {};
  const pptConfig = ppt.nodes.find((node) => node.nodeKey === "capability")?.config ?? {};

  assert.equal(imageConfig.selectedProviderId, "openai");
  assert.equal(imageConfig.selectedModelId, "gpt-5");
  assert.equal("imageQuality" in imageConfig, false);
  assert.equal("imageOutputFormat" in imageConfig, false);
  assert.equal(pptConfig.previewRuntime, "frontend-slides-agent");
  assert.equal(pptConfig.pageCount, 8);
  assert.deepEqual(validateWorkflowDefinition(image), []);
  assert.deepEqual(validateWorkflowDefinition(ppt), []);
});

test("OpenCode loads the selected Skill without adding workflow rules", () => {
  assert.equal(localizedSkillSystemPrompt("auto", "en"), "");
  assert.equal(localizedSkillSystemPrompt("writer-orchestrator", "zh"), "");
  assert.equal(localizedSkillSystemPrompt("writer-orchestrator", "en"), "");
  assert.doesNotMatch(localizedSkillSystemPrompt("writer-orchestrator", "zh"), /保持所有产物写入/u);
  assert.doesNotMatch(localizedSkillSystemPrompt("writer-orchestrator", "en"), /keep all artifacts/u);
  assert.doesNotMatch(localizedSkillSystemPrompt("ppt-master", "en"), /[\u4e00-\u9fff]/u);
});

test("ordinary desktop conversations do not inherit a persisted Skill", () => {
  assert.equal(resolveDesktopSkillId("/dashboard/ai", null), "auto");
  assert.equal(resolveDesktopSkillId("/dashboard/ai?agent=executive-ppt", "executive-ppt"), "ppt-master");
  assert.equal(resolveDesktopSkillId("/dashboard/ai?agent=executive-presentation-ppt", "executive-presentation-ppt"), "dashi-ppt");
  assert.equal(resolveDesktopSkillId("/dashboard/ai?agent=executive-legal-risk", "executive-legal-risk"), "executive-consulting-suite");
  assert.equal(localizedSkillSystemPrompt("executive-consulting-suite", "en"), "");
  assert.equal(resolveDesktopSkillId("/dashboard/writer", null), "writer-orchestrator");
  assert.equal(resolveDesktopSkillId("/dashboard/ai", "entry:writer"), "writer-orchestrator");
  assert.equal(resolveDesktopSkillId("/dashboard/ai", "entry:image-assistant"), "auto");
  assert.equal(resolveDesktopSkillId("/dashboard/knowledge-base", null), "auto");
  assert.equal(resolveDesktopSkillId("/dashboard/writer", "content-writing"), "writer-orchestrator");
});

test("selected Skills own their interaction flow", () => {
  const prompt = "先梳理演讲目标并提出必要问题，不要现在生成 PPTX。";
  assert.equal(desktopExecutionPrompt("ppt-master", prompt, "zh"), prompt);
  assert.equal(desktopExecutionPrompt("dashi-ppt", prompt, "zh"), prompt);
  assert.equal(desktopExecutionPrompt("dashi-ppt", `  ${prompt}\n`, "zh"), `  ${prompt}\n`);
  assert.equal(localizedSkillSystemPrompt("ppt-master", "zh"), "");
  assert.equal(localizedSkillSystemPrompt("dashi-ppt", "en"), "");
  for (const systemPrompt of [localizedSkillSystemPrompt("ppt-master", "zh"), localizedSkillSystemPrompt("dashi-ppt", "en")]) {
    assert.doesNotMatch(systemPrompt, /goal:scaffold|props:safe|template variants|bespoke variant|PPTX export|complete the generation workflow|Do not stop|ask the user/u);
  }
});

test("artifact intent is opt-in for conversational prompts", () => {
  assert.equal(promptRequestsArtifact("请列出合同审查时最需要关注的三项风险。"), false);
  assert.equal(promptRequestsArtifact("请生成一份合同审查备忘录并保存为 Markdown 文件。"), true);
  assert.equal(promptRequestsArtifact("Create a contract review memo and save it as a markdown file."), true);
});
