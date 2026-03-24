import type { FrozenWorkRequestSnapshot, SupersededContractTombstone } from '../orchestration/workRequestSnapshot';
import type {
    MemoryIsolationPolicy,
    RuntimeIsolationPolicy,
    SessionIsolationPolicy,
    TenantIsolationPolicy,
} from '../orchestration/workRequestSchema';

export type TaskSessionConfig = {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    disabledTools?: string[];
    duplicateResolution?: 'prefer_mcp' | 'prefer_builtin' | 'prefer_opencli' | 'skip_conflicts';
    overlapResolution?: 'keep_all' | 'prefer_mcp' | 'prefer_builtin' | 'prefer_opencli' | 'prefer_non_interactive' | 'skip_overlaps';
    workspacePath?: string;
    voiceProviderMode?: 'auto' | 'system' | 'custom';
    lastFrozenWorkRequestSnapshot?: FrozenWorkRequestSnapshot;
    supersededContractTombstones?: SupersededContractTombstone[];
    runtimeIsolationPolicy?: RuntimeIsolationPolicy;
    sessionIsolationPolicy?: SessionIsolationPolicy;
    memoryIsolationPolicy?: MemoryIsolationPolicy;
    tenantIsolationPolicy?: TenantIsolationPolicy;
};

export type TaskResumeMessage = {
    content: string;
    config?: TaskSessionConfig;
};

type TaskSessionState<TMessage, TArtifactContract> = {
    conversation: TMessage[];
    config?: TaskSessionConfig;
    historyLimit: number;
    resumeMessages: TaskResumeMessage[];
    artifactContract?: TArtifactContract;
    artifactsCreated: Set<string>;
};

export class TaskSessionStore<TMessage, TArtifactContract = unknown> {
    private readonly sessions = new Map<string, TaskSessionState<TMessage, TArtifactContract>>();
    private readonly getDefaultHistoryLimit: () => number;

    constructor(input: { getDefaultHistoryLimit: () => number }) {
        this.getDefaultHistoryLimit = input.getDefaultHistoryLimit;
    }

    ensure(taskId: string): TaskSessionState<TMessage, TArtifactContract> {
        const existing = this.sessions.get(taskId);
        if (existing) return existing;

        const created: TaskSessionState<TMessage, TArtifactContract> = {
            conversation: [],
            historyLimit: this.getDefaultHistoryLimit(),
            resumeMessages: [],
            artifactsCreated: new Set<string>(),
        };
        this.sessions.set(taskId, created);
        return created;
    }

    getConversation(taskId: string): TMessage[] {
        return this.ensure(taskId).conversation;
    }

    replaceConversation(taskId: string, conversation: TMessage[]): TMessage[] {
        const session = this.ensure(taskId);
        session.conversation = conversation;
        return session.conversation;
    }

    getConfig(taskId: string): TaskSessionConfig | undefined {
        return this.sessions.get(taskId)?.config;
    }

    setConfig(taskId: string, config: TaskSessionConfig | undefined): TaskSessionConfig | undefined {
        const session = this.ensure(taskId);
        session.config = config;
        return session.config;
    }

    mergeConfig(taskId: string, patch: TaskSessionConfig): TaskSessionConfig {
        const session = this.ensure(taskId);
        session.config = {
            ...(session.config ?? {}),
            ...patch,
        };
        return session.config;
    }

    getHistoryLimit(taskId: string): number {
        return this.ensure(taskId).historyLimit;
    }

    setHistoryLimit(taskId: string, limit: number): number {
        const session = this.ensure(taskId);
        session.historyLimit = limit;
        return session.historyLimit;
    }

    ensureHistoryLimit(taskId: string): number {
        return this.ensure(taskId).historyLimit;
    }

    clearConversation(taskId: string): TMessage[] {
        return this.replaceConversation(taskId, []);
    }

    getArtifactContract(taskId: string): TArtifactContract | undefined {
        return this.sessions.get(taskId)?.artifactContract;
    }

    setArtifactContract(taskId: string, contract: TArtifactContract): TArtifactContract {
        const session = this.ensure(taskId);
        session.artifactContract = contract;
        return contract;
    }

    getArtifacts(taskId: string): Set<string> {
        return new Set(this.ensure(taskId).artifactsCreated);
    }

    setArtifacts(taskId: string, artifacts: Iterable<string>): Set<string> {
        const session = this.ensure(taskId);
        session.artifactsCreated = new Set(artifacts);
        return new Set(session.artifactsCreated);
    }

    enqueueResumeMessage(taskId: string, message: TaskResumeMessage): number {
        const session = this.ensure(taskId);
        session.resumeMessages.push(message);
        return session.resumeMessages.length;
    }

    dequeueResumeMessages(taskId: string): TaskResumeMessage[] {
        const session = this.ensure(taskId);
        const queued = [...session.resumeMessages];
        session.resumeMessages = [];
        return queued;
    }
}
