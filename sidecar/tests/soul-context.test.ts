import { describe, expect, test } from 'bun:test';
import {
    buildCurrentSessionSection,
    formatSoulSection,
    type SoulProfile,
} from '../src/promptContext/profile';

describe('soul prompt context', () => {
    test('formats soul profile into explicit prompt sections', () => {
        const profile: SoulProfile = {
            version: 1,
            identity: 'Act as a rigorous execution partner.',
            stablePreferences: ['Prefer concise answers', 'Use Chinese by default'],
            workingStyle: ['Challenge weak assumptions'],
            longTermGoals: ['Improve reusable automation quality'],
            avoid: ['Do not hand-wave verification'],
            outputRules: ['List real blockers plainly'],
        };

        const section = formatSoulSection(profile);
        expect(section).toContain('## Soul');
        expect(section).toContain('### Stable Preferences');
        expect(section).toContain('- Prefer concise answers');
        expect(section).toContain('### Do Not Do');
        expect(section).toContain('- Do not hand-wave verification');
    });

    test('builds current session context from runtime metadata', () => {
        const section = buildCurrentSessionSection({
            workspacePath: 'd:/private/coworkany',
            activeFile: 'sidecar/src/main.ts',
            enabledSkillIds: ['skill-creator', 'writing-plans'],
            historyCount: 8,
        });

        expect(section).toContain('## Current Session Context');
        expect(section).toContain('Workspace: d:/private/coworkany');
        expect(section).toContain('Active File: sidecar/src/main.ts');
        expect(section).toContain('Enabled Skills For This Session: skill-creator, writing-plans');
        expect(section).toContain('Conversation Messages In Context: 8');
    });

    test('keeps soul before workspace before current session before memory when assembled', () => {
        const stable = ['## Soul', '## Workspace Policy'].join('\n\n');
        const dynamic = ['## Current Session Context', '## Relevant Memory Context'].join('\n\n');
        const combined = [stable, dynamic].join('\n\n');

        expect(combined.indexOf('## Soul')).toBeLessThan(combined.indexOf('## Workspace Policy'));
        expect(combined.indexOf('## Workspace Policy')).toBeLessThan(combined.indexOf('## Current Session Context'));
        expect(combined.indexOf('## Current Session Context')).toBeLessThan(combined.indexOf('## Relevant Memory Context'));
    });
});
