// Ported and adapted from claude-code/src/utils/plugins/dependencyResolver.ts.
// Keeps pure dependency checks separate from I/O and command handlers.

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

function normalizeDependencyId(value: string): string {
    return value.trim();
}

export function detectDependencyCycles(
    plugins: readonly DependencyAwarePlugin[],
    rootId?: string,
): string[][] {
    const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
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
            const dep = normalizeDependencyId(rawDep);
            if (!dep || !byId.has(dep)) {
                continue;
            }
            dfs(dep);
        }

        stack.pop();
        active.delete(pluginId);
    }

    if (rootId && byId.has(rootId)) {
        dfs(rootId);
        return cycles;
    }
    for (const plugin of plugins) {
        dfs(plugin.id);
    }
    return cycles;
}

export function verifyAndDemotePlugins(plugins: readonly DependencyAwarePlugin[]): {
    demoted: Set<string>;
    errors: DependencyError[];
} {
    const known = new Set(plugins.map((plugin) => plugin.id));
    const enabled = new Set(plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id));
    const errors: DependencyError[] = [];

    const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));

    let changed = true;
    while (changed) {
        changed = false;
        for (const plugin of plugins) {
            if (!enabled.has(plugin.id)) {
                continue;
            }
            const dependencies = Array.isArray(plugin.dependencies) ? plugin.dependencies : [];
            for (const rawDep of dependencies) {
                const dep = normalizeDependencyId(rawDep);
                if (!dep) {
                    continue;
                }
                if (!enabled.has(dep)) {
                    enabled.delete(plugin.id);
                    errors.push({
                        type: 'dependency-unsatisfied',
                        source: plugin.id,
                        plugin: plugin.name,
                        dependency: dep,
                        reason: known.has(dep) ? 'not-enabled' : 'not-found',
                    });
                    changed = true;
                    break;
                }
            }
        }
    }

    const demoted = new Set<string>();
    for (const plugin of plugins) {
        const original = byId.get(plugin.id);
        if (!original) {
            continue;
        }
        if (original.enabled && !enabled.has(plugin.id)) {
            demoted.add(plugin.id);
        }
    }
    return { demoted, errors };
}

export function findReverseDependents(
    pluginId: string,
    plugins: readonly DependencyAwarePlugin[],
): string[] {
    return plugins
        .filter((plugin) =>
            plugin.enabled
            && plugin.id !== pluginId
            && (plugin.dependencies ?? []).some((dependency) => normalizeDependencyId(dependency) === pluginId),
        )
        .map((plugin) => plugin.name);
}
