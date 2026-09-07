import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOnlineAgentGroups, formatWorkbenchModelLabel, isWorkbenchAssistantPath, isWorkbenchNavItemActive, isWorkbenchSessionPath, workbenchSessionScope, WORKBENCH_CHAT_QUICK_PROMPTS, WORKBENCH_HOME_COPY, WORKBENCH_HOME_GROUPS, WORKBENCH_ONLINE_AGENTS, WORKBENCH_ROUTE_MANIFEST, WORKBENCH_WRITER_QUICK_PROMPTS } from "@coworkany/workbench-ui";
import { buildAgencyAgentGroups } from "../src/agency-agent-catalog";
import { configuredModelOptions, isMediaProviderConfigured, preferredConfiguredModel, requiresConfiguredProviderForWorkflowAction } from "../src/provider-config";
import { resolveDesktopRunAction, workflowActionForMediaFeature } from "../src/route-actions";
import { conversationAgentIdFromPath } from "../src/App";

test("desktop routes consume the retained online dashboard manifest", () => {
  const paths = WORKBENCH_ROUTE_MANIFEST.map((route) => route.path);
  assert.equal(paths[0], "/dashboard");
  assert.ok(paths.includes("/dashboard/ai"));
  assert.ok(paths.includes("/dashboard/writer"));
  assert.ok(paths.includes("/dashboard/workflows"));
  assert.ok(paths.includes("/dashboard/knowledge-base"));
  assert.ok(paths.includes("/dashboard/video"));
  assert.equal(paths.includes("/dashboard/works"), false);
  assert.ok(paths.includes("/dashboard/settings"));
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/video")?.placement, "hidden");
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/settings")?.placement, "footer");
  for (const excluded of ["/dashboard/billing", "/dashboard/platform-settings"]) assert.equal(paths.includes(excluded), false);
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/agent-platform")?.mode, "library");
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/writer")?.label.zh, "多平台写作");
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/workflows")?.label.zh, "工作流");
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/writer")?.description.zh, "统一生成多平台图文内容，并支持 Markdown 编辑与发布准备。");
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/ai")?.mode, "chat");
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/ai?agent=executive-ppt")?.mode, "chat");
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/writer")?.mode, "writer");
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/workflows")?.mode, "workflow");
  assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/knowledge-base")?.mode, "library");
});

test("desktop scopes conversations by the online AI entry or selected expert", () => {
  assert.equal(workbenchSessionScope("/dashboard/ai"), undefined);
  assert.equal(workbenchSessionScope("/dashboard/ai?entry=consulting-advisor"), "entry:consulting-advisor");
  assert.equal(workbenchSessionScope("/dashboard/ai?agent=executive-brand&entry=consulting-advisor"), "executive-brand");
  assert.equal(workbenchSessionScope("/dashboard/writer"), "entry:writer");
  assert.equal(workbenchSessionScope("/dashboard/writer/conversation-1"), "entry:writer");
  assert.equal(workbenchSessionScope("/dashboard/writer/conversation-1?agent=executive-presentation-ppt"), "entry:writer");
  assert.equal(workbenchSessionScope("/dashboard/image-assistant"), "entry:image-assistant");
  assert.equal(workbenchSessionScope("/dashboard/image-assistant/conversation-1"), "entry:image-assistant");
  assert.equal(isWorkbenchSessionPath("/dashboard/writer"), true);
  assert.equal(isWorkbenchSessionPath("/dashboard/image-assistant/conversation-1"), true);
  assert.equal(isWorkbenchSessionPath("/dashboard/workflows"), false);
  assert.equal(conversationAgentIdFromPath("/dashboard/ai/conversation-1", [{ id: "conversation-1", agent_id: "agency-marketing" }]), "agency-marketing");
  assert.equal(conversationAgentIdFromPath("/dashboard/writer/conversation-1", [{ id: "conversation-1", agent_id: "agency-marketing" }]), "entry:writer");
  assert.equal(conversationAgentIdFromPath("/dashboard/ai/conversation-1?agent=agency-sales", [{ id: "conversation-1", agent_id: "agency-marketing" }]), "agency-sales");
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /conversationScopeFromPath\(activePath\)/u);
  assert.match(appSource, /const launchConversationScope = conversationScope/u);
  assert.match(appSource, /const conversationAgentId = launchConversationScope \?\? undefined/u);
  assert.match(appSource, /agent_id: conversationAgentId \?\? null/u);
  assert.match(appSource, /activeSessionAgentId=\{conversationScope\}/u);
  assert.match(appSource, /const workflowDirectoryRuns = useMemo<WorkbenchWorkflowDirectoryRun\[\]>\(\(\) => runs\.flatMap/u);
  assert.match(appSource, /if \(metadata\?\.kind !== "workflow"\) return \[\];/u);
  assert.match(appSource, /startNewConversationForAgent\(card\.id === "general" \? null : card\.id\)/u);
  assert.match(appSource, /resolvePrompt:/u);
});

test("desktop creates an entry-scoped session before the first message and retitles it from that message", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /async function startNewConversation\(\)/u);
  assert.match(appSource, /setConversations\(\(current\) => \[pendingConversation/u);
  assert.match(appSource, /create_conversation", \{\s*input: \{ id: conversationId, title: pendingConversation\.title/u);
  assert.match(appSource, /resolveConversationTitleUpdate\(/u);
  assert.match(appSource, /const launchPath = activePathRef\.current/u);
  assert.match(appSource, /routeConversationId = conversationIdFromPath\(launchPath\)/u);
  assert.match(appSource, /onNewSession=\{\(\) => void startNewConversation\(\)\}/u);
  assert.doesNotMatch(appSource, /if \(!value\) onNewConversation\(\)/u);
});

test("desktop model selector uses the shared cloud Standard label formatter", () => {
  assert.equal(formatWorkbenchModelLabel("ollama/qwen3:8b", { zh: "本地模型", en: "Local model" }, "zh"), "qwen3:8b");
  assert.equal(formatWorkbenchModelLabel("aiberm/gpt-5.4", { zh: "本地模型", en: "Local model" }, "en"), "gpt-5.4");
  assert.equal(formatWorkbenchModelLabel("", { zh: "本地模型", en: "Local model" }, "en"), "Local model");
});

test("desktop defaults do not silently select an Ollama text model", () => {
  const configSource = readFileSync(resolve(process.cwd(), "runtime/config.ts"), "utf8");
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const hostSource = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  assert.doesNotMatch(configSource, /model:\s*["']ollama\/qwen3:8b/u);
  assert.doesNotMatch(appSource, /model:\s*["']ollama\/qwen3:8b/u);
  assert.doesNotMatch(hostSource, /configured\s*\|\|\s*["']qwen3:8b/u);
});

test("desktop chat projects streaming runtime events into durable rich message parts", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /activeAssistantParts=\{activeRunId \? assistantPartsRef\.current\.get\(activeRunId\) : undefined\}/);
  assert.match(appSource, /id: `\$\{runId\}:status`, data: \{ status: "running"/);
  assert.match(appSource, /applyWorkbenchRunEventToParts\(parts, \{[\s\S]*type: "tool_call"/);
  assert.match(appSource, /\["toolCallId", "callId", "idempotencyKey", "nodeKey"\]/);
  assert.match(appSource, /toolCallId/);
  assert.match(appSource, /type: "usage"/);
  assert.match(appSource, /const artifactPartId = `\$\{artifactRunId\}:artifact:\$\{artifactRelativePath\}`/);
  assert.match(appSource, /const artifactPart: Extract<DesktopUIMessagePart, \{ type: "data-artifact" \}> = \{[\s\S]*?type: "data-artifact"/);
  assert.match(appSource, /assistantPartsRef\.current\.set\(artifactRunId, \[\.\.\.currentParts\.filter\(\(part\) => !\("id" in part\) \|\| part\.id !== artifactPartId\), registeredPart\]\)/);
  assert.match(appSource, /filter\(\(part\) => !\("id" in part\) \|\| part\.id !== `\$\{event\.runId\}:status`\)/);
  assert.match(appSource, /type: "reasoning", delta: event\.delta, sequence, createdAt/);
  assert.doesNotMatch(appSource, /const reasoningSequence = \(sequences\.get\(runId\) \?\? 0\) \+ 1/);
});

test("configured provider models populate selectors and take priority over a stale default", () => {
  const provider = { model: "retired/model", models: ["provider/fast", "provider/reasoning", "provider/fast", ""] };
  assert.deepEqual(configuredModelOptions(provider), ["provider/fast", "provider/reasoning"]);
  assert.equal(preferredConfiguredModel(provider), "provider/fast");
  assert.equal(preferredConfiguredModel({ ...provider, model: "provider/reasoning" }), "provider/reasoning");
});

test("desktop workflow and media entry points expose the configured model selector", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const selector = /<ModelControls locale=\{locale\} model=\{model\} models=\{models\} reasoningEffort=\{reasoningEffort\} skillId=\{skillId\} showSkill=\{false\}/g;
  assert.ok((appSource.match(selector) ?? []).length >= 1);
  assert.match(appSource, /function DesktopWriterCloudWorkspace\([\s\S]*?const \{[^}]*model, models,[\s\S]*?<ModelControls locale=\{locale\} model=\{model\} models=\{models\}/);
  assert.match(appSource, /<DesktopWorkflowWorkspace[\s\S]*?model=\{activeModel\} models=\{activeModels\}[\s\S]*?onModelChange=\{onModelChange\}/);
  assert.match(appSource, /<DesktopMediaWorkspace[\s\S]*?model=\{activeModel\} models=\{activeModels\}[\s\S]*?onModelChange=\{updateModel\}/);
  assert.match(appSource, /hostWorkflowDefinition = bindWorkflowProviderDefaults\(hostDefinitionInput, launchConfig\)/);
  assert.match(appSource, /const hostDefinitionInput = rawWorkflowDefinition/);
  assert.match(appSource, /requestedMediaAction \?\? workflowAction/);
  assert.match(appSource, /providerForCapability\(config, "audio"\)/);
  assert.match(appSource, /const runSkillId: SkillId = actionId === "image_generate" \? "auto" : launchEffectiveSkillId/);
  assert.match(appSource, /resolvedMediaInputs \?\? \{\}\)[\s\S]*?provider: selectedProvider\.id,[\s\S]*?model: selectedProvider\.model/);
  assert.match(appSource, /const selectNode = \(nodeKey: string\)[\s\S]*?onWorkflowAction\(node\.type as WorkflowAction\)/);
});

test("Writer exposes the desktop-configured model list and keeps model changes wired", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const start = appSource.indexOf("function DesktopWriterCloudWorkspace(");
  const end = appSource.indexOf("type DesktopWorkflowWorkspaceProps", start);
  assert.ok(start >= 0 && end > start, "Writer workspace source must be present");
  const writerSource = appSource.slice(start, end);
  assert.match(writerSource, /models=\{\(models \?\? \[\]\)\.map\(/);
  assert.match(writerSource, /model=\{model\} onModelChange=\{onModelChange\}/);
  assert.match(writerSource, /<ModelControls locale=\{locale\} model=\{model\} models=\{models\}[\s\S]*?showSkill=\{false\} hideModel/);
});

test("desktop workflows open the shared online directory before the local canvas builder", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /WorkbenchWorkflowDirectory/);
  assert.match(appSource, /workflowBuilderOpen\s*\?/);
  assert.match(appSource, /action\.type === "create"[\s\S]*?setWorkflowBuilderOpen\(true\)/);
  assert.match(appSource, /action\.type === "open"[\s\S]*?openWorkflowCanvas\(definition(?:, workflow)?\)/);
  assert.match(appSource, /action\.type === "open-run" && action\.id[\s\S]*?workbenchClient\.navigation\.go\(`\/dashboard\/workflows\?runId=\$\{encodeURIComponent\(action\.id\)\}`\)/);
  assert.doesNotMatch(appSource, /action\.type === "open-run"\) workbenchClient\.navigation\.go\("\/dashboard\/tasks"\)/);
  assert.match(appSource, /action\.type === "delete"[\s\S]*?workbenchClient\.workflows\.remove\(workflowId\)/);
  assert.match(appSource, /actionAvailability=\{\{ duplicate: true, delete: true \}\}/);
  assert.match(appSource, /const savedWorkflowHashRef = useRef<string \| null>\(null\)/);
  assert.match(appSource, /workflowAutoSaveRef\.current = \(\) => saveCurrentWorkflow\("auto"\)/);
  assert.match(appSource, /window\.setTimeout\(\(\) => void workflowAutoSaveRef\.current\("auto"\), 700\)/);
  assert.match(appSource, /savedWorkflowHashRef\.current === definitionHash/);
  assert.match(appSource, /currentWorkflowIdRef\.current = saved\.id/);
  assert.match(appSource, /onBack=\{\(\) => setWorkflowBuilderOpen\(false\)\}/);
});

test("model controls never reuse another capability profile's catalog", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /configuredModelOptions\(\{ model, models \}\)/u);
  assert.doesNotMatch(appSource, /models \?\? activeProviderModels/u);
  assert.doesNotMatch(appSource, /activeProviderModels/u);
});

test("video catalog runs the selected audio feature instead of the route default", () => {
  assert.equal(resolveDesktopRunAction("/dashboard/video", "video_generate", "voice_synthesis"), "voice_synthesis");
  assert.equal(resolveDesktopRunAction("/dashboard/video", "video_generate", "music_generate"), "music_generate");
  assert.equal(resolveDesktopRunAction("/dashboard/capabilities", null, "writer", "voice-synthesis"), "voice_synthesis");
  assert.equal(resolveDesktopRunAction("/dashboard/capabilities", null, "writer", "ai-music"), "music_generate");
  assert.equal(workflowActionForMediaFeature("audio-generate"), "audio_generate");
  assert.equal(workflowActionForMediaFeature("unknown"), null);
  assert.equal(resolveDesktopRunAction("/dashboard/image-assistant", "image_generate", "writer"), "image_generate");
});

test("closing the active media tab keeps the next tab and capability profile aligned", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const tabsSource = readFileSync(resolve(process.cwd(), "src/media-tabs.ts"), "utf8");
  assert.match(tabsSource, /function closeDesktopMediaTab/u);
  assert.match(tabsSource, /activeTabId === featureId \? nextTabs\.at\(-1\)\?\.id \?\? null : activeTabId/u);
  assert.match(appSource, /const next = closeDesktopMediaTab\(tabs, activeFeatureId, featureId\)/u);
  assert.match(appSource, /const nextAction = nextActive \? actionByFeature\[nextActive\] : undefined/u);
  assert.match(appSource, /if \(nextAction && nextAction !== workflowAction\) onWorkflowAction\(nextAction\)/u);
});

test("ordinary AI and home routes do not inherit a stale media action", () => {
  assert.equal(resolveDesktopRunAction("/dashboard/ai", null, "voice_synthesis"), "llm_generate");
  assert.equal(resolveDesktopRunAction("/dashboard/ai?entry=consulting-advisor", null, "video_generate"), "llm_generate");
  assert.equal(resolveDesktopRunAction("/dashboard", null, "music_generate"), "llm_generate");
});

test("agent-scoped PPT routes preserve the PPT capability for provider and artifact policy", () => {
  assert.equal(resolveDesktopRunAction("/dashboard/ai?agent=executive-ppt", "ppt_generate", "llm_generate"), "ppt_generate");
  assert.equal(resolveDesktopRunAction("/dashboard/ai?agent=executive-presentation-ppt", "ppt_generate", "llm_generate"), "ppt_generate");
});

test("task center opens the task entry and restores the requested media capability", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /function readDesktopTaskMetadata\(detail: RunDetail\)/u);
  assert.match(appSource, /eventType: "task_metadata"/u);
  assert.match(appSource, /const openTaskEntry = async \(run: RunRow\)/u);
  assert.match(appSource, /metadata\?\.entryPath/u);
  assert.match(appSource, /const requestedFeature = new URLSearchParams\(routeQuery\)/u);
  assert.match(appSource, /window\.location\.search/u);
});

test("workspace model and reasoning changes persist to the selected capability profile", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /const persistProviderSelection = \(update: \(current: DesktopConfig\) => DesktopConfig\)/);
  assert.match(appSource, /configRef\.current = nextConfig/);
  assert.match(appSource, /tauriBridge\.invoke\("write_config", \{ value: nextConfig \}\)/);
  assert.match(appSource, /const profileId = providerForCapability\(current, activeCapability\)\.id/u);
  assert.match(appSource, /reasoningEffort: reasoning/);
});

