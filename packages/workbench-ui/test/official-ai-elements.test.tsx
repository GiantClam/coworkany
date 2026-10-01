import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Artifact, ArtifactAction, ArtifactActions, ArtifactContent, ArtifactDescription, ArtifactHeader, ArtifactTitle, Attachment, AttachmentInfo, AttachmentPreview, AttachmentRemove, Attachments, AudioPlayer, AudioPlayerControlBar, AudioPlayerElement, Branch, BranchMessages, BranchNext, BranchPrevious, Checkpoint, Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle, Context, ContextContent, ContextContentBody, ContextContentHeader, ContextInputUsage, ContextOutputUsage, ContextTrigger, Conversation, ConversationContent, Image, Message, MessageAction, MessageActions, MessageBranch, MessageBranchContent, MessageContent, MessageResponse, MessageToolbar, ModelSelector, ModelSelectorContent, ModelSelectorItem, ModelSelectorTrigger, Plan, PromptInput, PromptInputAction, PromptInputActions, PromptInputBody, PromptInputFooter, PromptInputProvider, PromptInputSubmit, PromptInputTextarea, PromptInputTools, Queue, QueueItem, QueueItemContent, QueueItemIndicator, QueueList, QueueSection, QueueSectionContent, QueueSectionLabel, QueueSectionTrigger, Reasoning, ReasoningContent, ReasoningTrigger, Suggestion, Suggestions, Sources, SourcesContent, SourcesTrigger, Source, Task, TaskContent, TaskItem, TaskTrigger, Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, usePromptInputController } from "../src/ai-elements/index";

function PromptInputControllerProbe() {
  const controller = usePromptInputController();
  return <output data-controller-value={controller.textInput.value}>{controller.attachments.files.length}</output>;
}

test("official PromptInput compound exposes the documented slots and submit semantics", () => {
  const markup = renderToStaticMarkup(<PromptInput value="hello" onValueChange={() => undefined} onSubmit={() => undefined} attachments={[{ id: "file-1", name: "brief.pdf", mediaType: "application/pdf" }]}><PromptInputBody><PromptInputTextarea placeholder="Ask anything" /></PromptInputBody><PromptInputFooter><PromptInputTools>Tools</PromptInputTools><PromptInputSubmit /></PromptInputFooter></PromptInput>);
  assert.match(markup, /data-slot="prompt-input"/);
  assert.match(markup, /data-slot="prompt-input-body"/);
  assert.match(markup, /data-slot="prompt-input-footer"/);
  assert.match(markup, /data-slot="prompt-input-tools"/);
  assert.match(markup, /aria-label="消息输入"/);
  assert.match(markup, /type="submit"/);
});

test("official PromptInput textarea exposes opt-in compact rows", () => {
  const markup = renderToStaticMarkup(<PromptInput value="hello" onValueChange={() => undefined} onSubmit={() => undefined}><PromptInputBody><PromptInputTextarea minRows={1} maxRows={3} submitMode="enter" /></PromptInputBody></PromptInput>);
  assert.match(markup, /rows="1"/);
  assert.match(markup, /data-slot="prompt-input-body"/);
});

test("official PromptInput provider exposes composable controller state", () => {
  const markup = renderToStaticMarkup(<PromptInputProvider initialInput="provider text"><PromptInputControllerProbe /><PromptInput onSubmit={() => undefined}><PromptInputBody><PromptInputTextarea name="message" /></PromptInputBody><PromptInputFooter><PromptInputSubmit /></PromptInputFooter></PromptInput></PromptInputProvider>);
  assert.match(markup, /data-controller-value="provider text"/);
  assert.match(markup, /value="provider text"/);
  assert.match(markup, /data-slot="prompt-input"/);
});

test("official ModelSelector delegates disclosure state to Radix Dialog", () => {
  const markup = renderToStaticMarkup(<ModelSelector defaultOpen><ModelSelectorTrigger asChild><button type="button" aria-label="Select model: GPT">GPT</button></ModelSelectorTrigger><ModelSelectorContent><ModelSelectorItem value="openai:gpt" data-selected="true">GPT</ModelSelectorItem></ModelSelectorContent></ModelSelector>);
  assert.match(markup, /aria-haspopup="dialog"/);
  assert.match(markup, /GPT/);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /data-state="open"/);
});

test("official conversation, reasoning, plan and tool preserve process semantics", () => {
  const markup = renderToStaticMarkup(<Conversation><ConversationContent><Message from="assistant"><MessageContent><Reasoning text="thinking" isStreaming /><Plan title="Plan" steps={[{ id: "step-1", title: "Research", status: "completed" }]} isStreaming /><Tool toolName="search" toolCallId="tool-1" input={{ query: "ai" }} status="waiting" /></MessageContent></Message></ConversationContent></Conversation>);
  assert.match(markup, /data-slot="conversation"/);
  assert.match(markup, /data-from="assistant"/);
  assert.match(markup, /正在思考|Reasoning/);
  assert.match(markup, /Plan/);
  assert.match(markup, /data-slot="plan"/);
  assert.match(markup, /data-slot="plan-trigger"/);
  assert.match(markup, /tool-1/);
  assert.match(markup, /data-status="waiting"/);
});

