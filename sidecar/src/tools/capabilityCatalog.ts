import type { ToolEffect } from './standard';

export type CapabilityProvider = 'builtin' | 'mcp' | 'cli' | 'opencli';

export type CapabilityInteractionMode =
    | 'non_interactive'
    | 'tty_required'
    | 'gui_required'
    | 'browser_session';

export type CapabilityDescriptor = {
    capabilityId: string;
    provider: CapabilityProvider;
    toolName: string;
    sourceId?: string;
    description: string;
    effects: string[];
    inputSchema: Record<string, unknown>;
    semanticKey: string;
    interactionMode: CapabilityInteractionMode;
    requiresNetwork: boolean;
};

export type CapabilityConflictKind = 'duplicate' | 'overlap' | 'mutex' | 'replaceable';

export type CapabilityConflict = {
    kind: CapabilityConflictKind;
    toolNames: string[];
    providers: CapabilityProvider[];
    capabilityIds: string[];
    reason: string;
};

export function buildCapabilityDescriptor(input: {
    provider: CapabilityProvider;
    toolName: string;
    description?: string;
    effects?: Array<ToolEffect | string>;
    inputSchema?: Record<string, unknown>;
    sourceId?: string;
}): CapabilityDescriptor {
    const description = input.description ?? '';
    const effects = (input.effects ?? []).map((effect) => String(effect));
    const semanticKey = inferSemanticKey(input.toolName);
    const interactionMode = inferInteractionMode(input.toolName, description, effects);
    const requiresNetwork = effects.includes('network:outbound')
        || /\b(http|https|web|github|api|network)\b/i.test(description);

    return {
        capabilityId: buildCapabilityId(input.provider, input.toolName, input.sourceId),
        provider: input.provider,
        toolName: input.toolName,
        sourceId: input.sourceId,
        description,
        effects,
        inputSchema: input.inputSchema ?? {},
        semanticKey,
        interactionMode,
        requiresNetwork,
    };
}

export function detectCapabilityConflicts(descriptors: CapabilityDescriptor[]): CapabilityConflict[] {
    const conflicts: CapabilityConflict[] = [];

    const byName = groupBy(descriptors, (item) => item.toolName);
    for (const entries of byName.values()) {
        if (entries.length <= 1) {
            continue;
        }

        const providerSet = new Set(entries.map((entry) => entry.provider));
        if (providerSet.size <= 1) {
            continue;
        }

        conflicts.push({
            kind: 'duplicate',
            toolNames: unique(entries.map((entry) => entry.toolName)),
            providers: unique(entries.map((entry) => entry.provider)),
            capabilityIds: unique(entries.map((entry) => entry.capabilityId)),
            reason: `Multiple providers expose the same tool name "${entries[0]?.toolName ?? 'unknown'}".`,
        });

        conflicts.push({
            kind: 'replaceable',
            toolNames: unique(entries.map((entry) => entry.toolName)),
            providers: unique(entries.map((entry) => entry.provider)),
            capabilityIds: unique(entries.map((entry) => entry.capabilityId)),
            reason: `Tool "${entries[0]?.toolName ?? 'unknown'}" can be routed to different providers by policy.`,
        });
    }

    const bySemantic = groupBy(descriptors, (item) => item.semanticKey);
    for (const [semanticKey, entries] of bySemantic.entries()) {
        if (entries.length <= 1) {
            continue;
        }

        const toolNames = unique(entries.map((entry) => entry.toolName));
        const providers = unique(entries.map((entry) => entry.provider));
        if (toolNames.length <= 1 || providers.length <= 1) {
            continue;
        }

        conflicts.push({
            kind: 'overlap',
            toolNames,
            providers,
            capabilityIds: unique(entries.map((entry) => entry.capabilityId)),
            reason: `Semantic overlap detected for "${semanticKey}" across different tool names/providers.`,
        });

        const hasInteractive = entries.some((entry) => entry.interactionMode !== 'non_interactive');
        const hasNonInteractive = entries.some((entry) => entry.interactionMode === 'non_interactive');
        if (hasInteractive && hasNonInteractive) {
            conflicts.push({
                kind: 'mutex',
                toolNames,
                providers,
                capabilityIds: unique(entries.map((entry) => entry.capabilityId)),
                reason: `Interaction mode mismatch for "${semanticKey}" (interactive and non-interactive tools mixed).`,
            });
        }
    }

    return dedupeConflicts(conflicts);
}

