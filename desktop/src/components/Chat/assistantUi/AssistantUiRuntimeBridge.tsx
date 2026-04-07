import React from 'react';
import {
    AssistantRuntimeProvider,
    useExternalStoreRuntime,
    type AppendMessage,
} from '@assistant-ui/react';
import type { TimelineTurnRound } from '../Timeline/viewModels/turnRounds';
import {
    type AssistantUiExternalMessage,
    buildAssistantUiExternalMessages,
    toAssistantUiThreadMessageLike,
} from './messageAdapter';
import type { PendingTaskStatus } from '../Timeline/pendingTaskStatus';

interface AssistantUiRuntimeBridgeProps {
    sessionId: string;
    rounds: TimelineTurnRound[];
    pendingLabel?: string;
    pendingStatus?: PendingTaskStatus | null;
    isRunning?: boolean;
    onSubmitText?: (text: string) => Promise<void> | void;
    onReloadMessage?: (parentId: string | null) => Promise<void> | void;
    children: React.ReactNode;
}

function extractAppendText(message: AppendMessage): string {
    return message.content
        .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .filter((part) => part.trim().length > 0)
        .join('\n\n')
        .trim();
}

export const AssistantUiRuntimeBridge: React.FC<AssistantUiRuntimeBridgeProps> = ({
    sessionId,
    rounds,
    pendingLabel,
    pendingStatus = null,
    isRunning = false,
    onSubmitText,
    onReloadMessage,
    children,
}) => {
    const externalMessages = React.useMemo(
        () => buildAssistantUiExternalMessages(rounds, { pendingLabel, pendingStatus }),
        [pendingLabel, pendingStatus, rounds],
    );
    const [messages, setMessages] = React.useState<readonly AssistantUiExternalMessage[]>(externalMessages);

    React.useEffect(() => {
        setMessages(externalMessages);
    }, [externalMessages, sessionId]);

    const onNew = React.useCallback(async (appendMessage: AppendMessage): Promise<void> => {
        const content = extractAppendText(appendMessage);
        if (!content || !onSubmitText) {
            return;
        }
        await onSubmitText(content);
    }, [onSubmitText]);

    const onReload = React.useCallback(async (parentId: string | null): Promise<void> => {
        if (onReloadMessage) {
            await onReloadMessage(parentId);
            return;
        }

        if (!onSubmitText) {
            return;
        }

        const parentMessage = parentId
            ? messages.find((message) => message.id === parentId && message.role === 'user')
            : undefined;
        const fallbackUserMessage = [...messages]
            .reverse()
            .find((message) => message.role === 'user' && message.text.trim().length > 0);
        const content = (parentMessage?.text || fallbackUserMessage?.text || '').trim();
        if (!content) {
            return;
        }
        await onSubmitText(content);
    }, [messages, onReloadMessage, onSubmitText]);

    const runtime = useExternalStoreRuntime<AssistantUiExternalMessage>({
        isRunning,
        messages,
        setMessages,
        onNew,
        onReload,
        convertMessage: toAssistantUiThreadMessageLike,
    });

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            {children}
        </AssistantRuntimeProvider>
    );
};
