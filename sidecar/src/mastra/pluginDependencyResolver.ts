// Clean-room dependency resolver: pure functions, no I/O side effects.
// Supports dependency references with namespace/source prefixes and name aliases.

export type DependencyAwarePlugin = {
    id: string;
    name: string;
    enabled: boolean;
    dependencies?: string[];
};

export type DependencyError = {
    type: 'dependency-unsatisfied';
    source: string;
    plugin: string;
    dependency: string;
    reason: 'not-enabled' | 'not-found';
};

type DependencyResolverIndex = {
    pluginsByCanonicalId: Map<string, DependencyAwarePlugin>;
    aliasToCanonicalId: Map<string, string>;
};

function normalizeToken(value: string): string {
    return value.trim().toLowerCase();
}

function pushAlias(aliases: Set<string>, value: string): void {
    const normalized = normalizeToken(value);
    if (!normalized) {
        return;
    }
    aliases.add(normalized);
}

function buildAliasSet(value: string): Set<string> {
    const aliases = new Set<string>();
    const trimmed = value.trim();
    if (!trimmed) {
        return aliases;
    }
    pushAlias(aliases, trimmed);
    const noScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:/i, '');
    pushAlias(aliases, noScheme);
    const noFragment = noScheme.split('#', 1)[0] ?? noScheme;
    pushAlias(aliases, noFragment);
    const noQuery = noFragment.split('?', 1)[0] ?? noFragment;
    pushAlias(aliases, noQuery);

    const slashParts = noQuery.split('/').map((part) => part.trim()).filter(Boolean);
    if (slashParts.length > 0) {
        pushAlias(aliases, slashParts[slashParts.length - 1]!);
    }

    const atParts = noQuery.split('@').map((part) => part.trim()).filter(Boolean);
    if (atParts.length > 0) {
        pushAlias(aliases, atParts[0]!);
    }

    const colonParts = noQuery.split(':').map((part) => part.trim()).filter(Boolean);
    if (colonParts.length > 0) {
        pushAlias(aliases, colonParts[colonParts.length - 1]!);
    }

    return aliases;
}

function indexDependencyPlugins(plugins: readonly DependencyAwarePlugin[]): DependencyResolverIndex {
    const pluginsByCanonicalId = new Map<string, DependencyAwarePlugin>();
    const aliasToCanonicalId = new Map<string, string>();
    const duplicateAliases = new Set<string>();

    for (const plugin of plugins) {
        const idAliasSet = buildAliasSet(plugin.id);
        const nameAliasSet = buildAliasSet(plugin.name);
        const canonicalId = normalizeToken(plugin.id);
        if (!canonicalId) {
            continue;
        }
        pluginsByCanonicalId.set(canonicalId, plugin);
        const aliases = new Set<string>([...idAliasSet, ...nameAliasSet, canonicalId]);
        for (const alias of aliases) {
            const existing = aliasToCanonicalId.get(alias);
            if (!existing) {
                aliasToCanonicalId.set(alias, canonicalId);
                continue;
            }
            if (existing !== canonicalId) {
                duplicateAliases.add(alias);
            }
        }
    }

    for (const alias of duplicateAliases) {
        aliasToCanonicalId.delete(alias);
    }

    return {
        pluginsByCanonicalId,
        aliasToCanonicalId,
    };
}

function resolveDependencyCanonicalId(
    rawDependency: string,
    index: DependencyResolverIndex,
): string | null {
    const candidates = buildAliasSet(rawDependency);
    for (const candidate of candidates) {
        const hit = index.aliasToCanonicalId.get(candidate);
        if (hit) {
            return hit;
        }
    }
    return null;
}

function normalizeDependencyId(value: string): string {
    return value.trim();
}