function buildCapabilityId(provider: CapabilityProvider, toolName: string, sourceId?: string): string {
    const source = sourceId ? `${sanitizeId(sourceId)}:` : '';
    return `${provider}:${source}${sanitizeId(toolName)}`;
}

function sanitizeId(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '_');
}

function inferSemanticKey(toolName: string): string {
    const tokens = tokenize(toolName);
    const action = inferAction(tokens);
    const resource = inferResource(tokens);
    return `${action}.${resource}`;
}

function inferAction(tokens: string[]): string {
    const joined = tokens.join('_');
    if (/(^|_)(list|get|view|read|show|cat|fetch|inspect|check)(_|$)/.test(joined)) return 'read';
    if (/(^|_)(search|find|query|lookup)(_|$)/.test(joined)) return 'search';
    if (/(^|_)(create|new|add|install|init|setup)(_|$)/.test(joined)) return 'create';
    if (/(^|_)(update|edit|set|write|save|patch|configure)(_|$)/.test(joined)) return 'update';
    if (/(^|_)(delete|remove|rm|uninstall|drop|clean)(_|$)/.test(joined)) return 'delete';
    if (/(^|_)(run|exec|execute|spawn|start|open|launch)(_|$)/.test(joined)) return 'execute';
    return 'unknown';
}

function inferResource(tokens: string[]): string {
    const joined = tokens.join('_');
    if (/(^|_)(file|files|dir|directory|folder|path)(_|$)/.test(joined)) return 'filesystem';
    if (/(^|_)(repo|repository|git|github|pr|issue)(_|$)/.test(joined)) return 'repo';
    if (/(^|_)(email|mail|inbox)(_|$)/.test(joined)) return 'email';
    if (/(^|_)(calendar|schedule|event)(_|$)/.test(joined)) return 'calendar';
    if (/(^|_)(browser|web|url|crawl)(_|$)/.test(joined)) return 'web';
    if (/(^|_)(db|database|sql|query)(_|$)/.test(joined)) return 'database';
    if (/(^|_)(workspace|project)(_|$)/.test(joined)) return 'workspace';
    if (/(^|_)(config|setting|policy)(_|$)/.test(joined)) return 'config';
    if (/(^|_)(skill|toolpack|mcp|capability)(_|$)/.test(joined)) return 'extension';
    if (/(^|_)(command|shell|process|terminal)(_|$)/.test(joined)) return 'process';
    return 'general';
}

function inferInteractionMode(
    toolName: string,
    description: string,
    effects: string[],
): CapabilityInteractionMode {
    const name = toolName.toLowerCase();
    const text = `${toolName} ${description}`.toLowerCase();

    if (/\b(browser|navigate|click|type|screenshot)\b/.test(name)) {
        return 'browser_session';
    }

    if (/\b(tty|interactive|sudo|password|manual login|2fa|prompt)\b/.test(text)) {
        return 'tty_required';
    }

    if (/\b(gui|window|dialog|desktop app|osascript)\b/.test(text)) {
        return 'gui_required';
    }

    if (effects.includes('process:spawn') && /\b(command|shell|terminal|run)\b/.test(name)) {
        return 'tty_required';
    }

    return 'non_interactive';
}

function tokenize(value: string): string[] {
    return value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter(Boolean);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
        const key = keyFn(item);
        const bucket = grouped.get(key) ?? [];
        bucket.push(item);
        grouped.set(key, bucket);
    }
    return grouped;
}

function unique<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}

function dedupeConflicts(conflicts: CapabilityConflict[]): CapabilityConflict[] {
    const map = new Map<string, CapabilityConflict>();

    for (const conflict of conflicts) {
        const key = `${conflict.kind}:${conflict.toolNames.slice().sort().join(',')}:${conflict.providers.slice().sort().join(',')}:${conflict.reason}`;
        if (!map.has(key)) {
            map.set(key, conflict);
        }
    }

    return Array.from(map.values());
}
