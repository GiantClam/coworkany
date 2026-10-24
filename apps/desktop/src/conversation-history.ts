import { desktopUIMessageText, type DesktopUIMessage, type DesktopUIMessagePart } from "@coworkany/workbench-client";

type ConversationMessage = {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAt: string;
  readonly role?: string;
};

function messageTurnId(message: { readonly id?: string; readonly role?: string }) {
  const prefix = message.role === "user" ? "message-" : message.role === "assistant" ? "assistant-" : "";
  return prefix && message.id?.startsWith(prefix) ? message.id.slice(prefix.length) : undefined;
}

function compareMessageOrder(
  left: { readonly id?: string; readonly createdAt?: string; readonly role?: string; readonly index: number },
  right: { readonly id?: string; readonly createdAt?: string; readonly role?: string; readonly index: number },
) {
  const leftTime = Date.parse(left.createdAt ?? "");
  const rightTime = Date.parse(right.createdAt ?? "");
  const leftHasTime = !Number.isNaN(leftTime);
  const rightHasTime = !Number.isNaN(rightTime);

  if (leftHasTime && rightHasTime && leftTime !== rightTime) return leftTime - rightTime;
  if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;

  // A restored assistant answer and its optimistic user request may share the
  // storage timestamp while coming from different sources.  The run-derived
  // IDs are the causal link that survives a session switch, so only use them
  // to repair that exact pair; keep unrelated same-timestamp turns stable.
  const leftTurnId = messageTurnId(left);
  const rightTurnId = messageTurnId(right);
  if (leftTurnId && leftTurnId === rightTurnId && left.role !== right.role) {
    return left.role === "user" ? -1 : 1;
  }

  return left.index - right.index;
}

function repairAdjacentTimestampInversions<TMessage extends ConversationMessage>(messages: TMessage[]) {
  const repaired = [...messages];
  for (let index = 1; index < repaired.length; index += 1) {
    const previous = repaired[index - 1];
    const current = repaired[index];
    if (previous.role !== "assistant" || current.role !== "user") continue;
    const previousTime = Date.parse(previous.createdAt);
    const currentTime = Date.parse(current.createdAt);
    if (previousTime !== currentTime) continue;
    const beforePreviousTime = index > 1 ? Date.parse(repaired[index - 2].createdAt) : Number.NaN;
    if (beforePreviousTime === previousTime) continue;
    repaired[index - 1] = current;
    repaired[index] = previous;
  }
  return repaired;
}

export function mergeConversationMessages<TMessage extends ConversationMessage>(
  current: readonly TMessage[],
  loaded: readonly TMessage[],
  conversationId: string,
): TMessage[] {
  const loadedForConversation = loaded.filter((message) => message.conversationId === conversationId);
  const loadedIds = new Set(loadedForConversation.map((message) => message.id));
  // The newly loaded page carries the database's authoritative insertion
  // order. Keep only current messages that have not reached storage yet (for
  // example an optimistic user turn) before sorting the combined transcript.
  const optimistic = current.filter((message) => message.conversationId === conversationId && !loadedIds.has(message.id));
  const ordered = [...loadedForConversation, ...optimistic]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => compareMessageOrder({ id: left.message.id, createdAt: left.message.createdAt, role: left.message.role, index: left.index }, { id: right.message.id, createdAt: right.message.createdAt, role: right.message.role, index: right.index }))
    .map(({ message }) => message);
  return repairAdjacentTimestampInversions(ordered);
}

function stablePartIdentity(part: DesktopUIMessagePart, occurrence: number) {
  if (part.type === "text" || part.type === "reasoning") {
    const metadata = part.providerMetadata?.coworkany as { partId?: unknown } | undefined;
    if (typeof metadata?.partId === "string") return metadata.partId;
  }
  if (part.type === "dynamic-tool") return `tool:${part.toolCallId}`;
  if ("id" in part && typeof part.id === "string") return `${part.type}:${part.id}`;
  if (part.type === "source-url") return `source-url:${part.sourceId}:${part.url}`;
  if (part.type === "source-document") return `source-document:${part.sourceId}`;
  if (part.type === "file") return `file:${part.url}:${part.filename ?? ""}`;
  return `${part.type}:legacy:${occurrence}`;
}