test("model changes persist to the resolved compatible profile after fallback", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /const profileId = providerForCapability\(current, activeCapability\)\.id/u);
  assert.doesNotMatch(appSource, /const profileId = current\.defaults\?\.\[activeCapability\]/u);
});

test("desktop usage records the model reported by the active Provider event", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /event\.model\?\.trim\(\) \|\| runModelsRef\.current\.get\(event\.runId\) \|\| configRef\.current\.provider\.model \|\| "unknown"/);
});

test("desktop home keeps the cloud entry grouping and includes the local read-only Agent Center", () => {
  assert.deepEqual(WORKBENCH_HOME_GROUPS.map((group) => group.label), ["AI TEAM", "OFFICE TOOLS", "WORKFLOWS", "CONTENT CREATION"]);
  const homePaths = WORKBENCH_HOME_GROUPS.flatMap((group) => group.entries.map((entry) => entry.path));
  assert.ok(homePaths.includes("/dashboard/ai"));
  assert.equal(homePaths.includes("/dashboard/works"), false);
  assert.equal(homePaths.includes("/dashboard/agent-platform"), true);
  assert.equal(homePaths.includes("/dashboard/platform-settings"), false);
});

test("cloud and desktop consume one canonical home copy contract", () => {
  const desktopSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const cloudSource = readFileSync(resolve(process.cwd(), "../../components/platform/workspace-platform-home.tsx"), "utf8");
  assert.equal(WORKBENCH_HOME_COPY.zh.workspaceReady, "工作区已就绪");
  assert.equal(WORKBENCH_HOME_COPY.en.viewUsage, "View usage");
  assert.match(desktopSource, /WORKBENCH_HOME_COPY/);
  assert.match(cloudSource, /WORKBENCH_HOME_COPY/);
  assert.match(desktopSource, /homeCopy\.welcomePrefix/);
  assert.match(cloudSource, /homeCopy\.welcomePrefix/);
});

test("desktop and cloud home use one shared route-icon renderer", () => {
  const desktopSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const cloudSource = readFileSync(resolve(process.cwd(), "../../components/platform/workspace-platform-home.tsx"), "utf8");
  const iconSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/route-icon.tsx"), "utf8");
  assert.match(desktopSource, /WorkbenchRouteIcon/);
  assert.match(cloudSource, /WorkbenchRouteIcon/);
  assert.match(cloudSource, /iconKey/);
  assert.match(iconSource, /House/);
  assert.match(iconSource, /Presentation/);
  assert.match(iconSource, /Workflow/);
});

test("cloud and desktop home omit SaaS-only marketplace and platform settings entries", () => {
  const cloudSource = readFileSync(resolve(process.cwd(), "../../components/platform/workspace-platform-home.tsx"), "utf8");
  assert.doesNotMatch(cloudSource, /href="\/dashboard\/platform-settings"/);
  assert.match(cloudSource, /href="\/dashboard\/tasks" className="home-credits-link"/);
});

test("desktop bundle has no SaaS account, billing, publishing, or enterprise preset affordances", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const routeSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/routes.ts"), "utf8");
  const source = `${appSource}\n${routeSource}`;
  const forbiddenAffordances = [
    "/dashboard/login",
    "/dashboard/register",
    "/dashboard/billing",
    "/dashboard/subscription",
    "/dashboard/marketplace",
    "/dashboard/platform-settings",
    "Publish as Agent",
    "Agent marketplace",
    "Enterprise preset",
    "企业预设",
  ];
  for (const marker of forbiddenAffordances) assert.equal(source.includes(marker), false, marker);
});

test("desktop navigation preserves shared route placement and exact Agent highlighting", () => {
  const shellSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/components.tsx"), "utf8");
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /navItems=\{sidebarRoutes\.map\(/);
  assert.match(appSource, /const menuAgentRoutes = useMemo/);
  assert.match(appSource, /placement: route\.placement/);
  assert.match(shellSource, /navItems\.filter\(\(item\) => item\.placement !== "hidden"\)/);
  assert.match(shellSource, /isWorkbenchNavItemActive/);
  assert.equal(WORKBENCH_ROUTE_MANIFEST.filter((route) => route.placement !== "hidden").some((route) => route.path === "/dashboard/video"), false);
  assert.equal(WORKBENCH_ROUTE_MANIFEST.filter((route) => route.placement === "footer").map((route) => route.path).join(","), "/dashboard/settings");
});

test("desktop sidebar owns its scroll area and shows recent assistant sessions", () => {
  const shellSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/components.tsx"), "utf8");
  const shellStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(shellSource, /wb-sidebar-scroll/u);
  assert.match(shellSource, /visibleSessions\.slice\(0, 30\)/u);
  assert.match(shellSource, /onNewSession/u);
  assert.match(shellStyles, /\.shell \{[^}]*height: 100dvh;[^}]*overflow: hidden;/u);
  assert.match(shellStyles, /\.wb-shell-frame \{[^}]*height: 100dvh;[^}]*overflow: hidden;/u);
  assert.match(shellStyles, /\.wb-sidebar-scroll \{[^}]*overflow-y: auto;/u);
  assert.match(shellStyles, /\.wb-shell-main \{[^}]*overflow-y: auto;/u);
  assert.match(appSource, /sessions=\{conversations\.map/u);
  assert.match(appSource, /activeSessionAgentId=\{conversationScope\}/u);
  assert.match(appSource, /onNewSession=/u);
  assert.match(appSource, /function conversationAwareRoute/u);
  assert.match(appSource, /conversationRoute\(conversation\)/u);
  assert.match(appSource, /DesktopTaskCenterSurface runs=\{runs\} conversations=\{conversations\}/u);
  assert.equal(isWorkbenchAssistantPath("/dashboard/ai"), true);
  assert.equal(isWorkbenchAssistantPath("/dashboard/ai/conversation-1"), true);
  assert.equal(isWorkbenchAssistantPath("/dashboard/ai?agent=executive-ppt"), true);
  assert.equal(isWorkbenchAssistantPath("/dashboard/writer"), false);
});

