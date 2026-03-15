import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SkillStore } from '../src/storage';
import {
    buildSkillCatalogSection,
    buildSkillSystemPromptContext,
    routeRelevantPromptSkills,
} from '../src/skills/promptBuilder';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // ignore cleanup errors in tests
        }
    }
});

describe('skill prompt builder', () => {
    test('keeps enabled skills in catalog but injects only relevant skill bodies', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'weather-helper',
                description: 'Get the current weather and forecast for a location.',
                body: 'Use wttr.in or a weather API to answer weather requests.',
                triggers: ['weather', 'forecast'],
                tags: ['weather', 'forecast', 'location'],
            },
            {
                name: 'stock-research',
                description: 'Research stock prices, filings, and analyst commentary.',
                body: 'Use market data sources and SEC filings for investment research.',
                triggers: ['stock', 'earnings'],
                tags: ['stocks', 'finance'],
            },
        ]);

        const prompt = buildSkillSystemPromptContext({
            skillStore: store,
            userMessage: 'Use the weather skill to get the forecast for Beijing.',
            stablePrelude: '## Stable\nBase prompt',
        });

        expect(prompt.skills).toContain('## Skill Catalog');
        expect(prompt.skills).toContain('weather-helper: Get the current weather and forecast for a location.');
        expect(prompt.skills).toContain('stock-research: Research stock prices, filings, and analyst commentary.');
        expect(prompt.dynamic).toContain('Skill: weather-helper');
        expect(prompt.dynamic).toContain('Use wttr.in or a weather API');
        expect(prompt.dynamic).not.toContain('Skill: stock-research');
        expect(prompt.dynamic).not.toContain('market data sources');
    });

    test('preferred skills are listed but not all preferred bodies are force-loaded', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'weather-helper',
                description: 'Get the current weather and forecast for a location.',
                body: 'Use wttr.in or a weather API to answer weather requests.',
                triggers: ['weather', 'forecast'],
            },
            {
                name: 'stock-research',
                description: 'Research stock prices and company reports.',
                body: 'Use filings and market data for stock research.',
                triggers: ['stock', 'filing'],
            },
        ]);

        const prompt = buildSkillSystemPromptContext({
            skillStore: store,
            preferredSkillIds: ['weather-helper', 'stock-research'],
            userMessage: 'Need the weather in Shenzhen this afternoon.',
            stablePrelude: '## Stable\nBase prompt',
            dynamicPrelude: '## Dynamic\nPer-turn instructions',
        });

        expect(prompt.dynamic).toContain('## Preferred Skills For This Session');
        expect(prompt.dynamic).toContain('- weather-helper');
        expect(prompt.dynamic).toContain('- stock-research');
        expect(prompt.dynamic).toContain('Skill: weather-helper');
        expect(prompt.dynamic).not.toContain('Skill: stock-research');
    });

    test('routes trigger matches ahead of weak semantic matches', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'deploy-helper',
                description: 'Ship services to production environments.',
                body: 'Use kubectl rollout status after deploys.',
                triggers: ['deploy kubernetes'],
            },
            {
                name: 'general-helper',
                description: 'General task assistance.',
                body: 'General instructions.',
            },
        ]);

        const routed = routeRelevantPromptSkills({
            skills: store.listEnabled(),
            userMessage: 'Please deploy kubernetes for this service today.',
        });

        expect(routed[0]?.name).toBe('deploy-helper');
        expect(routed[0]?.reason).toBe('trigger');
    });

    test('supports Chinese trigger phrases without pulling unrelated skills', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'reminder-helper',
                description: 'Create reminders and scheduled notifications.',
                body: 'Use reminder and scheduled task tools for reminder requests.',
                triggers: ['\u63d0\u9192\u6211', '\u5b9a\u65f6\u63d0\u9192'],
            },
            {
                name: 'stock-research',
                description: 'Research stock prices and company reports.',
                body: 'Use filings and market data for stock research.',
                triggers: ['\u80a1\u7968', '\u8d22\u62a5'],
            },
        ]);

        const routed = routeRelevantPromptSkills({
            skills: store.listEnabled(),
            userMessage: '\u8bf7\u63d0\u9192\u6211\u660e\u5929\u4e0b\u5348\u4e09\u70b9\u5f00\u4f1a',
        });

        expect(routed.map((skill) => skill.name)).toEqual(['reminder-helper']);
    });

    test('does not treat a full enabled-skill list as a preference boost', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'weather-helper',
                description: 'Get the current weather and forecast for a location.',
                body: 'Use wttr.in or a weather API to answer weather requests.',
                triggers: ['weather', 'forecast', 'umbrella'],
                tags: ['weather', 'forecast'],
            },
            {
                name: 'writing-plans',
                description: 'Use when you have a spec or requirements for a multi-step task.',
                body: 'Create a plan before implementation.',
                triggers: ['implementation plan', 'requirements'],
                tags: ['builtin', 'process', 'planning'],
            },
            {
                name: 'systematic-debugging',
                description: 'Use when encountering any bug, test failure, or unexpected behavior.',
                body: 'Follow a structured debugging workflow.',
                triggers: ['bug', 'error', 'debug'],
                tags: ['builtin', 'process', 'debugging'],
            },
        ]);

        const allEnabledIds = store.listEnabled().map((skill) => skill.manifest.name);
        const routed = routeRelevantPromptSkills({
            skills: store.listEnabled(),
            preferredSkillIds: allEnabledIds,
            userMessage: 'Use the weather skill to tell me if I need an umbrella in Beijing tonight.',
        });

        expect(routed.map((skill) => skill.name)).toEqual(['weather-helper']);
    });

    test('suppresses browser automation skills for non-browser finance prompts', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'stock-research',
                description: 'Research stock prices, earnings, and analyst commentary.',
                body: 'Use filings and market data for stock research.',
                triggers: ['stock', 'earnings', 'valuation'],
                tags: ['stocks', 'finance'],
            },
            {
                name: 'browser-use',
                description: 'AI-powered browser automation using natural language.',
                body: 'Open websites, click buttons, fill forms, and capture screenshots.',
                triggers: ['browser', 'click', 'screenshot'],
                tags: ['browser', 'automation'],
            },
        ]);

        const routed = routeRelevantPromptSkills({
            skills: store.listEnabled(),
            userMessage: 'Explain in one short sentence what earnings mean for NVDA stock investors.',
        });

        expect(routed.map((skill) => skill.name)).toEqual(['stock-research']);
    });

    test('prefers a user-installed skill over a builtin skill in the same family when both match', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'stock-research',
                description: 'Research stock prices, earnings, and analyst commentary.',
                body: 'Use filings and market data for stock research.',
                triggers: ['stock', 'earnings', 'valuation'],
                tags: ['builtin', 'stocks', 'finance'],
            },
            {
                name: 'codex-e2e-stock-routing',
                description: 'Stock explanation helper for short investor questions.',
                body: 'Give a short explanation for stock questions.',
                triggers: ['stock', 'earnings', 'investors'],
                tags: ['stocks', 'finance'],
            },
        ]);

        const routed = routeRelevantPromptSkills({
            skills: store.listEnabled(),
            preferredSkillIds: store.listEnabled().map((skill) => skill.manifest.name),
            userMessage: 'Use the stock skill to explain what earnings mean for NVDA stock investors.',
        });

        expect(routed.map((skill) => skill.name)).toEqual(['codex-e2e-stock-routing']);
    });

    test('skips model-disabled skills in catalog and routing', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'visible-skill',
                description: 'Visible skill for normal tasks.',
                body: 'Visible body',
            },
            {
                name: 'background-skill',
                description: 'Background-only skill.',
                body: 'Background body',
                disableModelInvocation: true,
            },
        ]);

        const catalog = buildSkillCatalogSection(store.list());
        const routed = routeRelevantPromptSkills({
            skills: store.list(),
            userMessage: 'Use the background skill now.',
        });

        expect(catalog).toContain('visible-skill');
        expect(catalog).not.toContain('background-skill');
        expect(routed.map((skill) => skill.name)).not.toContain('background-skill');
    });

    test('emits routing telemetry with prompt and suppression metrics', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'weather-helper',
                description: 'Get the current weather and forecast for a location.',
                body: 'Use wttr.in or a weather API to answer weather requests.',
                triggers: ['weather', 'forecast', 'umbrella'],
                tags: ['weather', 'forecast'],
            },
            {
                name: 'stock-research',
                description: 'Research stock prices, earnings, and analyst commentary.',
                body: 'Use filings and market data for stock research.',
                triggers: ['stock', 'earnings', 'valuation'],
                tags: ['builtin', 'stocks', 'finance'],
            },
        ]);

        const weatherPrompt = buildSkillSystemPromptContext({
            skillStore: store,
            preferredSkillIds: store.listEnabled().map((skill) => skill.manifest.name),
            userMessage: 'Use the weather skill to tell me if I need an umbrella in Beijing tonight.',
            stablePrelude: '## Stable\nBase prompt',
        });

        expect(weatherPrompt.telemetry?.routedSkillNames).toEqual(['weather-helper']);
        expect(weatherPrompt.telemetry?.effectivePreferredSkillCount).toBe(0);
        expect(weatherPrompt.telemetry?.dynamicSkillBodyChars).toBeGreaterThan(0);
        expect(weatherPrompt.telemetry?.smallTalkSuppressed).toBe(false);

        const smallTalkPrompt = buildSkillSystemPromptContext({
            skillStore: store,
            userMessage: 'Hello there.',
            stablePrelude: '## Stable\nBase prompt',
        });

        expect(smallTalkPrompt.telemetry?.routedSkillNames).toEqual([]);
        expect(smallTalkPrompt.telemetry?.smallTalkSuppressed).toBe(true);
    });

    test('sanitizes Claude identity references from skill catalog and bodies', () => {
        const { store } = createSkillStoreFixture([
            {
                name: 'self-improvement',
                description: 'Use when User corrects Claude or Claude realizes its knowledge is outdated.',
                body: 'This skill extends Claude Code plugins and tells Claude should retry after errors.',
                triggers: ['retry'],
            },
        ]);

        const prompt = buildSkillSystemPromptContext({
            skillStore: store,
            userMessage: 'Please retry after this error.',
            stablePrelude: '## Stable\nBase prompt',
        });

        expect(prompt.skills).toContain('User corrects the assistant');
        expect(prompt.skills).toContain('the assistant realizes its knowledge is outdated.');
        expect(prompt.skills).not.toContain('Claude');
        expect(prompt.dynamic).toContain('CoworkAny plugins');
        expect(prompt.dynamic).toContain('The assistant should retry after errors.');
        expect(prompt.dynamic).not.toContain('Claude');
    });
});

