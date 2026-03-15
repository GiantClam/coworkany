import { describe, expect, test } from 'bun:test';
import { checkSkillForUpdates } from '../src/skills/updater';
import { resolveSkillUpstream } from '../src/skills/upstreamCatalog';

describe('skill updater', () => {
    test('resolves curated upstream metadata for known skills', () => {
        expect(resolveSkillUpstream('skill-creator')).toEqual({
            name: 'skill-creator',
            repo: 'anthropics/skills',
            repoPath: 'skills/skill-creator',
            ref: 'main',
        });
    });

    test('marks builtin skills as not upgradeable', async () => {
        const update = await checkSkillForUpdates({
            manifest: {
                name: 'skill-creator',
                version: '1.0.0',
                description: 'builtin',
                directory: '/tmp/skill-creator',
            },
            enabled: true,
            installedAt: new Date().toISOString(),
            isBuiltin: true,
        });

        expect(update.supported).toBe(false);
        expect(update.hasUpdate).toBe(false);
        expect(update.error).toBe('builtin_skills_are_not_upgradeable');
    });

    test('marks unknown local skills as unsupported for one-click upgrades', async () => {
        const update = await checkSkillForUpdates({
            manifest: {
                name: 'custom-local-skill',
                version: '1.0.0',
                description: 'custom',
                directory: '/tmp/custom-local-skill',
            },
            enabled: true,
            installedAt: new Date().toISOString(),
        });

        expect(update.supported).toBe(false);
        expect(update.hasUpdate).toBe(false);
        expect(update.error).toBe('no_known_upstream');
    });
});