test("desktop sidebar matches the online assistant navigation hierarchy and visual tokens", () => {
  const shellSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/components.tsx"), "utf8");
  const shellStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const paths = WORKBENCH_ROUTE_MANIFEST.map((route) => route.path);

  assert.equal(isWorkbenchNavItemActive("/dashboard", "/dashboard", paths), true);
  assert.equal(isWorkbenchNavItemActive("/dashboard", "/dashboard/", paths), true);
  assert.equal(isWorkbenchNavItemActive("/dashboard", "/dashboard/ai/conversation-1", paths), false);
  assert.equal(isWorkbenchNavItemActive("/dashboard/ai", "/dashboard/ai/conversation-1", paths), true);
  assert.equal(isWorkbenchNavItemActive("/dashboard/ai", "/dashboard/ai?agent=executive-ppt", paths), false);
  assert.equal(isWorkbenchNavItemActive("/dashboard/ai?agent=executive-ppt", "/dashboard/ai?agent=executive-ppt", paths), true);

  assert.match(shellSource, /item\.path === "\/dashboard\/ai"/u);
  assert.match(shellSource, /workbenchSessionScope\(item\.path\)/u);
  assert.doesNotMatch(shellSource, /activePath === "\/dashboard\/agent-platform"/u);
  assert.match(shellSource, /wb-sidebar-session-create/u);
  assert.match(shellSource, /aria-expanded=\{/u);
  assert.match(shellSource, /setAssistantSessionsExpanded/u);
  assert.doesNotMatch(shellSource, /session\.updatedLabel/u);
  assert.match(shellSource, /wb-sidebar-context-label/u);
  assert.match(shellStyles, /\.wb-brand-mark \{[^}]*width: 40px;[^}]*height: 40px;[^}]*border-radius: 6px;/u);
  assert.match(shellStyles, /\.wb-nav-item \{[^}]*min-height: 40px;[^}]*border-radius: 6px;/u);
  assert.match(shellStyles, /\.wb-nav-item-active \{[^}]*color: var\(--wb-primary[^}]*background: var\(--wb-foreground/u);
  assert.match(shellStyles, /\.wb-nav-item-active-assistant \{[^}]*color: var\(--wb-primary-foreground[^}]*background: var\(--wb-sidebar-highlight/u);
  assert.match(shellStyles, /\.wb-sidebar-session-create \{[^}]*width: 100%;[^}]*height: 36px;/u);
  assert.match(shellStyles, /\.wb-sidebar-session \{[^}]*border-radius: 6px;[^}]*padding: 10px 12px;/u);
  assert.match(shellStyles, /\.wb-sidebar-session-list \{[^}]*max-height: 288px;[^}]*overflow-y: auto;/u);
});

test("cloud static sidebar routes use the shared icon renderer", () => {
  const cloudLayout = readFileSync(resolve(process.cwd(), "../../components/dashboard-layout.tsx"), "utf8");
  assert.match(cloudLayout, /WorkbenchRouteIcon/);
  assert.match(cloudLayout, /iconName="home"/);
  assert.match(cloudLayout, /iconName="workflow"/);
  assert.match(cloudLayout, /iconName="knowledge"/);
});

test("desktop shell keeps the cloud visual primitives and workflow state path", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /WorkbenchShell/);
  assert.doesNotMatch(appSource, /LOCAL AGENT WORKBENCH/u);
  assert.doesNotMatch(appSource, /workspace-utility-actions/u);
  assert.match(appSource, /WORKBENCH_THEME/);
  assert.doesNotMatch(appSource, /WorkbenchChatMessage/);
  assert.match(appSource, /homeMessages/);
  assert.match(appSource, /showSkill=\{false\}/);
  const cloudAiEntrySource = readFileSync(resolve(process.cwd(), "../../components/ai-entry/ai-entry-workspace.tsx"), "utf8");
  const sharedMessageSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/components.tsx"), "utf8");
  assert.match(cloudAiEntrySource, /WorkbenchCloudMessageShell/);
  assert.match(sharedMessageSource, /data-cloud-surface="message"/);
  assert.doesNotMatch(appSource, /WorkbenchMessageFrame/);
  assert.match(appSource, /onRun=\{\(definition\) => void runAgent\(undefined, undefined, undefined, definition\)\}/);
  assert.match(appSource, /onDefinitionChange/);
  assert.match(appSource, /workflowDefinition/);
});

test("cloud and desktop consume the public structured message timeline and package CSS", () => {
  const desktopSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const desktopEntry = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
  const cloudSource = readFileSync(resolve(process.cwd(), "../../components/ai-entry/ai-entry-workspace.tsx"), "utf8");
  const cloudCss = readFileSync(resolve(process.cwd(), "../../app/globals.css"), "utf8");
  assert.match(desktopSource, /WorkbenchMessageSurface/);
  assert.match(cloudSource, /WorkbenchMessageTimeline/);
  assert.match(desktopEntry, /@coworkany\/workbench-ui\/styles\.css/);
  assert.match(cloudCss, /@coworkany\/workbench-ui\/styles\.css/);
});

test("desktop loads the same Tailwind source boundary as the cloud message surface", () => {
  const desktopEntry = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
  const desktopVite = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
  const desktopTailwind = readFileSync(resolve(process.cwd(), "src/tailwind.css"), "utf8");
  assert.match(desktopEntry, /\.\/tailwind\.css/);
  assert.match(desktopVite, /@tailwindcss\/postcss/);
  assert.match(desktopTailwind, /@import "tailwindcss" source\(none\)/);
  assert.match(desktopTailwind, /@source "\.\.\/\.\.\/\.\.\/packages\/workbench-ui\/src"/);
  assert.match(desktopTailwind, /@source "\.\.\/\.\.\/\.\.\/packages\/workbench-ui\/node_modules\/streamdown\/dist\/\*\.js"/);
  assert.match(desktopTailwind, /@source inline\("space-y-4 whitespace-normal/);
});

test("desktop Agent Center uses the shared read-only directory and starts local chats", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /WorkbenchAgentDirectory/);
  assert.match(appSource, /selected\.path === "\/dashboard\/agent-platform"/);
  assert.match(appSource, /\/dashboard\/ai\?agent=/);
  assert.match(appSource, /menuAgentIds/);
  assert.match(appSource, /加入左侧菜单/);
  assert.match(appSource, /routes\.flatMap\(\(route\) => route\.path === "\/dashboard\/ai"/);
  assert.match(appSource, /placement: "main" as const/);
  assert.match(appSource, /menuAgentIdsRef\.current = nextIds/);
  assert.doesNotMatch(appSource, /Create agent|Publish agent|Enterprise agent/);
});

test("desktop Agent Center includes the complete online built-in and imported catalog", () => {
  const builtInCards = buildOnlineAgentGroups("zh", true).flatMap((group) => group.cards);
  const importedCards = buildAgencyAgentGroups("zh", true).flatMap((group) => group.cards);
  assert.equal(builtInCards.length, WORKBENCH_ONLINE_AGENTS.length);
  assert.equal(importedCards.length, 232);
  assert.ok(importedCards.some((card) => card.id === "agency-marketing-seo-specialist"));
  assert.ok(importedCards.some((card) => card.id === "agency-security-penetration-tester"));
});

test("desktop-only runtime status does not alter the cloud sidebar geometry", () => {
  const sharedSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/components.tsx"), "utf8");
  const localeSource = readFileSync(resolve(process.cwd(), "src/i18n.ts"), "utf8");
  assert.match(sharedSource, /localLabel \? <div className="wb-sidebar-context-label"/);
  assert.match(sharedSource, /status \? <div className="wb-status"/);
  assert.match(localeSource, /localWorkspace: "本地工作区 · FULL ACCESS"/);
  assert.match(localeSource, /localWorkspace: "LOCAL WORKSPACE · FULL ACCESS"/);
});

test("local Skill preference is persisted in config while hidden from the cloud composer row", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /provider\.skillId/);
  assert.match(appSource, /setSkillIdState\(activeConfig\.provider\.skillId/);
  assert.doesNotMatch(appSource, /默认 Skill/);
  assert.doesNotMatch(appSource, /Default Skill/);
  assert.match(appSource, /showSkill=\{false\}/);
});

test("shared shell local-language controls are localized in both directions", () => {
  const sharedSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/components.tsx"), "utf8");
  assert.match(sharedSource, /locale === "zh" \? "切换到中文" : "Switch to Chinese"/);
  assert.match(sharedSource, /locale === "en" \? "Switch to English" : "切换到英文"/);
});

test("desktop home uses the same cloud page shell nesting", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const styleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const sharedStyleSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/styles.css"), "utf8");
  assert.match(appSource, /className="home-shell"><div className="home-page-shell"><header className="home-topbar"/);
  assert.match(appSource, /mode: route\.mode,/);
  assert.match(appSource, /<main className="home-main">/);
  assert.match(appSource, /<HomeEntryGroups onNavigate=\{workbenchClient\.navigation\.go\} locale=\{locale\} \/>/);
  assert.match(appSource, /chat-landing-kicker/);
  assert.match(appSource, /className="dashboard-title"/);
  assert.match(appSource, /<WorkbenchPromptInput[\s\S]*onSubmit=\{\(\) => void runAgent\(\)\}/);
  assert.match(appSource, /if \(launchSelectedPath === "\/dashboard" && conversationId\) \{[\s\S]*?workbenchClient\.navigation\.go\(conversationRoute\(\{ id: conversationId, agent_id: conversationAgentId \}\)\)/u);
  assert.match(appSource, /placeholder=\{copy\.homePlaceholder\}/);
  assert.match(appSource, /showSkill=\{false\}/);
  assert.doesNotMatch(appSource, /className="run-card"/);
  assert.match(styleSource, /\.workspace-home > \.recent-card, \.workspace-home > \.stats-card \{ display: none; \}/);
  assert.doesNotMatch(appSource, /<textarea value=\{prompt\}/);
  assert.match(readFileSync(resolve(process.cwd(), "src/i18n.ts"), "utf8"), /homePlaceholder: "输入你的问题\.\.\."/);
  assert.match(readFileSync(resolve(process.cwd(), "src/i18n.ts"), "utf8"), /homePlaceholder: "Ask anything\.\.\."/);
  assert.match(sharedStyleSource, /\.wb-ai-prompt-input/);
  assert.match(sharedStyleSource, /\.wb-ai-prompt-toolbar/);
  assert.match(sharedStyleSource, /\.wb-ai-prompt-textarea \{[^}]*margin: 0;[^}]*padding: 0;/u);
  assert.match(sharedStyleSource, /\.wb-ai-model-trigger \{[^}]*height: 34px;[^}]*min-height: 34px;[^}]*border-radius: 8px;/u);
  assert.match(sharedStyleSource, /\.wb-ai-prompt-icon-button, \.wb-ai-prompt-submit, \.wb-ai-prompt-stop \{[^}]*height: 34px;[^}]*width: 34px;/u);
  assert.match(styleSource, /\.model-select-control \{[^}]*height: 34px;[^}]*min-height: 34px;[^}]*border-radius: 8px;/u);
});

