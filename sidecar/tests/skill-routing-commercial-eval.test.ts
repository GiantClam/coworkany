import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SkillStore } from '../src/storage';
import { routeRelevantPromptSkills } from '../src/skills/promptBuilder';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // ignore cleanup failures in tests
        }
    }
});

describe('skill routing commercial eval fixture', () => {
    test('meets externalized routing thresholds', () => {
        const evalSpec = JSON.parse(
            fs.readFileSync(path.join(import.meta.dir, 'fixtures', 'skill-routing-commercial-eval.json'), 'utf-8')
        ) as {
            thresholds: { requiredHitRate: number; forbiddenHitRate: number };
            scenarios: Array<{
                query: string;
                required?: string[];
                requiredAnyOf?: string[];
                forbidden: string[];
                maxRoutes: number;
            }>;
        };

        const { store } = createSkillStoreFixture(buildCommercialGuardrailSkills());
        let requiredHits = 0;
        let forbiddenHits = 0;

        for (const scenario of evalSpec.scenarios) {
            const routed = routeRelevantPromptSkills({
                skills: store.listEnabled(),
                preferredSkillIds: store.listEnabled().map((skill) => skill.manifest.name),
                userMessage: scenario.query,
            });
            const routedNames = routed.map((skill) => skill.name);

            const requiredSatisfied = (scenario.required ?? []).every((skillName) => routedNames.includes(skillName));
            const requiredAnySatisfied = !scenario.requiredAnyOf
                || scenario.requiredAnyOf.some((skillName) => routedNames.includes(skillName));

            if (requiredSatisfied && requiredAnySatisfied) {
                requiredHits += 1;
            }

            if (scenario.forbidden.some((skillName) => routedNames.includes(skillName))) {
                forbiddenHits += 1;
            }

            expect(routedNames.length, scenario.query).toBeLessThanOrEqual(scenario.maxRoutes);
        }

        const requiredHitRate = requiredHits / evalSpec.scenarios.length;
        const forbiddenHitRate = forbiddenHits / evalSpec.scenarios.length;

        expect(requiredHitRate).toBeGreaterThanOrEqual(evalSpec.thresholds.requiredHitRate);
        expect(forbiddenHitRate).toBeLessThanOrEqual(evalSpec.thresholds.forbiddenHitRate);
    });
});

interface SkillFixture {
    name: string;
    description: string;
    body: string;
    triggers?: string[];
    tags?: string[];
}

function buildCommercialGuardrailSkills(): SkillFixture[] {
    return [
        {
            name: 'weather-helper',
            description: 'Get current weather, forecast, and umbrella advice for any location.',
            body: repeatBody('Use wttr.in or a weather API, normalize the location, and answer with concise forecast details.', 6),
            triggers: ['weather', 'forecast', 'umbrella'],
            tags: ['weather', 'forecast', 'location'],
        },
        {
            name: 'stock-research',
            description: 'Research earnings, valuation, filings, and analyst commentary for public companies.',
            body: repeatBody('Use market data, SEC filings, and analyst notes to form a buy, sell, or hold view.', 6),
            triggers: ['stock', 'earnings', 'filings'],
            tags: ['builtin', 'stocks', 'finance', 'valuation'],
        },
        {
            name: 'reminder-helper',
            description: 'Create reminders and scheduled notifications.',
            body: repeatBody('Use reminder and scheduled task tools for reminder requests and confirm the target time.', 6),
            triggers: ['remind me', 'reminder', '提醒我'],
            tags: ['reminder', 'schedule', 'notification'],
        },
        {
            name: 'browser-automation',
            description: 'Control a browser to navigate, click, fill, and capture screenshots.',
            body: repeatBody('Use browser navigation, element interaction, and screenshot capture for browser tasks.', 6),
            triggers: ['browser', 'screenshot', 'login button'],
            tags: ['browser', 'automation', 'screenshot'],
        },
        {
            name: 'pr-review-helper',
            description: 'Review code changes for bug risk, regressions, and missing tests.',
            body: repeatBody('Inspect diffs, rank findings by severity, and call out missing test coverage.', 6),
            triggers: ['pull request', 'code review', 'missing tests'],
            tags: ['review', 'bugs', 'tests'],
        },
        {
            name: 'slides-helper',
            description: 'Create presentation decks with structure, bullets, and speaker notes.',
            body: repeatBody('Draft slide outlines, summarize key points, and include presenter notes.', 6),
            triggers: ['slides', 'deck', 'speaker notes'],
            tags: ['slides', 'presentation', 'deck'],
        },
        {
            name: 'pdf-helper',
            description: 'Extract text, tables, and metadata from PDF documents.',
            body: repeatBody('Use PDF tooling to extract text and tables while preserving ordering.', 6),
            triggers: ['pdf', 'table extraction', 'contract pdf'],
            tags: ['pdf', 'tables', 'documents'],
        },
        {
            name: 'writing-plans',
            description: 'Use when you have a spec or requirements for a multi-step task before touching code.',
            body: repeatBody('Create a short implementation plan before changing code.', 6),
            triggers: ['implementation plan', 'requirements', 'plan this feature'],
            tags: ['builtin', 'process', 'planning'],
        },
        {
            name: 'systematic-debugging',
            description: 'Use when encountering any bug, test failure, or unexpected behavior.',
            body: repeatBody('Investigate the root cause before proposing a fix.', 6),
            triggers: ['bug', 'error', 'debug', 'test failure'],
            tags: ['builtin', 'process', 'debugging'],
        },
        {
            name: 'browser-use',
            description: 'AI-powered browser automation using natural language.',
            body: repeatBody('Open websites, click buttons, fill forms, and capture screenshots.', 6),
            triggers: ['browser', 'click', 'screenshot', 'login button'],
            tags: ['browser', 'automation'],
        },
    ];
}

function repeatBody(sentence: string, repeat: number): string {
    return Array.from({ length: repeat }, () => sentence).join('\n');
}

function createSkillStoreFixture(skills: SkillFixture[]): { workspaceRoot: string; store: SkillStore } {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-skill-routing-commercial-'));
    tempDirs.push(workspaceRoot);

    const store = new SkillStore(workspaceRoot);
    for (const skill of skills) {
        const skillDir = path.join(workspaceRoot, '.coworkany', 'skills', skill.name);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), buildSkillMarkdown(skill));
        const manifest = SkillStore.loadFromDirectory(skillDir);
        if (!manifest) {
            throw new Error(`failed to load commercial eval skill manifest for ${skill.name}`);
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

    frontmatter.push('---', '', `# ${skill.name}`, '', skill.body, '');
    return frontmatter.join('\n');
}
