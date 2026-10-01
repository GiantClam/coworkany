import { useEffect, useMemo, useRef } from "react";
import { Chat, useChat } from "@ai-sdk/react";
import type { ChatTransport } from "ai";
import type { DesktopUIMessage } from "@coworkany/workbench-client";

export type DesktopChatHookOptions = {
  readonly chatId: string | null;
  readonly transport: ChatTransport<DesktopUIMessage>;
  readonly initialMessages?: readonly DesktopUIMessage[];
  readonly resume?: boolean;
  readonly onFinish?: (options: { readonly message: DesktopUIMessage; readonly isAbort: boolean; readonly isDisconnect: boolean; readonly isError: boolean }) => void | Promise<void>;
};

/** Keeps the AI SDK chat state stable while the desktop route changes around it. */
export function useDesktopChat({ chatId, transport, initialMessages = [], resume = true, onFinish }: DesktopChatHookOptions) {
  const resolvedChatId = useMemo(() => chatId ?? `desktop-draft-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`, [chatId]);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const initialRevision = useMemo(() => initialMessages.map((message) => `${message.id}:${message.metadata?.updatedAt ?? ""}:${message.parts.length}`).join("|"), [initialMessages]);
  const hydratedRevisionRef = useRef<string | null>(null);
  const chat = useMemo(() => new Chat<DesktopUIMessage>({
    id: resolvedChatId,
    transport,
    messages: [...initialMessages],
    onFinish: (options) => { void onFinishRef.current?.(options); },
    // A Chat instance owns all live updates for one conversation. Persisted
    // history is synchronized below without recreating that owner mid-stream.
  }), [resolvedChatId, transport]);
  const helpers = useChat<DesktopUIMessage>({ chat, resume: resume && Boolean(chatId) });

  useEffect(() => {
    const hydrationRevision = `${resolvedChatId}:${initialRevision}`;
    if (hydratedRevisionRef.current === hydrationRevision || helpers.status !== "ready") return;
    const incomingIds = new Set(initialMessages.map((message) => message.id));
    const hasUnpersistedLocalMessage = helpers.messages.some((message) => !incomingIds.has(message.id));
    if (hasUnpersistedLocalMessage) return;
    helpers.setMessages([...initialMessages]);
    hydratedRevisionRef.current = hydrationRevision;
  }, [helpers.messages, helpers.setMessages, helpers.status, initialMessages, initialRevision, resolvedChatId]);

  return { ...helpers, chatId: resolvedChatId };
}
