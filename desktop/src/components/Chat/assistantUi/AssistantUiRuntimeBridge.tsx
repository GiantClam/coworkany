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

interface AssistantUiRuntimeBridgeProps {
    sessionId: string;
    rounds: TimelineTurnRound[];
    pendingLabel?: string;
    isRunning?: boolean;
    onSubmitText?: (text: string) => Promise<void> | void;
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
    isRunning = false,
    onSubmitText,
    children,
}) => {
    const externalMessages = React.useMemo(
        () => buildAssistantUiExternalMessages(rounds, { pendingLabel }),
        [pendingLabel, rounds],
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

    const runtime = useExternalStoreRuntime<AssistantUiExternalMessage>({
        isRunning,
        messages,
        setMessages,
        onNew,
        convertMessage: toAssistantUiThreadMessageLike,
    });

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            {children}
        </AssistantRuntimeProvider>
    );
};
