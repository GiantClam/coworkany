type ProtocolCommandLike = {
    type?: string;
    [key: string]: unknown;
};

type OutgoingMessage = Record<string, unknown>;

type HandleLegacySimpleCommandInput = {
    command: ProtocolCommandLike;
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => Record<string, unknown>;
    emit: (message: OutgoingMessage) => void;
    getMastraHealth: () => {
        agents: string[];
        workflows: string[];
        storageConfigured: boolean;
        mastraPackages?: Record<string, string | null>;
    };
    handleUserMessage: (
        message: string,
        threadId: string,
        resourceId: string,
        sendToDesktop: (event: unknown) => void,
    ) => Promise<unknown>;
    handleApprovalResponse: (
        runId: string,
        toolCallId: string,
        approved: boolean,
        sendToDesktop: (event: unknown) => void,
    ) => Promise<unknown>;
};

export async function handleEntrypointLegacySimpleCommand(
    input: HandleLegacySimpleCommandInput,
): Promise<boolean> {
    const { command } = input;
    if (command.type === 'health_check') {
        input.emit({
            type: 'health',
            runtime: 'mastra',
            health: input.getMastraHealth(),
        });
        return true;
    }

    if (command.type === 'user_message') {
        const message = input.getString(command.message);
        const threadId = input.getString(command.threadId);
        const resourceId = input.getString(command.resourceId);
        if (!message || !threadId || !resourceId) {
            input.emit({ type: 'error', message: 'invalid_command' });
            return true;
        }

        await input.handleUserMessage(
            message,
            threadId,
            resourceId,
            (event) => input.emit(input.toRecord(event)),
        );
        return true;
    }

    if (command.type === 'approval_response') {
        const runId = input.getString(command.runId);
        const toolCallId = input.getString(command.toolCallId);
        const approved = command.approved;
        if (!runId || !toolCallId || typeof approved !== 'boolean') {
            input.emit({ type: 'error', message: 'invalid_command' });
            return true;
        }

        await input.handleApprovalResponse(
            runId,
            toolCallId,
            approved,
            (event) => input.emit(input.toRecord(event)),
        );
        return true;
    }

    return false;
}
