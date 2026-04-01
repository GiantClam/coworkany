import type { SkillStore } from '../storage/skillStore';
import { detectDependencyCycles, verifyAndDemotePlugins } from './pluginDependencyResolver';

type SkillPromptInput = {
    userMessage: string;
    explicitEnabledSkills?: string[];
    maxSkills?: number;
    isSkillAllowed?: (input: { skillId: string; isBuiltin?: boolean }) => boolean;
};

type SkillPromptOutput = {
    prompt?: string;
    enabledSkillIds: string[];
};

function normalizeSkillIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

export function buildSkillPromptFromStore(
    store: Pick<SkillStore, 'list' | 'findByTrigger' | 'get'>,
    input: SkillPromptInput,
): SkillPromptOutput {
    const triggered = store.findByTrigger(input.userMessage).map((skill) => skill.manifest.name);
    const explicit = normalizeSkillIds(input.explicitEnabledSkills);
    const selectedIds = Array.from(new Set([...explicit, ...triggered]));
    const maxSkills = typeof input.maxSkills === 'number' && input.maxSkills > 0
        ? Math.floor(input.maxSkills)
        : 6;
    const slicedIds = selectedIds.slice(0, maxSkills);
    const dependencyCheck = verifyAndDemotePlugins(
        store.list().map((skill) => ({
            id: skill.manifest.name,
            name: skill.manifest.name,
            enabled: skill.enabled,
            dependencies: skill.manifest.dependencies ?? [],
        })),
    );
    const cycles = detectDependencyCycles(
        store.list().map((skill) => ({
            id: skill.manifest.name,
            name: skill.manifest.name,
            enabled: skill.enabled,
            dependencies: skill.manifest.dependencies ?? [],
        })),
    );
    const blockedByCycle = new Set<string>(
        cycles.flatMap((cycle) => cycle.slice(0, -1)),
    );
    const resolved = slicedIds
        .map((skillId) => store.get(skillId))
        .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
        .filter((skill) => skill.enabled)
        .filter((skill) => !dependencyCheck.demoted.has(skill.manifest.name))
        .filter((skill) => !blockedByCycle.has(skill.manifest.name))
        .filter((skill) => {
            if (!input.isSkillAllowed) {
                return true;
            }
            return input.isSkillAllowed({
                skillId: skill.manifest.name,
                isBuiltin: skill.isBuiltin,
            });
        });

    if (resolved.length === 0) {
        return {
            enabledSkillIds: [],
        };
    }

    const lines = [
        '[Enabled Skills]',
        'When relevant, follow these skill constraints and execution preferences:',
        ...resolved.map((skill) => `- ${skill.manifest.name}: ${skill.manifest.description}`),
    ];

    return {
        prompt: lines.join('\n'),
        enabledSkillIds: resolved.map((skill) => skill.manifest.name),
    };
}
