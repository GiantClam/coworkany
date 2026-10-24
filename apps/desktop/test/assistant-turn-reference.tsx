import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopUIMessage, DesktopUIMessagePart } from "@coworkany/workbench-client";
import { Message, MessageContent, MessageResponse, MessageActions, MessageAction, MessageToolbar } from "../../../packages/workbench-ui/src/ai-elements/official/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../../../packages/workbench-ui/src/ai-elements/official/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../../../packages/workbench-ui/src/ai-elements/official/tool";
import { Conversation, ConversationContent, ConversationScrollButton } from "../../../packages/workbench-ui/src/ai-elements/official/conversation";
import { AcceptanceHarness } from "./assistant-turn-fixture";
import "../src/tailwind.css";
import "./assistant-turn-fixture.css";

type ToolPart = Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>;
function ReferenceTool({ part }: { part: ToolPart }) {
  const [manual, setManual] = useState<{ open: boolean; state: typeof part.state }>();
  const attention = part.state === "approval-requested" || part.state === "output-error";
  const running = part.state === "input-available" || part.state === "input-streaming" || part.state === "approval-responded";
  return <Tool open={(attention && manual?.state !== part.state) || (manual?.open ?? running)} onOpenChange={(open) => setManual({ open, state: part.state })} data-slot="tool">
    <ToolHeader type="dynamic-tool" toolName={part.toolName} state={part.state} data-slot="tool-header" />
    <ToolContent data-slot="tool-content"><ToolInput input={part.input} data-slot="tool-input" /><ToolOutput output={part.output} errorText={part.errorText} data-slot="tool-output" /></ToolContent>
  </Tool>;
}

function ReferenceMessage({ message, pending }: { message: DesktopUIMessage; pending: boolean }) {
  const last = message.parts.findLastIndex((part) => part.type === "text" || part.type === "reasoning" || part.type === "dynamic-tool");
  return <Message from={message.role === "user" ? "user" : "assistant"} data-slot="message" data-message-role={message.role} data-message-id={message.id}>
    <MessageContent data-slot="message-content">
      {message.parts.map((part, index) => {
        const key = part.type === "dynamic-tool" ? part.toolCallId : part.type === "text" || part.type === "reasoning" ? String(part.providerMetadata?.coworkany?.partId ?? `${part.type}:${index}`) : `${part.type}:${index}`;
        if (part.type === "reasoning") return <Reasoning key={key} isStreaming={pending && index === last} data-slot="reasoning"><ReasoningTrigger data-slot="reasoning-trigger" /><ReasoningContent data-slot="reasoning-content">{part.text}</ReasoningContent></Reasoning>;
        if (part.type === "dynamic-tool") return <ReferenceTool part={part} key={key} />;
        if (part.type === "text") return message.role === "user" ? <div key={key} data-slot="message-plain-text">{part.text}</div> : <MessageResponse key={key} className="reference-message-response" mode={pending && index === last ? "streaming" : "static"} isAnimating={pending && index === last}>{part.text}</MessageResponse>;
        // Artifacts are a documented Workbench extension, outside core comparison.
        return null;
      })}
    </MessageContent>
    <MessageToolbar data-slot="message-toolbar"><MessageActions data-slot="message-actions"><MessageAction label="Copy message" data-slot="message-action">⧉</MessageAction></MessageActions></MessageToolbar>
  </Message>;
}

function ReferenceSurface({ messages, pending }: { messages: DesktopUIMessage[]; pending?: string }) {
  return <Conversation className="acceptance-conversation" data-slot="conversation"><ConversationContent scrollClassName="ai-elements-conversation-viewport" data-slot="conversation-content">{messages.map((message) => <ReferenceMessage key={message.id} message={message} pending={message.id === pending} />)}</ConversationContent><ConversationScrollButton aria-label="Scroll to latest" data-slot="conversation-scroll-button" /></Conversation>;
}

createRoot(document.getElementById("root")!).render(<AcceptanceHarness view="official">{(messages, pending) => <ReferenceSurface messages={messages} pending={pending} />}</AcceptanceHarness>);
