export type ExecutionConversationReader = {
    buildConversationText: (taskId: string) => string;
    getLatestAssistantResponseText: (taskId: string) => string;
};

export class ExecutionSession {
    readonly taskId: string;
    private readonly conversationReader: ExecutionConversationReader;
    private readonly onArtifactsChanged?: (artifacts: Set<string>) => void;
    private knownArtifacts: Set<string>;

    constructor(input: {
        taskId: string;
        conversationReader: ExecutionConversationReader;
        initialArtifacts?: Iterable<string>;
        onArtifactsChanged?: (artifacts: Set<string>) => void;
    }) {
        this.taskId = input.taskId;
        this.conversationReader = input.conversationReader;
        this.onArtifactsChanged = input.onArtifactsChanged;
        this.knownArtifacts = new Set(input.initialArtifacts ?? []);
    }

    listKnownArtifacts(): string[] {
        return Array.from(this.knownArtifacts);
    }

    replaceKnownArtifacts(artifacts: Iterable<string>): void {
        this.knownArtifacts = new Set(artifacts);
        this.onArtifactsChanged?.(new Set(this.knownArtifacts));
    }

    mergeKnownArtifacts(artifacts: Iterable<string>): string[] {
        for (const artifact of artifacts) {
            this.knownArtifacts.add(artifact);
        }
        this.onArtifactsChanged?.(new Set(this.knownArtifacts));
        return this.listKnownArtifacts();
    }

    buildConversationText(): string {
        return this.conversationReader.buildConversationText(this.taskId);
    }

    getLatestAssistantResponseText(): string {
        return this.conversationReader.getLatestAssistantResponseText(this.taskId);
    }
}