interface SkillFixture {
    name: string;
    description: string;
    body: string;
    triggers?: string[];
    tags?: string[];
    disableModelInvocation?: boolean;
}

function createSkillStoreFixture(skills: SkillFixture[]): { workspaceRoot: string; store: SkillStore } {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-skill-prompt-'));
    tempDirs.push(workspaceRoot);

    const store = new SkillStore(workspaceRoot);
    for (const skill of skills) {
        const skillDir = path.join(workspaceRoot, '.coworkany', 'skills', skill.name);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), buildSkillMarkdown(skill));
        const manifest = SkillStore.loadFromDirectory(skillDir);
        if (!manifest) {
            throw new Error(`failed to load test skill manifest for ${skill.name}`);
        }
        store.install(manifest);
    }

    return { workspaceRoot, store };
}

function buildSkillMarkdown(skill: SkillFixture): string {
    const frontmatter: string[] = [
        '---',
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        'version: 0.1.0',
    ];

    if (skill.triggers && skill.triggers.length > 0) {
        frontmatter.push('triggers:');
        for (const trigger of skill.triggers) {
            frontmatter.push(`  - ${trigger}`);
        }
    }

    if (skill.tags && skill.tags.length > 0) {
        frontmatter.push('tags:');
        for (const tag of skill.tags) {
            frontmatter.push(`  - ${tag}`);
        }
    }

    if (skill.disableModelInvocation) {
        frontmatter.push('disableModelInvocation: true');
    }

    frontmatter.push('---', '', `# ${skill.name}`, '', skill.body, '');
    return frontmatter.join('\n');
}