test("official sources, context, confirmation and attachments expose action semantics", () => {
  const markup = renderToStaticMarkup(<div><Attachments items={[{ id: "a", name: "image.png", mediaType: "image/png" }]} onRemove={() => undefined} /><Context maxTokens={1000} usedTokens={250} usage={{ inputTokens: 200, outputTokens: 50 }}><ContextContent><ContextContentHeader /><ContextContentBody><ContextInputUsage /><ContextOutputUsage /></ContextContentBody></ContextContent><ContextTrigger /></Context><Sources><Source title="Research" href="https://example.com" excerpt="Evidence" /></Sources><Confirmation state="approval-requested" approval={{ id: "approval-1" }}><ConfirmationTitle>Approval required</ConfirmationTitle><ConfirmationRequest><ConfirmationActions><ConfirmationAction onClick={() => undefined}>Reject</ConfirmationAction><ConfirmationAction onClick={() => undefined}>Approve</ConfirmationAction></ConfirmationActions></ConfirmationRequest></Confirmation></div>);
  assert.match(markup, /image\.png/);
  assert.match(markup, /25% used/);
  assert.match(markup, /Research/);
  assert.match(markup, /Approve/);
  assert.match(markup, /Reject/);
});

test("official artifact compound renders the final output container and actions", () => {
  const markup = renderToStaticMarkup(<Artifact><ArtifactHeader><div><ArtifactTitle>report.md</ArtifactTitle><ArtifactDescription>text/markdown</ArtifactDescription></div><ArtifactActions><ArtifactAction label="Download artifact" tooltip="Download">↓</ArtifactAction></ArtifactActions></ArtifactHeader><ArtifactContent>final output</ArtifactContent></Artifact>);
  assert.match(markup, /class="ai-elements-artifact/);
  assert.match(markup, /ai-elements-artifact-header/);
  assert.match(markup, /ai-elements-artifact-title/);
  assert.match(markup, /report\.md/);
  assert.match(markup, /text\/markdown/);
  assert.match(markup, /aria-label="Download artifact"/);
  assert.match(markup, /final output/);
});

test("official audio player exposes media-chrome composition slots", () => {
  const markup = renderToStaticMarkup(<AudioPlayer src="assets/audio.mp3"><AudioPlayerElement src="assets/audio.mp3" /><AudioPlayerControlBar>controls</AudioPlayerControlBar></AudioPlayer>);
  assert.match(markup, /data-slot="audio-player"/);
  assert.match(markup, /data-slot="audio-player-element"/);
  assert.match(markup, /data-slot="audio-player-control-bar"/);
});

test("official image, suggestion and queue compositions expose their native slots", () => {
  const markup = renderToStaticMarkup(<div><Image base64="aGVsbG8=" mediaType="image/png" alt="Generated" /><Suggestions aria-label="Quick prompts"><Suggestion suggestion="Try this" onClick={() => undefined} /></Suggestions><Queue><QueueSection><QueueSectionTrigger><QueueSectionLabel count={1} label="task" /></QueueSectionTrigger><QueueSectionContent><QueueList><QueueItem><QueueItemIndicator /><QueueItemContent>Generate output</QueueItemContent></QueueItem></QueueList></QueueSectionContent></QueueSection></Queue></div>);
  assert.match(markup, /data-slot="image"/);
  assert.match(markup, /src="data:image\/png;base64,aGVsbG8="/);
  assert.match(markup, /data-slot="suggestions"/);
  assert.match(markup, /data-slot="suggestion"/);
  assert.match(markup, /data-slot="queue"/);
  assert.match(markup, /data-slot="queue-section"/);
  assert.match(markup, /data-slot="queue-item-indicator"/);
  assert.match(markup, /Generate output/);
});

test("official prompt input exposes loading stop state and action slots", () => {
  const markup = renderToStaticMarkup(<PromptInput value="hello" onValueChange={() => undefined} onSubmit={() => undefined} isLoading onStop={() => undefined}><PromptInputBody><PromptInputTextarea /></PromptInputBody><PromptInputFooter><PromptInputActions><PromptInputAction tooltip="Add file">+</PromptInputAction></PromptInputActions><PromptInputSubmit /></PromptInputFooter></PromptInput>);
  assert.match(markup, /data-status="streaming"/);
  assert.match(markup, /停止生成/);
  assert.match(markup, /title="Add file"/);
});

test("official branch primitives preserve message navigation semantics", () => {
  const markup = renderToStaticMarkup(<Branch><BranchMessages><span>Page 1 of 2</span></BranchMessages><BranchPrevious /><BranchNext /></Branch>);
  assert.match(markup, /data-slot="branch"/);
  assert.match(markup, /data-slot="branch-messages"/);
  assert.match(markup, /上一页|Previous/);
  assert.match(markup, /下一页|Next/);
});

test("official checkpoint exposes a composable restore and branch surface", () => {
  const markup = renderToStaticMarkup(<Checkpoint title="Saved state" description="Before export" onRestore={() => undefined} onBranch={() => undefined} />);
  assert.match(markup, /data-slot="checkpoint"/);
  assert.match(markup, /data-slot="checkpoint-icon"/);
  assert.match(markup, /data-slot="checkpoint-trigger"/);
  assert.match(markup, /Saved state/);
  assert.match(markup, /Before export/);
});

test("official reasoning exposes trigger and content slots without changing disclosure state", () => {
  const markup = renderToStaticMarkup(<Reasoning status="running" isStreaming><ReasoningTrigger>Thinking</ReasoningTrigger><ReasoningContent>step one</ReasoningContent></Reasoning>);
  assert.match(markup, /data-status="running"/);
  assert.match(markup, /class="[^"]*ai-elements-reasoning-trigger/);
  assert.match(markup, /data-slot="reasoning-content"/);
  assert.match(markup, /Thinking/);
  assert.match(markup, /step one/);
});

