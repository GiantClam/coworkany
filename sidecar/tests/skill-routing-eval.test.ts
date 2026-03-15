import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SkillStore } from '../src/storage';
import { buildSkillSystemPromptContext, routeRelevantPromptSkills } from '../src/skills/promptBuilder';

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

describe('skill routing eval set', () => {
    test('routes realistic transcript queries to the expected primary skill', () => {
        const { store } = createSkillStoreFixture(buildEvalSkills());
        const cases: Array<{ query: string; expected: string }> = [
            {
                query: 'Use the weather skill to tell me if I need an umbrella in Shanghai tonight.',
                expected: 'weather-helper',
            },
            {
                query: 'Read the latest earnings and tell me whether NVDA still looks attractive.',
                expected: 'stock-research',
            },
            {
                query: 'Please remind me tomorrow at 3pm to send the contract.',
                expected: 'reminder-helper',
            },
            {
                query: 'Open the website, click the login button, and capture a screenshot.',
                expected: 'browser-automation',
            },
            {
                query: 'Review this pull request and focus on bug risk and missing tests.',
                expected: 'pr-review-helper',
            },
            {
                query: 'Make a short deck for the board meeting with speaker notes.',
                expected: 'slides-helper',
            },
            {
                query: 'Extract the text and tables from this PDF contract.',
                expected: 'pdf-helper',
            },
            {
                query: '\u8bf7\u63d0\u9192\u6211\u4e0b\u5468\u4e00\u65e9\u4e0a\u4e5d\u70b9\u5f00\u4f1a',
                expected: 'reminder-helper',
            },
        ];

        for (const scenario of cases) {
            const routed = routeRelevantPromptSkills({
                skills: store.listEnabled(),
                userMessage: scenario.query,
            });
            expect(routed[0]?.name, scenario.query).toBe(scenario.expected);
        }
    });

    test('cuts prompt size substantially versus naive full-body injection', () => {
        const { store } = createSkillStoreFixture(buildEvalSkills(true));
        const query = 'Use the weather skill to get the forecast for Beijing tomorrow morning.';
        const prompt = buildSkillSystemPromptContext({
            skillStore: store,
            userMessage: query,
            stablePrelude: '## Stable\nBase prompt',
            dynamicPrelude: '## Dynamic\nPer-turn directives',
        });

        const routedLength = (prompt.skills?.length ?? 0) + (prompt.dynamic?.length ?? 0);
        const naiveLength = buildNaiveFullInjectionPrompt(store).length;

        expect(routedLength).toBeLessThan(Math.floor(naiveLength * 0.6));
        expect(prompt.dynamic).toContain('Skill: weather-helper');
        expect(prompt.dynamic).not.toContain('Skill: stock-research');
        expect(prompt.dynamic).not.toContain('Skill: pdf-helper');
    });

    test('does not load full skill bodies for generic small-talk prompts', () => {
        const { store } = createSkillStoreFixture(buildEvalSkills());
        const prompt = buildSkillSystemPromptContext({
            skillStore: store,
            userMessage: 'Hello there.',
            stablePrelude: '## Stable\nBase prompt',
        });

        expect(prompt.skills).toContain('## Skill Catalog');
        expect(prompt.dynamic ?? '').not.toContain('## Relevant Skill Instructions');
    });

    test('meets routing quality gates for heavy-skill contamination and intent precision', () => {
        const { store } = createSkillStoreFixture(buildCommercialGuardrailSkills());
        const scenarios = [
            {
                query: 'Use the weather skill to tell me if I need an umbrella in Beijing tonight.',
                required: ['weather-helper'],
                forbidden: ['systematic-debugging', 'writing-plans', 'browser-use'],
                maxRoutes: 1,
            },
            {
                query: 'Explain in one short sentence what earnings mean for NVDA stock investors.',
                required: ['stock-research'],
                forbidden: ['browser-use', 'systematic-debugging', 'writing-plans'],
                maxRoutes: 1,
            },
            {
                query: 'Write an implementation plan for this feature before touching code.',
                required: ['writing-plans'],
                forbidden: ['systematic-debugging', 'browser-use'],
                maxRoutes: 1,
            },
            {
                query: 'This test is failing with a timeout error. Debug the root cause.',
                required: ['systematic-debugging'],
                forbidden: ['writing-plans', 'browser-use'],
                maxRoutes: 1,
            },
            {
                query: 'Open the website, click the login button, and take a screenshot.',
                requiredAnyOf: ['browser-use', 'browser-automation'],
                forbidden: ['systematic-debugging', 'writing-plans'],
                maxRoutes: 1,
            },
            {
                query: 'Hello there.',
                required: [],
                forbidden: ['weather-helper', 'stock-research', 'browser-use', 'systematic-debugging', 'writing-plans'],
                maxRoutes: 0,
            },
        ];

        let requiredHits = 0;
        let forbiddenHits = 0;

        for (const scenario of scenarios) {
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

        const hitRate = requiredHits / scenarios.length;
        const forbiddenRate = forbiddenHits / scenarios.length;

        expect(hitRate).toBe(1);
        expect(forbiddenRate).toBeLessThanOrEqual(0);
    });
});

interface SkillFixture {
    name: string;
    description: string;
    body: string;
    triggers?: string[];
    tags?: string[];
}

function buildEvalSkills(withLargeBodies: boolean = false): SkillFixture[] {
    const repeat = withLargeBodies ? 80 : 4;

    return [
        {
            name: 'weather-helper',
            description: 'Get current weather, forecast, and umbrella advice for any location.',
            body: repeatBody('Use wttr.in or a weather API, normalize the location, and answer with concise forecast details.', repeat),
            triggers: ['weather', 'forecast', 'umbrella'],
            tags: ['weather', 'forecast', 'location'],
        },
        {
            name: 'stock-research',
            description: 'Research earnings, valuation, filings, and analyst commentary for public companies.',
            body: repeatBody('Use market data, SEC filings, and analyst notes to form a buy, sell, or hold view.', repeat),
            triggers: ['stock', 'earnings', 'filings'],
            tags: ['stocks', 'finance', 'valuation'],
        },
        {
            name: 'reminder-helper',
            description: 'Create reminders and scheduled notifications.',
            body: repeatBody('Use reminder and scheduled task tools for reminder requests and confirm the target time.', repeat),
            triggers: ['remind me', 'reminder', '\u63d0\u9192\u6211'],
            tags: ['reminder', 'schedule', 'notification'],
        },
        {
            name: 'browser-automation',
            description: 'Control a browser to navigate, click, fill, and capture screenshots.',
            body: repeatBody('Use browser navigation, element interaction, and screenshot capture for browser tasks.', repeat),
            triggers: ['browser', 'screenshot', 'login button'],
            tags: ['browser', 'automation', 'screenshot'],
        },
        {
            name: 'pr-review-helper',
            description: 'Review code changes for bug risk, regressions, and missing tests.',
            body: repeatBody('Inspect diffs, rank findings by severity, and call out missing test coverage.', repeat),
            triggers: ['pull request', 'code review', 'missing tests'],
            tags: ['review', 'bugs', 'tests'],
        },
        {
            name: 'slides-helper',
            description: 'Create presentation decks with structure, bullets, and speaker notes.',
            body: repeatBody('Draft slide outlines, summarize key points, and include presenter notes.', repeat),
            triggers: ['slides', 'deck', 'speaker notes'],
            tags: ['slides', 'presentation', 'deck'],
        },
        {
            name: 'pdf-helper',
            description: 'Extract text, tables, and metadata from PDF documents.',
            body: repeatBody('Use PDF tooling to extract text and tables while preserving ordering.', repeat),
            triggers: ['pdf', 'table extraction', 'contract pdf'],
            tags: ['pdf', 'tables', 'documents'],
        },
    ];
}

function buildCommercialGuardrailSkills(): SkillFixture[] {
    return [
        ...buildEvalSkills(),
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

function buildNaiveFullInjectionPrompt(store: SkillStore): string {
    const blocks = store.listEnabled().flatMap((skill) => {
        if (!skill.manifest.directory) {
            return [];
        }
        const skillPath = path.join(skill.manifest.directory, 'SKILL.md');
        if (!fs.existsSync(skillPath)) {
            return [];
        }
        return [`Skill: ${skill.manifest.name}\n${fs.readFileSync(skillPath, 'utf-8')}`];
    });
    return blocks.join('\n\n');
}

function createSkillStoreFixture(skills: SkillFixture[]): { workspaceRoot: string; store: SkillStore } {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-skill-routing-eval-'));
    tempDirs.push(workspaceRoot);

    const store = new SkillStore(workspaceRoot);
    for (const skill of skills) {
        const skillDir = path.join(workspaceRoot, '.coworkany', 'skills', skill.name);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), buildSkillMarkdown(skill));
        const manifest = SkillStore.loadFromDirectory(skillDir);
        if (!manifest) {
            throw new Error(`failed to load eval skill manifest for ${skill.name}`);
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