function indexedParts(parts: readonly DesktopUIMessagePart[]) {
  const occurrences = new Map<string, number>();
  return parts.map((part) => {
    const occurrence = occurrences.get(part.type) ?? 0;
    occurrences.set(part.type, occurrence + 1);
    return { part, identity: stablePartIdentity(part, occurrence) };
  });
}

function mergeMessageParts(displayed: readonly DesktopUIMessagePart[], live: readonly DesktopUIMessagePart[]) {
  const liveEntries = indexedParts(live);
  const liveByIdentity = new Map(liveEntries.map((entry) => [entry.identity, entry.part]));
  const consumed = new Set<string>();
  const merged = indexedParts(displayed).map(({ part, identity }) => {
    const incoming = liveByIdentity.get(identity);
    if (!incoming) return part;
    consumed.add(identity);
    if ((part.type === "text" || part.type === "reasoning") && incoming.type === part.type && !incoming.text && part.text) return part;
    return incoming;
  });
  for (const { part, identity } of liveEntries) {
    if (consumed.has(identity)) continue;
    if ((part.type === "text" || part.type === "reasoning") && !part.text) continue;
    merged.push(part);
  }
  return merged;
}

function mergeMessageView(displayed: DesktopUIMessage, live: DesktopUIMessage, preserveId = displayed.id) {
  const metadata = {
    ...displayed.metadata,
    ...live.metadata,
    conversationId: live.metadata?.conversationId ?? displayed.metadata?.conversationId ?? "",
    createdAt: live.metadata?.createdAt ?? displayed.metadata?.createdAt ?? new Date(0).toISOString(),
    updatedAt: live.metadata?.updatedAt ?? displayed.metadata?.updatedAt ?? new Date(0).toISOString(),
  };
  return {
    ...displayed,
    ...live,
    id: preserveId,
    parts: mergeMessageParts(displayed.parts, live.parts),
    metadata,
  };
}

function repairAdjacentUIMessageTimestampInversions(messages: readonly DesktopUIMessage[]) {
  const repaired = [...messages];
  for (let index = 1; index < repaired.length; index += 1) {
    const previous = repaired[index - 1];
    const current = repaired[index];
    if (previous.role !== "assistant" || current.role !== "user") continue;
    const previousTime = Date.parse(previous.metadata?.createdAt ?? "");
    const currentTime = Date.parse(current.metadata?.createdAt ?? "");
    if (previousTime !== currentTime) continue;
    const beforePreviousTime = index > 1 ? Date.parse(repaired[index - 2].metadata?.createdAt ?? "") : Number.NaN;
    if (beforePreviousTime === previousTime) continue;
    repaired[index - 1] = current;
    repaired[index] = previous;
  }
  return repaired;
}

export function mergeDesktopUIMessageViews(
  displayed: readonly DesktopUIMessage[],
  live: readonly DesktopUIMessage[],
  activeAssistantMessageId = "active-assistant",
): DesktopUIMessage[] {
  const liveById = new Map(live.map((message) => [message.id, message]));
  const displayedIds = new Set(displayed.map((message) => message.id));
  const activeAssistant = displayed.find((message) => message.id === activeAssistantMessageId && message.role === "assistant");
  const liveAssistant = activeAssistant ? live.find((message) => message.role === "assistant" && !displayedIds.has(message.id)) : undefined;
  const liveAssistantId = liveAssistant?.id;
  const merged = displayed.map((message) => {
    if (message === activeAssistant && liveAssistant) return mergeMessageView(message, liveAssistant);
    const liveMessage = liveById.get(message.id);
    if (!liveMessage) return message;
    return mergeMessageView(message, liveMessage);
  });
  const appendedLive = live.filter((message) => message.id !== liveAssistantId && !displayedIds.has(message.id) && hasRenderableLiveMessage(message));
  const ordered = [...merged, ...appendedLive]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => compareMessageOrder({ id: left.message.id, createdAt: left.message.metadata?.createdAt, role: left.message.role, index: left.index }, { id: right.message.id, createdAt: right.message.metadata?.createdAt, role: right.message.role, index: right.index }))
    .map(({ message }) => message);
  return repairAdjacentUIMessageTimestampInversions(ordered);
}

function hasRenderableLiveMessage(message: DesktopUIMessage) {
  if (message.role !== "user") return true;
  if (desktopUIMessageText(message).trim()) return true;
  return message.parts.some((part) => part.type === "file" || part.type === "data-attachment");
}