test("process primitives use composable collapsible semantics", () => {
  const markup = renderToStaticMarkup(<div>
    <Reasoning defaultOpen={false} text="thinking" />
    <Task defaultOpen>
      <TaskTrigger title="Research" />
      <TaskContent><TaskItem>Find sources</TaskItem></TaskContent>
    </Task>
    <Tool defaultOpen>
      <ToolHeader type="dynamic-tool" toolName="search" state="output-available" />
      <ToolContent><ToolInput input={{ query: "ai" }} /><ToolOutput output="ok" /></ToolContent>
    </Tool>
  </div>);
  assert.doesNotMatch(markup, /<details/);
  assert.match(markup, /data-slot="task-trigger"/);
  assert.match(markup, /data-slot="task-content"/);
  assert.match(markup, /data-slot="task-item"|Find sources/);
  assert.match(markup, /data-slot="tool-header"[^>]*data-tool-name="search"/);
  assert.match(markup, /data-slot="tool-input"/);
  assert.match(markup, /data-slot="tool-output"/);
  assert.match(markup, /data-state="open"/);
});

test("tool defaults to a quiet collapsed header after completion", () => {
  const markup = renderToStaticMarkup(<Tool toolName="search" toolCallId="tool-quiet" output="ok" status="completed" locale="en" />);
  assert.match(markup, /<div(?=[^>]*data-slot="tool")(?=[^>]*data-state="closed")(?=[^>]*data-status="completed")[^>]*>/);
  assert.match(markup, /data-tool-name="search"/);
  assert.match(markup, /Completed/);
  assert.doesNotMatch(markup, /wb-ai-process-spinner/);
});

test("official chatbot message and source slots preserve disclosure semantics", () => {
  const markup = renderToStaticMarkup(<MessageBranch><MessageBranchContent><Message from="assistant"><MessageContent>Answer</MessageContent></Message></MessageBranchContent></MessageBranch>);
  assert.match(markup, /data-slot="message-branch-content"/);
  const sources = renderToStaticMarkup(<Sources><SourcesTrigger count={2} /><SourcesContent><Source title="Research" /></SourcesContent></Sources>);
  assert.match(sources, /Used 2 sources/);
  assert.match(sources, /data-state="closed"/);
  assert.match(sources, /data-slot="sources-trigger"/);
  assert.doesNotMatch(sources, />Research</);
});

test("official attachment compound shares item state through context", () => {
  const markup = renderToStaticMarkup(<Attachments variant="list"><Attachment data={{ id: "a", name: "image.png", mediaType: "image/png", uri: "asset://image.png" }} onRemove={() => undefined}><AttachmentPreview /><AttachmentInfo showMediaType /><AttachmentRemove /></Attachment></Attachments>);
  assert.match(markup, /data-slot="attachments"/);
  assert.match(markup, /data-slot="attachment"/);
  assert.match(markup, /data-slot="attachment-preview"/);
  assert.match(markup, /data-slot="attachment-info"/);
  assert.match(markup, /data-slot="attachment-remove"|Remove attachment/);
  assert.match(markup, /image\.png/);
});

test("official message toolbar and actions expose the interaction contract", () => {
  const markup = renderToStaticMarkup(<Message from="assistant"><MessageContent>Answer</MessageContent><MessageToolbar><MessageActions><MessageAction label="Copy response" /></MessageActions></MessageToolbar></Message>);
  assert.match(markup, /data-slot="message-toolbar"/);
  assert.match(markup, /data-slot="message-actions"/);
  assert.match(markup, /aria-label="Copy response"/);
  assert.match(markup, /title="Copy response"/);
});

test("message response keeps incomplete Markdown parsing configurable for streaming", () => {
  const markup = renderToStaticMarkup(<MessageResponse content="```ts\nconst answer = 1" streaming parseIncompleteMarkdown={false} />);
  assert.match(markup, /class="[^"]*ai-elements-message-response/);
});