export function detectDependencyCycles(
    plugins: readonly DependencyAwarePlugin[],
    rootId?: string,
): string[][] {
    const index = indexDependencyPlugins(plugins);
    const byId = index.pluginsByCanonicalId;
    const visited = new Set<string>();
    const active = new Set<string>();
    const stack: string[] = [];
    const dedup = new Set<string>();
    const cycles: string[][] = [];

    function pushCycle(cycle: string[]): void {
        const key = cycle.join('>');
        if (dedup.has(key)) {
            return;
        }
        dedup.add(key);
        cycles.push(cycle);
    }

    function dfs(pluginId: string): void {
        if (active.has(pluginId)) {
            const startIndex = stack.indexOf(pluginId);
            if (startIndex >= 0) {
                pushCycle([...stack.slice(startIndex), pluginId]);
            }
            return;
        }
        if (visited.has(pluginId)) {
            return;
        }
        visited.add(pluginId);
        active.add(pluginId);
        stack.push(pluginId);

        const plugin = byId.get(pluginId);
        const dependencies = Array.isArray(plugin?.dependencies) ? plugin.dependencies : [];
        for (const rawDep of dependencies) {
            const dep = resolveDependencyCanonicalId(normalizeDependencyId(rawDep), index);
            if (!dep || !byId.has(dep)) {
                continue;
            }
            dfs(dep);
        }

        stack.pop();
        active.delete(pluginId);
    }

    const resolvedRootId = typeof rootId === 'string'
        ? resolveDependencyCanonicalId(rootId, index)
        : null;
    if (resolvedRootId && byId.has(resolvedRootId)) {
        dfs(resolvedRootId);
        return cycles;
    }
    for (const canonicalId of byId.keys()) {
        dfs(canonicalId);
    }
    return cycles;
}

export function verifyAndDemotePlugins(plugins: readonly DependencyAwarePlugin[]): {
    demoted: Set<string>;
    errors: DependencyError[];
} {
    const index = indexDependencyPlugins(plugins);
    const known = new Set(index.pluginsByCanonicalId.keys());
    const enabled = new Set(
        plugins
            .filter((plugin) => plugin.enabled)
            .map((plugin) => normalizeToken(plugin.id))
            .filter(Boolean),
    );
    const errors: DependencyError[] = [];

    let changed = true;
    while (changed) {
        changed = false;
        for (const plugin of index.pluginsByCanonicalId.values()) {
            const canonicalPluginId = normalizeToken(plugin.id);
            if (!canonicalPluginId || !enabled.has(canonicalPluginId)) {
                continue;
            }
            const dependencies = Array.isArray(plugin.dependencies) ? plugin.dependencies : [];
            for (const rawDep of dependencies) {
                const dep = normalizeDependencyId(rawDep);
                if (!dep) {
                    continue;
                }
                const resolved = resolveDependencyCanonicalId(dep, index);
                const dependencyKnown = resolved ? known.has(resolved) : false;
                const dependencyEnabled = resolved ? enabled.has(resolved) : false;
                if (!dependencyEnabled) {
                    enabled.delete(canonicalPluginId);
                    errors.push({
                        type: 'dependency-unsatisfied',
                        source: plugin.id,
                        plugin: plugin.name,
                        dependency: dep,
                        reason: dependencyKnown ? 'not-enabled' : 'not-found',
                    });
                    changed = true;
                    break;
                }
            }
        }
    }

    const demoted = new Set<string>();
    for (const plugin of plugins) {
        const canonicalId = normalizeToken(plugin.id);
        if (plugin.enabled && canonicalId && !enabled.has(canonicalId)) {
            demoted.add(plugin.id);
        }
    }
    return { demoted, errors };
}

export function findReverseDependents(
    pluginId: string,
    plugins: readonly DependencyAwarePlugin[],
): string[] {
    const index = indexDependencyPlugins(plugins);
    const targetId = resolveDependencyCanonicalId(pluginId, index);
    if (!targetId) {
        return [];
    }
    return plugins
        .filter((plugin) =>
            plugin.enabled
            && normalizeToken(plugin.id) !== targetId
            && (plugin.dependencies ?? []).some((dependency) => (
                resolveDependencyCanonicalId(normalizeDependencyId(dependency), index) === targetId
            )),
        )
        .map((plugin) => plugin.name);
}