test("desktop startup keeps a visible progress surface during runtime hydration", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const indexSource = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const styleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  assert.match(appSource, /function DesktopBootstrapScreen/);
  assert.match(appSource, /runtimePhase/);
  assert.match(appSource, /setRuntimePhase\("state"\)/);
  assert.match(appSource, /setRuntimePhase\("repair"\)/);
  assert.match(appSource, /const \[shellReady, setShellReady\] = useState\(false\)/u);
  assert.match(appSource, /if \(!shellReady\) return <DesktopBootstrapScreen/u);
  assert.match(appSource, /if \(!runtimeReady\) \{/u);
  assert.match(appSource, /<DesktopBootstrapScreen locale=\{locale\}/);
  assert.match(indexSource, /id="boot-fallback"/);
  assert.match(indexSource, /boot-fallback-progress/);
  assert.match(styleSource, /\.bootstrap-card/);
  assert.match(styleSource, /\.bootstrap-stages/);
  assert.match(styleSource, /@keyframes bootstrap-spin/);
});

test("shared prompt input follows the AI Elements header, body, footer contract", () => {
  const source = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/ai-elements/source.tsx"), "utf8");
  const wrapperSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/prompt-input.tsx"), "utf8");
  const styleSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/styles.css"), "utf8");
  assert.match(source, /data-slot="prompt-input-header"/);
  assert.match(source, /data-slot="prompt-input-body"/);
  assert.match(source, /data-slot="prompt-input-footer"/);
  assert.match(source, /data-slot="prompt-input-tools"/);
  assert.match(wrapperSource, /data-slot="prompt-input-custom-tools"/);
  assert.match(wrapperSource, /PromptInputSelect className="wb-ai-prompt-model-select"/);
  assert.match(styleSource, /\.wb-ai-prompt-context/);
  assert.match(styleSource, /\.wb-ai-prompt-footer/);
  assert.match(styleSource, /\.wb-ai-prompt-tools \{ display: flex;/);
  assert.match(styleSource, /\.wb-ai-prompt-model-select \{ flex: 0 0 auto/);
});

test("chat keeps only message and execution-process frames", () => {
  const styleSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/styles.css"), "utf8");
  assert.match(styleSource, /\.wb-message-process \{[\s\S]*?border: 1px solid/);
  assert.match(styleSource, /Keep the chat hierarchy quiet: message and execution process are the only frames/);
  assert.match(styleSource, /\.wb-message-process \.wb-ai-process,[\s\S]*?border: 0;/);
  assert.match(styleSource, /\.wb-message-source,[\s\S]*?\.wb-message-report \{ padding: 0\.25rem 0; \}/);
  assert.match(styleSource, /\.wb-artifact-card \{[\s\S]*?border: 0;/);
});

test("query-string Agent routes highlight the exact cloud navigation item", () => {
  const sharedSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/components.tsx"), "utf8");
  assert.match(sharedSource, /if \(navPaths\.map\(normalize\)\.includes\(normalizedActivePath\)\) return false/);
  assert.match(sharedSource, /if \(normalizedItemPath !== itemBasePath\) return false/);
  assert.match(readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8"), /new URLSearchParams\(rawQuery\)/);
  assert.match(readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8"), /for \(const \[key, value\] of expected\.entries\(\)/);
});

test("desktop writer and media surfaces retain the online control contract", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const uploadSource = readFileSync(resolve(process.cwd(), "src/local-file-upload.ts"), "utf8");
  const sharedStyleSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/styles.css"), "utf8");
  const desktopStyleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  assert.doesNotMatch(appSource, /className="writer-composer-toolbar"/);
  assert.match(appSource, /writerCopy\.platform/);
  assert.match(appSource, /writerCopy\.content/);
  assert.match(appSource, /WORKBENCH_WRITER_PLATFORMS/);
  assert.match(appSource, /WORKBENCH_WRITER_CONTENT_TYPES/);
  assert.match(appSource, /WorkbenchMessageSurface messages=\{renderedUIMessages\}/);
  assert.match(appSource, /Object\.fromEntries\(Object\.entries\(fieldValues\)/);
  assert.match(appSource, /mediaInputs/);
  assert.match(appSource, /DesktopWriterCloudWorkspace/);
  assert.match(appSource, /writer-cloud-composer/);
  assert.match(appSource, /writer-preview-overlay/);
  assert.match(appSource, /function WriterPlatformPreview/);
  assert.match(appSource, /data-testid="writer-platform-preview"/);
  assert.match(appSource, /data-platform=\{platform\}/);
  assert.match(appSource, /writer-platform-preview-wechat-header/);
  assert.match(appSource, /writer-platform-preview-mobile-account/);
  assert.match(appSource, /writer-platform-preview-social-account/);
  assert.match(appSource, /\["weibo", "x", "linkedin", "facebook", "reddit"\]/);
  assert.match(appSource, /<MessageResponse content=\{content\}/);
  assert.match(appSource, /<WriterPlatformPreview platform=\{platform\} locale=\{locale\} content=\{previewText\} images=\{previewImages\}/);
  assert.match(appSource, /const \[previewMessage, setPreviewMessage\] = useState<DesktopUIMessage \| null>\(null\)/);
  assert.match(appSource, /onClick=\{\(\) => openPreview\(message\)\}/);
  assert.match(appSource, /writerImageArtifactsForArticle\(renderedUIMessages, selectedPreviewMessage\.id\)/);
  assert.match(appSource, /data-writerAsset/);
  assert.doesNotMatch(appSource, /writer-message-actions/);
  assert.match(appSource, /renderAssistantActions=\{\(message\)/);
  assert.match(appSource, /className="writer-cloud-message-surface"/);
  assert.match(appSource, /className="writer-cloud-message-shell"/);
  assert.match(appSource, /<MessageAction label=\{writerCopy\.preview\}/);
  assert.match(appSource, /<MessageAction label=\{copyKind === "rich"/);
  assert.match(appSource, /<CopyIcon size=\{14\}/);
  assert.match(appSource, /<FileText size=\{14\}/);
  assert.doesNotMatch(appSource, /message\.id !== latestAssistantId/);
  assert.match(appSource, /const text = previewEditing \? previewDraft : desktopUIMessageText\(message\)/);
  assert.match(appSource, /<div ref=\{messageSurfaceRef\}[\s\S]*?<WorkbenchMessageSurface[\s\S]*?messages=\{renderedUIMessages\}[\s\S]*?onRetry=/);
  assert.match(appSource, /data-cloud-surface="composer"/);
  assert.match(appSource, /onGenerateImages/);
  assert.match(appSource, /conversationMessages/);
  assert.match(appSource, /WorkbenchMessageSurface messages=\{renderedUIMessages\}/);
  assert.match(appSource, /WorkbenchPromptInput/);
  assert.match(appSource, /composer-selected-agent/);
  assert.match(appSource, /composer-knowledge-button/);
  assert.match(appSource, /startNewConversation/);
  assert.match(appSource, /knowledgeContextEnabled/);
  assert.match(appSource, /attachments=\{attachments\}/);
  assert.match(sharedStyleSource, /wb-ai-prompt-input/);
  assert.match(appSource, /onAddAttachments=\{onAddAttachments\}/);
  assert.match(appSource, /onKnowledgeToggle=\{onKnowledgeToggle\}/);
  assert.match(appSource, /previewEditing/);
  assert.match(appSource, /write_writer_draft/);
  assert.match(appSource, /writer-preview-editor/);
  assert.match(appSource, /data-testid="writer-preview-edit"/);
  assert.match(appSource, /data-testid="writer-preview-copy-rich"/);
  assert.match(appSource, /data-testid="writer-preview-copy-markdown"/);
  assert.match(appSource, /data-testid="writer-preview-export"/);
  assert.match(appSource, /写作 Markdown 已导出/);
  assert.match(appSource, /previewEditing \? previewDraft : previewText/);
  assert.match(appSource, /ClipboardItem/);
  assert.match(appSource, /document\.execCommand\("copy"\)/);
  assert.match(appSource, /knowledge\.search/);
  assert.match(appSource, /本地 Obsidian 知识库上下文/);
  assert.match(appSource, /<Suggestions className="chat-ai-suggestions chat-prompt-card-grid"/);
  assert.match(appSource, /<Suggestion key=\{item\}/);
  assert.match(appSource, /data-cloud-surface="prompt-suggestions"/);
  assert.match(desktopStyleSource, /\.writer-cloud-scroll \{[^}]*display: flex;[^}]*overflow: hidden;/);
  assert.match(desktopStyleSource, /\.writer-cloud-message-shell \{[^}]*display: flex;[^}]*flex: 1;/);
  assert.match(appSource, /添加 Obsidian 知识库/);
  assert.match(appSource, /const userPrompt =/);
  assert.match(appSource, /const runtimePrompt =/);
  assert.match(appSource, /content: displayedUserPrompt/);
  assert.match(appSource, /prompt: workflowExecutionPrompt/);
  assert.match(appSource, /persistLocalFile\(file, tauriBridge\)/);
  assert.match(uploadSource, /begin_local_attachment/);
  assert.match(uploadSource, /append_local_attachment_chunk/);
  assert.match(uploadSource, /finish_local_attachment/);
  assert.match(uploadSource, /file\.slice\(/);
  assert.doesNotMatch(uploadSource, /file\.stream\(\)/);
  const tauriSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
  assert.doesNotMatch(tauriSource, /write_local_attachment/);
  assert.match(tauriSource, /attachment_partial_target/);
  assert.match(tauriSource, /fs::rename\(&partial, &target\)/);
  assert.match(appSource, /relativePath/);
  assert.match(appSource, /本地附件（已复制到当前项目目录/);
  const sharedMessageSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/components.tsx"), "utf8");
  assert.match(sharedMessageSource, /MessageResponse/);
  assert.match(readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/ai-elements/source.tsx"), "utf8"), /Streamdown/);
  assert.match(sharedMessageSource, /data-cloud-surface="message"/);
  assert.equal(WORKBENCH_CHAT_QUICK_PROMPTS.length, 3);
  assert.equal(WORKBENCH_WRITER_QUICK_PROMPTS.length, 3);
});

test("new desktop conversations keep the AI Elements prompt input beside suggestions", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const promptInputSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/prompt-input.tsx"), "utf8");
  const desktopStyleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  assert.match(appSource, /const showLanding = isEmptyConversation;/);
  assert.match(appSource, /className="chat-ai-suggestions chat-prompt-card-grid"/);
  assert.match(appSource, /<div ref=\{composerDockRef\} className="chat-composer-dock">/);
  assert.match(appSource, /autoFocus=\{showLanding && !activeRunId\}/);
  assert.match(appSource, /focusRequest=\{composerFocusRequest\}/);
  assert.doesNotMatch(appSource, /composer-prompt-chips/);
  assert.match(promptInputSource, /autoFocus\?: boolean/);
  assert.match(promptInputSource, /focusRequest\?: number/);
  assert.match(promptInputSource, /<PromptInputTextarea[^>]*autoFocus=\{autoFocus\}/);
  assert.match(desktopStyleSource, /\.chat-prompt-card-grid \.ai-elements-suggestions-list \{[\s\S]*?display: grid;/);
  assert.match(desktopStyleSource, /\.chat-prompt-card \{[\s\S]*?min-height:/);
  assert.match(desktopStyleSource, /\.chat-workspace-section\.landing-active \.chat-landing \{[\s\S]*?--chat-composer-clearance/);
});

test("desktop video media surface mirrors the cloud capability and launcher contract", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const sharedStyleSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/styles.css"), "utf8");
  const desktopStyleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  assert.match(appSource, /function DesktopMediaWorkspaceBody/);
  assert.match(appSource, /function DesktopMediaWorkspace\(props: DesktopMediaWorkspaceProps\)/);
  assert.match(appSource, /const isMediaCatalog = isVideo \|\| isCapabilityCenter;/);
  assert.match(appSource, /selected\.path === "\/dashboard\/image-assistant" \|\| selected\.path === "\/dashboard\/video" \|\| selected\.path === "\/dashboard\/capabilities"/);
  assert.match(appSource, /title: props\.route\.label/);
  assert.match(appSource, /description: isVideo \? props\.route\.description/);
  assert.match(appSource, /activeTab \? <DesktopMediaWorkspaceBody/);
  assert.match(appSource, /showFeatureSelectors=\{false\}/);
  assert.match(appSource, /desktop-media-route-shell/);
  assert.match(appSource, /<WorkbenchCapabilityCenter/);
  assert.match(appSource, /onWorkflowAction\(nextAction\)/);
  assert.match(sharedStyleSource, /\.capability-groups-grid/);
  assert.match(sharedStyleSource, /\.launcher-tabs/);
  assert.match(desktopStyleSource, /\.desktop-media-route-shell \.capability-tile-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(desktopStyleSource, /\.desktop-media-route-shell \.capability-tile \{[\s\S]*?min-height: 72px/);
  assert.match(desktopStyleSource, /\.desktop-media-route-shell \.launcher-workspace \{ margin-top: 14px/);
  assert.match(desktopStyleSource, /\.media-workspace-grid \{ grid-template-columns: minmax\(360px,\.42fr\) minmax\(0,1fr\); \}/);
  assert.match(desktopStyleSource, /\.media-preview-panel \{ width: 100%; min-width: 0; \}/);
});

test("desktop image assistant keeps parameters left of results and renders model schemas", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const styleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const controlIndex = appSource.indexOf('<section className="media-control-panel">');
  const previewIndex = appSource.indexOf('<section className="media-preview-panel">');
  assert.ok(controlIndex >= 0 && previewIndex > controlIndex);
  assert.match(appSource, /getDesktopImageParameterSchema\(model, locale\)/);
  assert.match(appSource, /data-image-model-kind=\{imageModelKind\}/);
  assert.match(appSource, /buildDesktopImageRunInput\(model, imageSettings, localAttachmentPaths\)/);
  assert.match(appSource, /<WorkbenchPromptInput value=\{workspacePrompt\}/);
  assert.match(appSource, /media-reference-dropzone/);
  assert.match(appSource, /selectedFiles = files \? Array\.from\(files\) : \[\]/);
  assert.match(appSource, /previewUrl: URL\.createObjectURL\(file\)/);
  assert.match(appSource, /image-reference-cards/);
  assert.match(appSource, /accept=\{isImage \? "image\/\*"/);
  assert.match(appSource, /appendImageReferencePaths/);
  assert.match(appSource, /savedAttachments.*relativePath/);
  assert.match(appSource, /disabled=\{field\.id === "responseFormat"\}/);
  assert.doesNotMatch(appSource, /<option value="standard">\{locale === "en" \? "Standard"/);
  assert.match(appSource, /data-image-parameter="model"/);
  assert.doesNotMatch(appSource, /image-feature-summary/);
  assert.doesNotMatch(appSource, /当前参数已匹配/);
  const previewPanelIndex = appSource.indexOf('<section className="media-preview-panel">');
  const imageTaskIndex = appSource.indexOf('<WorkbenchTask title={locale === "en" ? "Image generation"', previewPanelIndex);
  const imagePreviewIndex = appSource.indexOf('<DesktopImageArtifactPreview', previewPanelIndex);
  assert.ok(previewPanelIndex >= 0 && imageTaskIndex > previewPanelIndex);
  assert.ok(imagePreviewIndex > previewPanelIndex && imagePreviewIndex < imageTaskIndex);
  assert.match(appSource, /media-preview-heading/);
  assert.match(appSource, /media-preview-fullscreen/);
  assert.match(appSource, /role="tablist"/);
  assert.match(appSource, /media-empty-output-card/);
  assert.match(styleSource, /\.media-output-tabs \{/);
  assert.match(styleSource, /\.media-empty-output-grid \{/);
  assert.match(styleSource, /\.image-reference-cards \{/);
});

test("desktop conversation history stays in the sidebar instead of above the composer", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const styleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const conversationWorkspace = appSource.slice(
    appSource.indexOf("function DesktopConversationWorkspace"),
    appSource.indexOf("type DesktopWriterCloudWorkspaceProps"),
  );
  assert.equal(appSource.includes("chat-session-list-dock"), false);
  assert.match(appSource, /sessions=\{conversations\.map\(/);
  assert.doesNotMatch(conversationWorkspace, /conversation-list|conversations\.map\(/);
  assert.equal(styleSource.includes("chat-session-list-dock"), false);
  assert.match(styleSource, /\.chat-workspace-section:not\(\.writer-cloud-workspace\) \.chat-message-scroll \{[^}]*position: absolute;[^}]*overflow: hidden;/u);
  assert.match(styleSource, /\.chat-workspace-section:not\(\.writer-cloud-workspace\) \.chat-composer-dock \{[^}]*position: absolute;[^}]*bottom: 0;/u);
  assert.match(styleSource, /\.chat-workspace-section:not\(\.writer-cloud-workspace\) \.chat-message-column > \.wb-ai-message-surface \.ai-elements-conversation-content \{[^}]*var\(--chat-composer-clearance\)/u);
});

test("desktop image assistant restores session prompt and image artifacts without cross-session leakage", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /DesktopMediaHistoryContext/);
  assert.match(appSource, /mediaArtifactsForConversation/);
  assert.match(appSource, /part\.type === "data-artifact"\)\.map\(\(part\) => part\.data\.id\)/);
  assert.match(appSource, /artifact\.id\.startsWith\(`\$\{runId\}:/);
  assert.match(appSource, /restoredHistoryPrompt/);
  assert.doesNotMatch(appSource, /media-session-prompt/);
  assert.match(appSource, /function DesktopImageArtifactPreview/);
  assert.match(appSource, /read_artifact/);
  assert.match(appSource, /<img src=\{preview\.source\}/);
});

test("writer and video title bars do not duplicate composer or form controls", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /<section className="chat-workspace-section writer-cloud-workspace">[\s\S]*?<header className="chat-page-header"><div>[\s\S]*?<\/header>/);
  assert.doesNotMatch(appSource, /chat-page-header[^\n]*workflow-header-actions[^\n]*ModelControls/);
  assert.doesNotMatch(appSource, /!isImage \? <div className="workflow-header-actions">/);
  assert.match(appSource, /activeFeature\.fields\.filter\(\(field\) => field\.id !== "prompt" && field\.id !== "model"\)\.map\(\(field\) =>/);
  assert.match(appSource, /<ModelControls locale=\{locale\} model=\{model\}/);
  assert.doesNotMatch(appSource, /workflow-process-evidence/);
  assert.doesNotMatch(appSource, /<WorkbenchPlan title=\{locale === "zh" \? "执行计划"/);
  assert.doesNotMatch(appSource, /<WorkbenchTask title=\{locale === "zh" \? "工作流任务"/);
});

test("desktop capabilities route mounts the shared online capability center", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /const isCapabilityCenter = routePath === "\/dashboard\/capabilities"/);
  assert.match(appSource, /<WorkbenchCapabilityCenter[\s\S]*?groups=\{capabilityGroups\}/);
  assert.match(appSource, /disabledReason: locale === "zh" \? "需要配置对应媒体 Provider"/);
  assert.match(appSource, /const immersivePage = selected\.mode === "chat"/);
});

test("desktop media workspace keeps hook order stable across route transitions", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const mediaSource = appSource.match(/function DesktopMediaWorkspace\([\s\S]*?function DesktopAssetLibrarySurface/)?.[0] ?? "";
  assert.match(mediaSource, /const featureMap = useMemo\([\s\S]*?if \(!isMediaCatalog\) return <DesktopMediaWorkspaceBody/);
});

test("settings deep link renders one settings surface instead of a duplicate library page", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /selected\.path === "\/dashboard\/settings" \? null : selected\.mode === "library"/);
  assert.match(appSource, /setSettingsOpen\(activePath === "\/dashboard\/settings"\)/);
  assert.match(appSource, /if \(activePath !== "\/dashboard\/settings"\) setSettingsOpen\(false\)/);
  assert.match(appSource, /if \(selected\.path === "\/dashboard\/settings"\) workbenchClient\.navigation\.go\("\/dashboard"\)/);
  assert.match(appSource, /className="settings-operation-status" role="status" aria-live="polite"/);
  assert.match(appSource, /setRunStatus\(locale === "zh" \? "正在打开目录选择器…"/);
});

test("desktop settings can detach a Vault without deleting local files", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /removeVault: "解除绑定"/);
  assert.match(appSource, /removeVault: "Detach Vault"/);
  assert.match(appSource, /disabled=\{!config\.obsidianVaultPath\}/);
  assert.match(appSource, /obsidianVaultPath: undefined, obsidianIndexPath: undefined/);
});

test("desktop settings keep Vault embeddings local unless the user explicitly selects remote", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /localEmbedding: "Local only \(default\)"/);
  assert.match(appSource, /remoteEmbedding: "Remote \(send chunks\)"/);
  assert.match(appSource, /mode: "remote"/);
  assert.match(appSource, /https:\/\/…\/v1/);
});

test("desktop settings manage Provider models and capability defaults in one surface", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /function DesktopConfiguredProviderProfiles/);
  assert.match(appSource, /settings-provider-capability-sections/);
  assert.match(appSource, /文本模型/);
  assert.match(appSource, /图片模型/);
  assert.match(appSource, /音频模型/);
  assert.match(appSource, /视频模型/);
  assert.match(appSource, /function DesktopProviderEditorModal/);
  assert.match(appSource, /settings-provider-modal-backdrop/);
  assert.match(appSource, /const removeProfile/);
  assert.match(appSource, /PROVIDER_PLATFORM_OPTIONS/);
  assert.match(appSource, /providerPlatformForId/);
  assert.match(appSource, /settings-provider-model-picker/);
  assert.match(appSource, /模型 ID/);
  assert.match(appSource, /models: \[model\]/);
  assert.match(appSource, /账号工作流注册/);
  assert.doesNotMatch(appSource, /支持的模型类型/);
});

test("media readiness follows Provider source instead of the default local id", () => {
  const source = readFileSync(resolve(process.cwd(), "src/provider-config.ts"), "utf8");
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(source, /source !== "local"/);
  assert.match(appSource, /isMediaProviderConfigured\(activeProvider\)/);
  assert.equal(isMediaProviderConfigured({ id: "local", source: "local", baseUrl: "http://127.0.0.1:11434/v1" }), false);
  assert.equal(isMediaProviderConfigured({ id: "local", source: "openai-compatible", baseUrl: "https://api.example.test/v1", model: "image-model" }), true);
  assert.equal(isMediaProviderConfigured({ id: "openai-compatible", baseUrl: "https://api.example.test/v1", model: "image-model" }), true);
  assert.equal(isMediaProviderConfigured({ id: "runninghub", source: "runninghub", baseUrl: "https://www.runninghub.cn" }), false);
  assert.match(appSource, /const providerConfigured = configuredProp;/);
  assert.doesNotMatch(appSource, /const providerConfigured = configuredProp \|\| activeMediaProviderConfigured;/);
});

test("media workflow nodes remain visible with a localized configuration-required state", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const canvasSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/workflow-canvas.tsx"), "utf8");
  assert.equal(requiresConfiguredProviderForWorkflowAction("image_generate"), true);
  assert.equal(requiresConfiguredProviderForWorkflowAction("video_generate"), true);
  assert.equal(requiresConfiguredProviderForWorkflowAction("voice_synthesis"), true);
  assert.equal(requiresConfiguredProviderForWorkflowAction("writer"), false);
  assert.match(appSource, /requiresProviderForNode=\{\(nodeType\) => requiresConfiguredProviderForWorkflowAction\(nodeType\)\}/);
  assert.match(canvasSource, /Configuration required/);
  assert.match(canvasSource, /需要配置 Provider/);
  assert.match(appSource, /openWorkflowProviderSettings/);
  assert.match(appSource, /providerConfiguredForNode=\{\(nodeType\) => isMediaProviderConfigured\(providerForCapability\(config, capabilityForWorkflowAction\(nodeType\)\)\)\}/);
  assert.match(canvasSource, /!providerConfiguredForNode\(node\.type\) && requiresProviderForNode\(node\.type\)/);
});

test("desktop media workspace keeps cloud upload, voice-library, and task actions", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /desktop-media-upload/);
  assert.match(appSource, /Upload local file/);
  assert.match(appSource, /Voice library/);
  assert.match(appSource, /Record reference/);
  assert.match(appSource, /MediaRecorder/);
  assert.match(appSource, /onAddAttachments/);
  assert.match(appSource, /localAttachmentPaths/);
  assert.match(appSource, /localAttachments: localAttachmentPaths/);
  assert.match(appSource, /onOpenTasks/);
});

test("desktop keeps cloud writer preview geometry and workflow locale labels", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const localeSource = readFileSync(resolve(process.cwd(), "src/i18n.ts"), "utf8");
  const styleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  assert.match(styleSource, /\.writer-preview-overlay \{ position: fixed; inset: 0; z-index: 100; display: flex; justify-content: flex-end/);
  assert.match(styleSource, /\.writer-preview-sheet \{ width: min\(920px, 100%\); height: 100%/);
  assert.match(styleSource, /\.writer-platform-preview-layout-article/);
  assert.match(styleSource, /\.writer-platform-preview-layout-social/);
  assert.match(styleSource, /\.writer-platform-preview-layout-mobile/);
  assert.match(styleSource, /\.writer-platform-preview-markdown > div > :is\(h1, h2, h3/);
  assert.match(styleSource, /\.writer-cloud-message-surface \.ai-elements-message-actions \{ opacity: 1; \}/);
  assert.match(appSource, /const actionLabel = \(item: \{ id: string; label: string \}\)/);
  assert.match(appSource, /actionLabel\(\{ id: node\.type, label: node\.title \}\)/);
  assert.match(appSource, /const localizedNodeTitle = \(node: WorkflowDefinitionNodeV2\)/);
  assert.match(appSource, /workflowActionEnglish\[node\.type\]/);
  assert.match(appSource, /const writerCopy = desktopWriterCopy\[locale\]/);
  assert.match(appSource, /<DesktopWriterCloudWorkspace locale=\{locale\}/);
  assert.match(localeSource, /export const desktopWriterCopy/);
});

test("desktop asset and task routes mirror the cloud library interaction contract", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const styleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  assert.match(appSource, /function DesktopAssetLibrarySurface/);
  assert.match(appSource, /function DesktopTaskCenterSurface/);
  assert.match(appSource, /asset-library-tabs/);
  assert.match(appSource, /view-toggle/);
  assert.match(appSource, /task-metric-grid/);
  assert.match(appSource, /task-center-toolbar/);
  assert.match(appSource, /task-center-table/);
  assert.match(appSource, /asset-library-card-preview/);
  assert.match(appSource, /asset-library-card-action-danger/);
  assert.match(appSource, /onArtifactRemove\(item\.id\)/);
  assert.match(styleSource, /\.asset-library-grid/);
  assert.match(styleSource, /\.asset-library-card-action-danger/);
  assert.match(styleSource, /\.task-center-table-head/);
  assert.match(styleSource, /\.task-status-completed/);
  assert.match(appSource, /getWorkbenchTaskStatusLabel/);
  assert.match(appSource, /isWorkbenchTaskRetryable/);
});

test("desktop chat keeps the message surface full-height behind a floating composer", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const styleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  assert.match(styleSource, /\.workspace\.workspace-immersive:has\(\.chat-canvas\) \{ height: 100%; min-height: 0; \}/);
  assert.match(styleSource, /\.chat-canvas \{ min-height: 0; height: 100%;/);
  assert.match(styleSource, /\.chat-workspace-section:not\(\.writer-cloud-workspace\) \.chat-message-scroll \{ position: absolute; inset: 0;/);
  assert.match(styleSource, /\.chat-workspace-section:not\(\.writer-cloud-workspace\) \.chat-message-column \{ display: flex; height: 100%;/);
  assert.match(styleSource, /\.chat-workspace-section:not\(\.writer-cloud-workspace\) \.chat-composer-dock \{ position: absolute;/);
  assert.match(styleSource, /\.chat-workspace-section:not\(\.writer-cloud-workspace\) \.chat-message-column > \.wb-ai-message-surface \.ai-elements-conversation-content \{ padding-bottom: calc\(1rem \+ var\(--chat-composer-clearance\)\);/);
  assert.match(styleSource, /\.chat-workspace-section:not\(\.writer-cloud-workspace\) \.chat-message-column > \.wb-ai-message-surface \.ai-elements-conversation-scroll-button \{ bottom: calc\(var\(--chat-composer-clearance\) - 0\.5rem\);/);
  assert.match(appSource, /new ResizeObserver\(updateComposerClearance\)/);
  assert.match(appSource, /section\.style\.setProperty\("--chat-composer-clearance"/);
});

test("ordinary chat, writer and PPT routes stay on the OpenCode session path", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /type: "session\.create"/);
  assert.match(appSource, /type: "session\.prompt"/);
  assert.match(appSource, /usesOpenCodeConversation/);
  assert.match(appSource, /createSessionRecoverySnapshot\(priorConversationHistory/);
  assert.match(appSource, /recovered === true/);
  assert.match(appSource, /if \(conversationId && resolvedChatReady && !attachments\.length && !knowledgeEnabled && prompt\.trim\(\)\)/);
  assert.match(appSource, /conversationId=\{conversationIdFromPath\(activePath\)\}/);
  assert.match(appSource, /chatReady=\{Boolean\(conversationIdFromPath\(activePath\)\)\}/);
  assert.match(appSource, /const reconcileRuns = async \(\) =>/);
  assert.match(appSource, /isWorkbenchTaskActive\(normalizeWorkbenchTaskStatus\(persisted\.status\)\)/);
  assert.doesNotMatch(appSource, /ai-sdk-native/);
});

test("desktop restores a routed OpenCode session before mounting native questions", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const tauriSource = readFileSync(resolve(process.cwd(), "src/tauri.ts"), "utf8");
  assert.match(appSource, /questionConversationForRoute\(activePath, conversations\)/u);
  assert.match(appSource, /restoreQuestionSession/u);
  assert.match(appSource, /type: "session\.attach"/u);
  assert.match(appSource, /attempt < 3/u);
  assert.match(appSource, /availableQuestionSessionIds/u);
  assert.match(appSource, /questionSessionIdForRoute\(activePath, conversations, availableQuestionSessionIds\)/u);
  assert.match(appSource, /for \(const waiter of \[\.\.\.responseWaiters\.current\.values\(\)\]\) waiter\(hostExitResponse\)/u);
  assert.match(appSource, /questionSessionRestoreInFlightRef\.current\.clear\(\)/u);
  assert.match(appSource, /if \(hostResponse\.ok === false\) \{/u);
  assert.doesNotMatch(appSource, /isHomeRoute \? activeConversationId/u);
  assert.match(tauriSource, /currentHostGeneration/u);
  assert.match(tauriSource, /generation < currentHostGeneration/u);
});

test("desktop conversation history and retry flow consume the injected WorkbenchClient", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /const workbenchClient = useMemo\(\(\) => createDesktopWorkbenchClient/);
  assert.match(appSource, /workbenchClient\.conversations\.list\(\)/);
  assert.match(appSource, /const loadConversationMessages = useCallback/);
  assert.match(appSource, /workbenchClient\.conversations\.messages\(conversationId, options\)/);
  assert.match(appSource, /const loadOlderConversationMessages = useCallback/);
  assert.match(appSource, /before: cursor/);
  assert.match(appSource, /onReachTop=\{onReachTop\}/);
  const conversationSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/ai-elements/source.tsx"), "utf8");
  assert.match(conversationSource, /StickToBottom/);
  assert.match(conversationSource, /ConversationScrollBridge/);
  assert.match(appSource, /opencode_session_id: conversation\.opencodeSessionId \?\? null/);
  assert.match(appSource, /const existingSessionId = conversations\.find\(\(item\) => item\.id === conversationId\)\?\.opencode_session_id/);
  assert.match(appSource, /workbenchClient\.conversations\.messages\(run\.conversation_id\)/);
  assert.match(appSource, /workbenchClient\.workflows\.list\(\)/);
  assert.match(appSource, /workbenchClient\.workflows\.save\(/);
  assert.match(appSource, /workbenchClient\.runs\.start\(/);
  assert.match(appSource, /workbenchClient\.runs\.emergencyStop\(/);
  assert.match(appSource, /parseWorkflowImportText\(/);
  assert.match(appSource, /run_recovery_rejected|recoveryDefinitionHash/);
  assert.match(appSource, /completed, recoveryDefinitionHash/);
});

test("desktop conversations isolate async history and background run events by session", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /const activeRunsByConversationRef = useRef\(new Map<string, string>\(\)\)/u);
  assert.match(appSource, /const runContextsRef = useRef\(new Map<string, DesktopRunContext>\(\)\)/u);
  assert.match(appSource, /const conversationLoadRequestRef = useRef\(0\)/u);
  assert.match(appSource, /requestId !== conversationLoadRequestRef\.current \|\| activePathRef\.current !== activePath/u);
  assert.match(appSource, /const isVisibleRoute = Boolean\(event\?\.runId && desktopRunIsVisible\(runContext, activePathRef\.current, activeConversationRef\.current, workflowCanvasKeyRef\.current\)\)/u);
  assert.match(appSource, /const isDisplayedRun = runContext\?\.kind === "conversation"/u);
  assert.match(appSource, /const isVisibleEvent = isVisibleRoute && isDisplayedRun/u);
  assert.match(appSource, /if \(isVisibleEvent\) setToolEvents/u);
  assert.match(appSource, /activeRunsByConversationRef\.current\.get\(conversationId\) === event\.runId/u);
  assert.match(appSource, /if \(isVisibleEvent\) setActiveRunId\(conversationId \? activeRunsByConversationRef\.current\.get\(conversationId\) \?\? null : null\)/u);
  assert.match(appSource, /activeRunsByConversationRef\.current\.get\(currentConversationId\) === runId\) activeRunsByConversationRef\.current\.delete\(currentConversationId\)/u);
  assert.match(appSource, /runContextsRef\.current\.delete\(runId\);\n        setActiveRunId\(null\)/u);
});

test("desktop exposes Full Access compatibility and the Agent approval protocol without leaking API keys", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /Full Access OpenCode file tools/);
  assert.match(appSource, /Full Access/);
  assert.match(appSource, /API Key[^\n]*config\.json/);
  assert.match(appSource, /不会写入 SQLite、日志或诊断包/);
  assert.match(appSource, /it is not written to SQLite, logs, or diagnostics/);
  assert.match(appSource, /function SettingsSecretInput\(/);
  assert.match(appSource, /type=\{visible \? "text" : "password"\}/);
  assert.match(appSource, /aria-pressed=\{visible\}/);
  assert.match(appSource, /<SettingsSecretInput value=\{draft\.apiKey\}/);
  assert.match(appSource, /coworkany:tool-approval/);
  assert.match(appSource, /permission\.respond/);
  const hostSource = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  assert.match(hostSource, /permission\.respond/);
  assert.match(hostSource, /permissionMode === "ask"/);
});

test("task center exposes persisted node, event and usage evidence", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const storageSource = readFileSync(resolve(process.cwd(), "src-tauri/src/storage.rs"), "utf8");
  const tauriSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
  assert.match(appSource, /onInspectRun=\{\(runId\) => workbenchClient\.runs\.inspect\(runId\)\.then\(toRunDetail\)\}/);
  assert.match(appSource, /workbenchClient\.artifacts\.remove\(artifactId\)/);
  assert.match(appSource, /workbenchClient\.knowledge\.open\(relativePath\)/);
  assert.match(appSource, /run-evidence-panel/);
  assert.match(appSource, /payloadPreview/);
  assert.match(storageSource, /pub fn inspect_run\(/);
  assert.match(storageSource, /RunDetail \{ pub run: RunRow, pub nodes:/);
  assert.match(tauriSource, /fn inspect_run\(/);
});

test("desktop media and asset artifact reveals consume the WorkbenchClient file port", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const tauriSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
  assert.match(appSource, /onArtifactReveal=\{\(relativePath, mimeType\) => void workbenchClient\.files\.reveal\(relativePath, mimeType\)\}/);
  assert.match(appSource, /onArtifactReveal\(artifact\.relative_path, artifact\.mime_type\)/);
  assert.match(appSource, /onArtifactReveal\(item\.relative_path, item\.mime_type\)/);
  assert.match(appSource, /tauriBridge\.invoke<LocalMediaPreview>\("read_artifact", \{ relativePath, mimeType \}\)/);
  assert.match(appSource, /artifact-preview-backdrop/);
  const assetCardSource = appSource.match(/function DesktopArtifactLibraryCard\([\s\S]*?function DesktopArtifactPreviewModal/)?.[0] ?? "";
  assert.match(assetCardSource, /asset-library-card-media/);
  assert.match(assetCardSource, /asset-library-card-icon/);
  assert.doesNotMatch(assetCardSource, /read_artifact|mediaSource|URL\.createObjectURL/);
  const assetPreviewSource = appSource.match(/function DesktopArtifactPreviewModal\([\s\S]*?function DesktopAssetLibrarySurface/)?.[0] ?? "";
  assert.match(assetPreviewSource, /read_artifact/);
  assert.match(appSource, /artifact-preview-content/);
  assert.match(appSource, /open_artifact_folder/);
  assert.match(appSource, /<video controls preload="metadata" src=\{preview\.source\}/);
  assert.match(appSource, /<audio controls preload="metadata" src=\{preview\.source\}/);
  assert.match(appSource, /workflow-upload-media-preview/);
  assert.match(appSource, /<img src=\{previewSource\} alt=\{previewFile\.fileName\}/);
  assert.match(appSource, /<video controls preload="metadata" src=\{previewSource\}/);
  assert.doesNotMatch(appSource, /FileReader|readAsDataURL/);
  assert.doesNotMatch(appSource, /tauriBridge\.invoke\("open_artifact"/);
  assert.match(tauriSource, /fn open_artifact\([\s\S]*?platform::reveal_path_command\(&target\)/);
  assert.match(tauriSource, /fn open_artifact_folder\([\s\S]*?platform::open_path_command\(folder\)/);
  assert.match(tauriSource, /fn open_artifact_with\(/);
  assert.match(tauriSource, /fn open_with_installed_program\(target: &Path\)/);
  assert.match(tauriSource, /fn open_artifact_default\([\s\S]*?open_with_default_program\(&target\)/);
  assert.match(tauriSource, /fn read_artifact\([\s\S]*?artifacts::inspect\(&root, &relative_path, &mime_type\)/);
  assert.match(tauriSource, /MAX_PREVIEW_BYTES: u64 = 64 \* 1024 \* 1024/);
  assert.match(tauriSource, /fn open_with_default_program\(target: &Path\)/);
  assert.doesNotMatch(tauriSource, /open_artifact_default[\s\S]*?Command::new\("cmd\.exe"\)/);
  const styleSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  assert.match(styleSource, /\.artifact-preview-dialog \{[^}]*width: fit-content/u);
  assert.match(styleSource, /\.artifact-preview-stage > footer \{[^}]*position: sticky/u);
});

test("OpenCode serve errors terminate the asynchronous turn barrier", () => {
  const serveSource = readFileSync(resolve(process.cwd(), "runtime/opencode-serve.ts"), "utf8");
  assert.match(serveSource, /active\.failed =/);
  assert.match(serveSource, /if \(active\.failed\) throw new Error\(active\.failed\)/);
  assert.match(serveSource, /normalizeOpenCodeServeEvent/);
  assert.match(serveSource, /normalized\.terminalError/);
  assert.match(serveSource, /openCodeServeSessionPath\(sessionId, workspacePath, useCommand \? "command" : "prompt_async"\)/);
  assert.match(serveSource, /openCodeServeSessionStatusPath/);
  assert.match(serveSource, /pollSessionStatus/);
});

test("desktop tears down asynchronously attached Tauri listeners under React StrictMode", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(appSource, /let listenersDisposed = false/);
  assert.match(appSource, /if \(listenersDisposed\) unlisten\(\)/);
  assert.match(appSource, /listenersDisposed = true/);
});

test("desktop keeps persisted chat messages in chronological order without projecting duplicates", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.doesNotMatch(appSource, /assistantCreatedAtRef\.current\.set\(runId, userMessageCreatedAt\)/);
  assert.match(appSource, /baseMessages\.some\(\(message\) => message\.role === "assistant" && message\.content === assistantText\)/);
});

test("desktop workflow builder exposes completed output in the run status surface", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const desktopStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  assert.match(appSource, /const workflowOutputsRef = useRef\(new Map<string, string>\(\)\)/);
  assert.match(appSource, /nodeKey === "output"/);
  assert.match(appSource, /工作流已完成，本地结果已写入结果预览/);
  assert.match(desktopStyles, /\.workflow-canvas \{ display: grid;/);
  assert.match(desktopStyles, /\.workflow-editor-panel \{ display: grid; grid-column: 2;/);
});

test("desktop workflow builder keeps the Canvas full-screen with movable side panels and top run controls", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const uploadSource = readFileSync(resolve(process.cwd(), "src/local-file-upload.ts"), "utf8");
  const desktopStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const modernSurface = appSource.match(/function DesktopWorkflowBuilderSurface[\s\S]*?function DesktopWorkflowWorkspace/)?.[0] ?? "";
  const canvasSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/workflow-canvas.tsx"), "utf8");
  const sharedStyleSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/styles.css"), "utf8");
  assert.match(appSource, /workflow-floating-panel-left/);
  assert.match(appSource, /workflow-floating-panel-right/);
  assert.match(appSource, /workflow-selected-node-summary/);
  assert.match(appSource, /workflow-info-fields/);
  assert.match(appSource, /workflowMetadata\.title/);
  assert.match(appSource, /workflowMetadata\.description/);
  assert.match(appSource, /workflowMetadata\.status/);
  assert.match(appSource, /consumePanelClick\(\)/);
  assert.match(appSource, /setPanelPosition\(\(current\) => \(\{ \.\.\.current, \[drag\.panel\]: \{ x: 12/);
  assert.match(appSource, /重新运行|Rerun/);
  assert.match(appSource, /继续运行|Continue/);
  assert.match(appSource, /selected\.path === "\/dashboard\/workflows"/);
  assert.doesNotMatch(modernSurface, /<ModelControls/);
  assert.doesNotMatch(modernSurface, /chat-runtime-badge/);
  assert.doesNotMatch(modernSurface, /OpenCode/);
  assert.match(modernSurface, /onConnect=\{props\.onConnect\}/);
  assert.match(modernSurface, /onUpdateNodeParameter=\{props\.onUpdateNodeConfig\}/);
  assert.match(modernSurface, /onUpdateNodeParameter=\{props\.onUpdateNodeConfig\}/);
  assert.match(appSource, /renderNodeEditor=\{onUpdateNodeParameter/);
  assert.match(appSource, /className="desktop-workflow-node-editor"/);
  assert.match(appSource, /DesktopWorkflowUploadEditor/);
  assert.match(appSource, /pick_workflow_files/);
  assert.match(appSource, /desktop_file_selection_unavailable/);
  assert.match(appSource, /仅记录本机地址，运行时按 Provider 上传/);
  assert.match(appSource, /isTauriBridgeAvailable/);
  assert.match(appSource, /onSelectWorkflowFiles/);
  assert.doesNotMatch(modernSurface, /persistLocalFile/);
  assert.match(appSource, /uploadedFiles: files/);
  assert.doesNotMatch(appSource, /FileReader/);
  assert.match(appSource, /const updateNodeConfig = \(nodeKey: string, key: string, value: WorkflowParameterValue\)/);
  assert.match(canvasSource, /event\.currentTarget\.setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(canvasSource, /startClientX/);
  assert.match(appSource, /localDefinitionRef/);
  assert.match(appSource, /normalizeWorkflowNodePositions/);
  assert.match(canvasSource, /dragPreview/);
  assert.match(appSource, /WORKFLOW_PALETTE_DRAG_EVENT/);
  assert.match(appSource, /WORKFLOW_PALETTE_DROP_EVENT/);
  assert.match(appSource, /suppressPaletteClickRef/);
  assert.match(appSource, /onPointerDown=\{\(event\) => startPaletteDrag\(event, item\.id\)\}/);
  assert.doesNotMatch(appSource, /onDragStart=\{\(event\) => startPaletteDrag\(event, item\.id\)\}/);
  assert.match(canvasSource, /shared-workflow-port/);
  assert.match(canvasSource, /data-node-no-drag/);
  assert.match(sharedStyleSource, /\.shared-workflow-port/);
  assert.match(appSource, /startPanelDrag\("left"/);
  assert.match(desktopStyles, /\.workspace\.workspace-workflow/);
  assert.match(desktopStyles, /\.workflow-canvas-shell/);
  assert.match(desktopStyles, /\.desktop-workflow-node-editor \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 8px 10px; max-height: none; overflow: visible/);
  assert.match(desktopStyles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(desktopStyles, /\[data-field-id="imageSize"\]/);
  assert.match(desktopStyles, /\.workflow-editor-field-toggle \.workflow-toggle-field \{ box-sizing: border-box; display: flex; width: 100%; min-height: 32px/);
  assert.match(desktopStyles, /\.workflow-floating-panel/);
  assert.match(desktopStyles, /\.workflow-floating-panel \{[^}]*max-height: calc\(100% - 92px\); flex-direction: column; overflow: hidden/);
  assert.match(desktopStyles, /\.workflow-floating-panel-left \.workflow-action-list \{[^}]*overflow-y: auto; overscroll-behavior: contain/);
  assert.match(desktopStyles, /\.workflow-floating-panel-tab[^\n]*cursor: grab/);
  assert.match(desktopStyles, /\.workflow-builder-toolbar p \{ display: none; \}/);
  assert.match(desktopStyles, /\.workflow-builder-toolbar \{[^}]*padding: 8px 16px 7px/);
  assert.match(desktopStyles, /\.workflow-canvas-shell > \.ai-elements-workflow-canvas \{ position: absolute; inset: 0; min-height: 0/);
  assert.doesNotMatch(appSource, /return <div className="workflow-workspace">/);
});

test("desktop workflow actions use the current canvas definition and do not require a global prompt", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const modernSurface = appSource.match(/function DesktopWorkflowBuilderSurface[\s\S]*?function DesktopWorkflowWorkspace/)?.[0] ?? "";
  assert.match(modernSurface, /onClick=\{\(\) => void props\.onSave\(localDefinition\)\}/);
  assert.match(modernSurface, /onClick=\{\(\) => void props\.onExport\(localDefinition\)\}/);
  assert.match(modernSurface, /disabled=\{Boolean\(props\.activeRunId\) \|\| issues\.length > 0\}/);
  assert.doesNotMatch(modernSurface, /!props\.prompt\.trim\(\)/);
  assert.match(appSource, /saveCurrentWorkflow\("manual", definition\)/);
  assert.match(appSource, /exportCurrentWorkflow\(definition\)/);
  assert.match(appSource, /currentWorkflowDefinition\(definitionOverride\)/);
  assert.match(appSource, /save_workflow_export/);
});

test("desktop workflows persist the edited Canvas and restore the exact task snapshot with node outputs", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.ok(appSource.includes("workflowRestoreRequestRef"));
  assert.ok(appSource.includes("workflowDefinition?: WorkflowDefinitionEnvelope"));
  assert.ok(appSource.includes("const workflowDefinitionSnapshot = isWorkflowRun"));
  assert.ok(appSource.includes("workflowDefinition: workflowDefinitionSnapshot"));
  assert.ok(appSource.includes("metadata?.workflowId"));
  assert.ok(appSource.includes("metadata?.workflowDefinition"));
  assert.ok(appSource.includes("const snapshotWorkflow = saved ??"));
  assert.ok(appSource.includes("openWorkflowCanvas(definition, snapshotWorkflow)"));
  assert.ok(appSource.includes("workflowTitle?: string"));
  assert.ok(appSource.includes("workflowTitle: savedWorkflowForRun.name"));
  assert.ok(appSource.includes("async function restoreLatestWorkflowRun"));
  assert.ok(appSource.includes("void restoreLatestWorkflowRun(workflow, definition)"));
  assert.ok(appSource.includes("function applyWorkflowRunDetail(detail: RunDetail)"));
  assert.ok(appSource.includes("const failureMessages = new Map<string, string>()"));
  assert.ok(appSource.includes("workflow:node_failed"));
  assert.ok(appSource.includes("{ error: payload.message }"));
  assert.ok(appSource.includes("const snapshots = detail.nodes.map"));
  assert.ok(appSource.includes("setTimeout(() => void workflowAutoSaveRef.current(\"auto\"), 700)"));
  const definitionStart = appSource.indexOf("function currentWorkflowDefinition");
  const definitionEnd = appSource.indexOf("  useEffect(() => {", definitionStart);
  const currentDefinition = appSource.slice(definitionStart, definitionEnd);
  assert.match(currentDefinition, /The canvas owns node configuration/u);
  assert.doesNotMatch(currentDefinition, /nodes: base\.nodes\.map/u);
});

test("desktop workflow editor keeps its draft out of the AI composer state", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const workflowSurface = appSource.match(/function DesktopWorkflowWorkspace[\s\S]*?function DesktopMediaWorkspaceBody/)?.[0] ?? "";
  assert.match(appSource, /const \[workflowPrompt, setWorkflowPrompt\] = useState\(""\)/);
  assert.match(appSource, /setWorkflowPrompt\(nextPrompt\)/);
  assert.match(appSource, /setWorkflowPrompt\(\"\"\)/);
  assert.match(workflowSurface, /workflowEditorPrompt/);
  assert.match(workflowSurface, /setWorkflowEditorPrompt\(value\)/);
  assert.doesNotMatch(workflowSurface, /onPromptChange\(value\)/);
  assert.match(appSource, /buildWorkflowDefinition\(workflowPrompt, workflowAction/);
});

test("desktop workflow runs do not claim an AI or Agent conversation run", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const runSource = appSource.match(/async function runAgent[\s\S]*?\n  async function cancelActiveRun/)?.[0] ?? "";
  assert.match(runSource, /const isWorkflowRun = launchSelectedPath === "\/dashboard\/workflows" \|\| isWorkflowDefinition\(workflowOverride\)/);
  assert.match(runSource, /if \(isWorkflowRun(?: && workflowKey)?\) \{/);
  assert.match(runSource, /else if \(runIsVisible\(\)\) setActiveRunId\(runId\)/);
  assert.match(runSource, /if \(!isWorkflowRun && conversationId\) updateVisibleConversationMessages/);
  assert.match(runSource, /if \(!isWorkflowRun && conversationId && runIsVisible\(\)\) setActiveConversationId/);
  assert.match(runSource, /setDomainStatus/);
  assert.match(runSource, /if \(isWorkflowRun\) \{[\s\S]*?setWorkflowRunStatus/);
  assert.match(appSource, /const runId = currentWorkflowRunId \?\? conversationRunId \?\? queryRunIsVisible \?\? visibleActiveRun/);
});

test("desktop workflow builder preserves workflow history and keeps local media interaction opt-in", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const canvasSource = readFileSync(resolve(process.cwd(), "../../packages/workbench-ui/src/workflow-canvas.tsx"), "utf8");
  assert.match(appSource, /historyRef = useRef<\{ past: WorkflowDefinitionEnvelope\[\]; future: WorkflowDefinitionEnvelope\[\] \}>/);
  assert.match(appSource, /historyRef\.current\.past = \[\.\.\.historyRef\.current\.past\.slice\(-49\), previous\]/);
  assert.match(appSource, /historyCoalesceRef\.current = historyKey \? \{ key: historyKey, until: now \+ 500 \}/);
  assert.match(appSource, /canUndo=\{historyState\.canUndo\}/);
  assert.match(appSource, /data-node-media="true"/);
  assert.doesNotMatch(appSource, /FileReader/);
  assert.match(canvasSource, /event\.key\.toLowerCase\(\) === "z"/);
  assert.match(canvasSource, /window\.requestAnimationFrame/);
  assert.match(canvasSource, /pendingDragPreviewRef/);
  assert.match(canvasSource, /mediaInteractionNodeKey/);
  assert.match(canvasSource, /data-node-media='true'/);
});

test("desktop WebView CSP permits only local Blob media previews", () => {
  const tauriConfig = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as { app: { security: { csp: string } } };
  const csp = tauriConfig.app.security.csp;
  assert.match(csp, /img-src 'self' blob:/);
  assert.match(csp, /media-src 'self' blob:/);
  assert.match(csp, /frame-src 'self' blob:/);
  assert.doesNotMatch(csp, /https:\/\//);
});

test("local qualified models keep their OpenCode provider prefix", () => {
  const hostSource = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  assert.match(hostSource, /providerId: providerKey\(slash > 0 \? configured\.slice\(0, slash\)/);
  assert.match(hostSource, /modelId: slash > 0 \? configured\.slice\(slash \+ 1\) : configured/);
});

test("desktop supervises a crashed workflow host before marking the active run interrupted", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const supervisorSource = readFileSync(resolve(process.cwd(), "src-tauri/src/supervisor.rs"), "utf8");
  assert.match(appSource, /payload\.raw\.includes\("workflow_host_exit"\)/);
  assert.match(appSource, /tauriBridge\.invoke\("host_start"\)/);
  assert.match(appSource, /status: "interrupted"/);
  assert.match(appSource, /本地 Agent 异常退出，当前请求未完成/);
  assert.match(appSource, /tauriBridge\.invoke\("append_message"/);
  assert.match(appSource, /status: "failed", message: detail/);
  assert.match(supervisorSource, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(supervisorSource, /SetInformationJobObject/);
});

test("workflow-host delegates RAG and Obsidian storage to the reverse-RPC knowledge service", () => {
  const hostSource = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  const serviceSource = readFileSync(resolve(process.cwd(), "runtime/knowledge-service.ts"), "utf8");
  const tauriHost = readFileSync(resolve(process.cwd(), "src-tauri/src/host.rs"), "utf8");
  assert.doesNotMatch(hostSource, /from ["']\.\/(?:rag|obsidian|lancedb)["']/);
  assert.match(hostSource, /requestService\("knowledge\.(?:index|search|write)"/);
  assert.match(hostSource, /rawRecord\?\.type === "service_response"/);
  assert.match(serviceSource, /buildLanceIndex/);
  assert.match(serviceSource, /writeObsidianNote/);
  assert.match(tauriHost, /dispatch_service_request/);
  assert.match(tauriHost, /knowledge_service_bundle_missing/);
});

test("media recovery persists the provider idempotency key and executor identity", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const hostSource = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  assert.match(hostSource, /executorId, nodeKey, idempotencyKey/);
  assert.match(appSource, /payload\.idempotencyKey/);
  assert.match(appSource, /payload\.executorId/);
  assert.match(appSource, /resumeExecutorId/);
});

test("media feature tabs keep the launcher and body selection synchronized", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const tabsSource = readFileSync(resolve(process.cwd(), "src/media-tabs.ts"), "utf8");
  assert.match(tabsSource, /function createDesktopMediaTab/u);
  assert.match(tabsSource, /function openDesktopMediaTab/u);
  assert.match(appSource, /const \[tabs, setTabs\] = useState<DesktopMediaTabState\[\]>/u);
  assert.match(appSource, /const openFeature = \(featureId: MediaFeatureId\)[\s\S]*?openDesktopMediaTab\(current, feature\)/u);
  assert.match(appSource, /onFeatureOpen=\{\(featureId\) => openFeature\(featureId as MediaFeatureId\)\}/u);
  assert.match(appSource, /mediaFeatureId=\{activeTab\.featureId\}[\s\S]*?tabState=\{activeTab\}[\s\S]*?showFeatureSelectors=\{false\}/u);
  assert.match(appSource, /workspaceRef\.current\?\.scrollIntoView/u);
});
