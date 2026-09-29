import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { resolve } from "node:path"

test("AI Entry routes through an injected NavigationAdapter with a Next fallback", () => {
  const source = readFileSync(resolve(process.cwd(), "components/ai-entry/ai-entry-workspace.tsx"), "utf8")

  assert.match(source, /navigation\?: NavigationAdapter/)
  assert.match(source, /client\?: Pick<WorkbenchClient, "conversations" \| "navigation">/)
  assert.match(source, /const workspaceNavigation = useMemo<NavigationAdapter>/)
  assert.match(source, /navigation \?\? client\?\.navigation \?\? \{/)
  assert.match(source, /go: \(href\) => router\.push\(href\)/)
  assert.match(source, /replace: \(href\) => router\.replace\(href\)/)
  assert.match(source, /workspaceNavigation\.replace\(/)
  assert.equal(source.match(/\brouter\.replace\(/g)?.length, 1)
  assert.match(source, /onClick=\{\(\) => workspaceNavigation\.go\(action\.href\)\}/)
  assert.doesNotMatch(source, /from "next\/link"/)
})

test("AI Entry delegates common cloud message geometry to the shared workbench UI", () => {
  const source = readFileSync(resolve(process.cwd(), "components/ai-entry/ai-entry-workspace.tsx"), "utf8")

  assert.match(source, /import \{ WorkbenchCloudMessageShell, WorkbenchMessageTimeline \} from "@coworkany\/workbench-ui"/)
  assert.match(source, /<WorkbenchMessageTimeline[\s\S]*locale=\{displayLocale\}/)
  assert.equal(source.match(/<WorkbenchCloudMessageShell/g)?.length, 2)
  assert.doesNotMatch(source, /<Message key=\{message\.id\}/)
})

test("AI Entry keeps assistant labels aligned with the active locale", () => {
  const source = readFileSync(resolve(process.cwd(), "components/ai-entry/ai-entry-workspace.tsx"), "utf8")

  assert.match(source, /label=\{isZh \? "AI 回复" : "AI RESPONSE"\}/)
  assert.equal(source.match(/aria-label=\{isZh \? "消息输入" : "Message input"\}/g)?.length, 2)
})

test("AI Entry can load portable conversation messages through an injected WorkbenchClient", () => {
  const source = readFileSync(resolve(process.cwd(), "components/ai-entry/ai-entry-workspace.tsx"), "utf8")

  assert.match(source, /const portableMessages = await client\.conversations\.messages\(targetConversationId\)/)
  assert.match(source, /response: \{ ok: true, status: 200 \}/)
  assert.match(source, /taskRuns: \[\]/)
})

test("AI Entry uses one compact AI Elements composer in both entry modes", () => {
  const source = readFileSync(resolve(process.cwd(), "components/ai-entry/ai-entry-workspace.tsx"), "utf8")

  assert.equal(source.match(/<PromptInput\b/g)?.length, 2)
  assert.equal(source.match(/<PromptInputTextarea[^>]*maxRows=\{3\}[^>]*submitMode="enter"/g)?.length, 2)
  assert.equal(source.match(/<WorkbenchModelReasoningSelector/g)?.length, 1)
  assert.match(source, /<PromptInputActionMenu\b/)
  assert.match(source, /PromptInputActionAddAttachments/)
  assert.match(source, /knowledgePickerOpen/)
  assert.match(source, /enterpriseKnowledge:/)
  assert.match(source, /modelConfig:/)
  assert.equal(source.match(/attachments=\{attachments\}/g)?.length, 2)
  assert.equal(source.match(/onRemoveAttachment=\{removeAttachment\}/g)?.length, 2)
  assert.doesNotMatch(source, /renderKnowledgeControl/)
  assert.match(source, /compact-ai-composer-row/)
  assert.doesNotMatch(source, /ref=\{fileInputRef\}/)
  assert.doesNotMatch(source, /<SelectTrigger/)
})
