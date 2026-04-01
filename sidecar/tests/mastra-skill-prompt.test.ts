import { describe, expect, test } from 'bun:test';
import { buildSkillPromptFromStore } from '../src/mastra/skillPrompt';

describe('skill prompt resolver', () => {
    test('merges explicit and trigger-matched skills into a prompt block', () => {
        const output = buildSkillPromptFromStore({
            list: () => [
                {
                    manifest: {
                        name: 'release-checker',
                        dependencies: [],
                    },
                    enabled: true,
                },
                {
                    manifest: {
                        name: 'artifact-verifier',
                        dependencies: [],
                    },
                    enabled: true,
                },
            ] as any,
            findByTrigger: () => [
                {
                    manifest: {
                        name: 'release-checker',
                        description: 'Validate release readiness gates',
                    },
                    enabled: true,
                },
            ] as any,
            get: (skillId: string) => {
                const registry: Record<string, { manifest: { name: string; description: string }; enabled: boolean }> = {
                    'release-checker': {
                        manifest: {
                            name: 'release-checker',
                            description: 'Validate release readiness gates',
                        },
                        enabled: true,
                    },
                    'artifact-verifier': {
                        manifest: {
                            name: 'artifact-verifier',
                            description: 'Verify artifacts and output contracts',
                        },
                        enabled: true,
                    },
                };
                return registry[skillId] as any;
            },
        } as any, {
            userMessage: 'run release checks and verify outputs',
            explicitEnabledSkills: ['artifact-verifier'],
        });

        expect(output.enabledSkillIds).toEqual(['artifact-verifier', 'release-checker']);
        expect(output.prompt).toContain('[Enabled Skills]');
        expect(output.prompt).toContain('artifact-verifier');
        expect(output.prompt).toContain('release-checker');
    });

    test('drops skills that fail dependency checks or policy checks', () => {
        const output = buildSkillPromptFromStore({
            list: () => [
                {
                    manifest: {
                        name: 'dependent-skill',
                        dependencies: ['missing-skill'],
                    },
                    enabled: true,
                },
                {
                    manifest: {
                        name: 'blocked-skill',
                        dependencies: [],
                    },
                    enabled: true,
                },
                {
                    manifest: {
                        name: 'healthy-skill',
                        dependencies: [],
                    },
                    enabled: true,
                },
            ] as any,
            findByTrigger: () => [] as any,
            get: (skillId: string) => {
                const registry: Record<string, { manifest: { name: string; description: string }; enabled: boolean }> = {
                    'dependent-skill': {
                        manifest: {
                            name: 'dependent-skill',
                            description: 'has missing dependency',
                        },
                        enabled: true,
                    },
                    'blocked-skill': {
                        manifest: {
                            name: 'blocked-skill',
                            description: 'blocked by policy',
                        },
                        enabled: true,
                    },
                    'healthy-skill': {
                        manifest: {
                            name: 'healthy-skill',
                            description: 'safe and available',
                        },
                        enabled: true,
                    },
                };
                return registry[skillId] as any;
            },
        } as any, {
            userMessage: 'run all checks',
            explicitEnabledSkills: ['dependent-skill', 'blocked-skill', 'healthy-skill'],
            isSkillAllowed: ({ skillId }) => skillId !== 'blocked-skill',
        });

        expect(output.enabledSkillIds).toEqual(['healthy-skill']);
        expect(output.prompt).toContain('healthy-skill');
        expect(output.prompt).not.toContain('dependent-skill');
        expect(output.prompt).not.toContain('blocked-skill');
    });

    test('drops skills participating in dependency cycles', () => {
        const output = buildSkillPromptFromStore({
            list: () => [
                {
                    manifest: {
                        name: 'cycle-a',
                        dependencies: ['cycle-b'],
                    },
                    enabled: true,
                },
                {
                    manifest: {
                        name: 'cycle-b',
                        dependencies: ['cycle-a'],
                    },
                    enabled: true,
                },
                {
                    manifest: {
                        name: 'healthy-skill',
                        dependencies: [],
                    },
                    enabled: true,
                },
            ] as any,
            findByTrigger: () => [] as any,
            get: (skillId: string) => {
                const registry: Record<string, { manifest: { name: string; description: string }; enabled: boolean }> = {
                    'cycle-a': {
                        manifest: {
                            name: 'cycle-a',
                            description: 'cycle a',
                        },
                        enabled: true,
                    },
                    'cycle-b': {
                        manifest: {
                            name: 'cycle-b',
                            description: 'cycle b',
                        },
                        enabled: true,
                    },
                    'healthy-skill': {
                        manifest: {
                            name: 'healthy-skill',
                            description: 'healthy',
                        },
                        enabled: true,
                    },
                };
                return registry[skillId] as any;
            },
        } as any, {
            userMessage: 'run checks',
            explicitEnabledSkills: ['cycle-a', 'cycle-b', 'healthy-skill'],
        });

        expect(output.enabledSkillIds).toEqual(['healthy-skill']);
        expect(output.prompt).toContain('healthy-skill');
        expect(output.prompt).not.toContain('cycle-a');
        expect(output.prompt).not.toContain('cycle-b');
    });
});
