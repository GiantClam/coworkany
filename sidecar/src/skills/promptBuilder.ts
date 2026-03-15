import * as fs from 'fs';
import * as path from 'path';

import { SkillStore, type ClaudeSkillManifest, type StoredSkill } from '../storage';

const MAX_SKILL_CATALOG_CHARS = 12_000;
const MAX_SELECTED_SKILL_BODIES = 3;
const MAX_SKILL_BODY_CHARS = 6_000;
const MAX_DYNAMIC_SKILL_SECTION_CHARS = 16_000;
const MIN_PROMPT_ROUTE_SCORE = 20;
const MAX_EXPLICITLY_PREFERRED_SKILLS = 5;
const MAX_PREFERRED_SKILL_RATIO = 0.5;
const GLOBAL_PREFERRED_SKILL_PENALTY = 0;
const PROCESS_SKILL_INTENT_PENALTY = 24;
const BROWSER_SKILL_INTENT_PENALTY = 26;
const BROWSER_USE_SKILL_NAMES = new Set(['browser-use', 'browser-automation']);
const CUSTOM_SKILL_FAMILY_OVERRIDE_MARGIN = 18;
const PROMPT_IDENTITY_REWRITES: Array<[RegExp, string]> = [
    [/\bClaude Code plugins?\b/gi, 'CoworkAny plugins'],
    [/\bClaude Code\b/gi, 'CoworkAny'],
    [/\bClaude plugins?\b/gi, 'CoworkAny skills'],
    [/\bfor Claude\b/gi, 'for the assistant'],
    [/\bClaude should\b/gi, 'The assistant should'],
    [/\bWhen Claude needs to\b/gi, 'When the assistant needs to'],
    [/\bClaude needs to\b/gi, 'the assistant needs to'],
    [/\bClaude realizes\b/gi, 'the assistant realizes'],
    [/\bUser corrects Claude\b/gi, 'User corrects the assistant'],
    [/\banother instance of Claude\b/gi, 'another instance of the assistant'],
    [/\bClaude\b/g, 'CoworkAny'],
];

export interface StructuredSkillSystemPrompt {
    skills: string;
    dynamic?: string;
    telemetry?: SkillRoutingTelemetry;
}

export interface RoutedPromptSkill {
    name: string;
    score: number;
    reason: 'preferred' | 'trigger' | 'semantic';
    body?: string;
}

interface PromptSkillCandidate {
    record: StoredSkill;
    body?: string;
}

interface ScoredPromptSkill extends RoutedPromptSkill {
    family?: string;
    isBuiltin?: boolean;
}

interface RouteRelevantPromptSkillsOptions {
    skills: StoredSkill[];
    preferredSkillIds?: string[];
    userMessage?: string;
    maxSelectedSkillBodies?: number;
}

interface BuildSkillPromptOptions {
    skillStore: SkillStore;
    preferredSkillIds?: string[];
    userMessage?: string;
    stablePrelude: string;
    dynamicPrelude?: string;
    maxSelectedSkillBodies?: number;
}

interface RoutingIntentSignals {
    planning: boolean;
    debugging: boolean;
    browser: boolean;
    smallTalk: boolean;
}

export interface SkillRoutingTelemetry {
    totalEnabledSkillCount: number;
    preferredSkillCount: number;
    effectivePreferredSkillCount: number;
    userMessageLength: number;
    routedSkillCount: number;
    routedSkillNames: string[];
    stablePromptChars: number;
    dynamicPromptChars: number;
    dynamicSkillBodyChars: number;
    smallTalkSuppressed: boolean;
}

const SKILL_ROUTING_STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'assist',
    'for',
    'help',
    'i',
    'me',
    'my',
    'please',
    'short',
    'sentence',
    'say',
    'the',
    'this',
    'there',
    'to',
    'today',
    'use',
    'with',
]);

export function buildSkillSystemPromptContext(options: BuildSkillPromptOptions): StructuredSkillSystemPrompt {
    const promptCandidates = collectPromptSkillCandidates(options.skillStore, options.preferredSkillIds);
    const effectivePreferredSkillIds = derivePreferredSkillIdsForRouting(
        promptCandidates.map((candidate) => candidate.record),
        options.preferredSkillIds
    );
    const intentSignals = detectIntentSignals(options.userMessage ?? '', tokenize(options.userMessage ?? ''));
    const catalogSection = buildSkillCatalogSection(promptCandidates.map((candidate) => candidate.record));
    const routedSkills = routeRelevantPromptSkills({
        skills: promptCandidates.map((candidate) => candidate.record),
        preferredSkillIds: effectivePreferredSkillIds,
        userMessage: options.userMessage,
        maxSelectedSkillBodies: options.maxSelectedSkillBodies,
    }).map((routed) => ({
        ...routed,
        body: promptCandidates.find((candidate) => candidate.record.manifest.name === routed.name)?.body,
    }));

    const stableSections = [options.stablePrelude.trim(), catalogSection].filter(Boolean);
    const dynamicSections: string[] = [];

    if (options.dynamicPrelude?.trim()) {
        dynamicSections.push(options.dynamicPrelude.trim());
    }

    if (effectivePreferredSkillIds.length > 0) {
        dynamicSections.push(
            `## Preferred Skills For This Session\n\n` +
            `These skills are enabled or explicitly selected for this session. Prefer them when relevant, but do not assume every turn needs all of them.\n\n` +
            effectivePreferredSkillIds.map((skillId) => `- ${skillId}`).join('\n')
        );
    }

    if (routedSkills.some((skill) => skill.body)) {
        dynamicSections.push(buildRelevantSkillBodySection(routedSkills));
        console.log(`[Skill] Routed prompt skills: ${routedSkills.map((skill) => skill.name).join(', ')}`);
    }

    const skills = stableSections.join('\n\n');
    const dynamic = trimSection(dynamicSections.join('\n\n'), MAX_DYNAMIC_SKILL_SECTION_CHARS);
    const telemetry = buildSkillRoutingTelemetry({
        totalEnabledSkillCount: promptCandidates.length,
        preferredSkillIds: options.preferredSkillIds,
        effectivePreferredSkillIds,
        userMessage: options.userMessage ?? '',
        routedSkills,
        skills,
        dynamic,
        smallTalkSuppressed: intentSignals.smallTalk && routedSkills.length === 0,
    });

    console.log(`[SkillRoutingTelemetry] ${JSON.stringify(telemetry)}`);

    return {
        skills,
        dynamic,
        telemetry,
    };
}

export function routeRelevantPromptSkills(
    options: RouteRelevantPromptSkillsOptions
): RoutedPromptSkill[] {
    const preferredIds = new Set(derivePreferredSkillIdsForRouting(options.skills, options.preferredSkillIds));
    const normalizedMessage = normalizeSkillRoutingText(options.userMessage ?? '');
    const tokens = tokenize(options.userMessage ?? '');
    const intentSignals = detectIntentSignals(options.userMessage ?? '', tokens);
    if (intentSignals.smallTalk) {
        return [];
    }
    const maxSelected = Math.max(1, options.maxSelectedSkillBodies ?? MAX_SELECTED_SKILL_BODIES);

    const scored = options.skills
        .filter((skill) => skill.manifest.disableModelInvocation !== true)
        .map((skill): ScoredPromptSkill | null => {
            const score = scorePromptSkill(skill, normalizedMessage, tokens, preferredIds, intentSignals);
            if (score < MIN_PROMPT_ROUTE_SCORE) {
                return null;
            }

            const reason = preferredIds.has(skill.manifest.name)
                ? 'preferred'
                : hasDirectTriggerMatch(skill, normalizedMessage)
                    ? 'trigger'
                    : 'semantic';

            return {
                name: skill.manifest.name,
                score,
                reason,
                family: getSkillRouteFamily(skill),
                isBuiltin: skill.isBuiltin,
            };
        })
        .filter((entry): entry is ScoredPromptSkill => entry !== null)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    if (scored.length === 0) {
        return [];
    }

    const scoreFloor = Math.max(MIN_PROMPT_ROUTE_SCORE, Math.ceil(scored[0].score * 0.55));
    const collapsed = collapseCompetingSkillFamilies(scored);

    return collapsed
        .filter((entry) => entry.score >= scoreFloor)
        .slice(0, maxSelected);
}

export function buildSkillCatalogSection(skills: StoredSkill[]): string {
    const lines = [
        '## Skill Catalog',
        '',
        'These skills are available in the current workspace. Treat this catalog as an index. Load or follow detailed instructions only for skills that are relevant to the current user request.',
        '',
    ];

    let totalLength = lines.join('\n').length;
    const sortedSkills = [...skills]
        .filter((skill) => skill.manifest.disableModelInvocation !== true)
        .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

    if (sortedSkills.length === 0) {
        lines.push('- No model-invocable skills are currently enabled.');
        return lines.join('\n');
    }

    for (const skill of sortedSkills) {
        const line = buildCatalogLine(skill);
        if (totalLength + line.length + 1 > MAX_SKILL_CATALOG_CHARS) {
            lines.push('- ...additional skills omitted from catalog for brevity');
            break;
        }
        lines.push(line);
        totalLength += line.length + 1;
    }

    return lines.join('\n');
}

function collectPromptSkillCandidates(skillStore: SkillStore, preferredSkillIds?: string[]): PromptSkillCandidate[] {
    const candidates = new Map<string, PromptSkillCandidate>();

    for (const skill of skillStore.listEnabled()) {
        if (skill.manifest.disableModelInvocation === true) {
            continue;
        }
        candidates.set(skill.manifest.name, {
            record: skill,
            body: readSkillBody(skill.manifest),
        });
    }

    for (const skillId of dedupeSkillIds(preferredSkillIds)) {
        const skill = skillStore.get(skillId);
        if (!skill || skill.manifest.disableModelInvocation === true) {
            continue;
        }
        if (!candidates.has(skill.manifest.name)) {
            candidates.set(skill.manifest.name, {
                record: skill,
                body: readSkillBody(skill.manifest),
            });
        }
    }

    return [...candidates.values()];
}

function buildRelevantSkillBodySection(skills: RoutedPromptSkill[]): string {
    const sections = [
        '## Relevant Skill Instructions',
        '',
        'Use the following skill bodies only if they help solve the current user request. Ignore unrelated skills even if they are enabled in the session.',
        '',
    ];

    for (const skill of skills) {
        if (!skill.body) {
            continue;
        }
        sections.push(
            `Skill: ${skill.name}`,
            `Selection reason: ${skill.reason}`,
            skill.body,
            ''
        );
    }

    return trimSection(sections.join('\n').trim(), MAX_DYNAMIC_SKILL_SECTION_CHARS) ?? '';
}

function buildCatalogLine(skill: StoredSkill): string {
    const manifest = skill.manifest;
    const details: string[] = [];

    if (manifest.tags && manifest.tags.length > 0) {
        details.push(`tags=${manifest.tags.slice(0, 6).join(', ')}`);
    }
    if (manifest.triggers && manifest.triggers.length > 0) {
        details.push(`triggers=${manifest.triggers.slice(0, 4).join(', ')}`);
    }
    const tools = manifest.allowedTools ?? manifest.requires?.tools ?? [];
    if (tools.length > 0) {
        details.push(`tools=${tools.slice(0, 6).join(', ')}`);
    }
    if (manifest.requires?.env && manifest.requires.env.length > 0) {
        details.push(`env=${manifest.requires.env.slice(0, 4).join(', ')}`);
    }

    const suffix = details.length > 0 ? ` [${details.join(' | ')}]` : '';
    return `- ${manifest.name}: ${sanitizePromptIdentityText(manifest.description)}${suffix}`;
}

function readSkillBody(manifest: ClaudeSkillManifest): string | undefined {
    const embedded = (manifest as ClaudeSkillManifest & { content?: string }).content;
    if (typeof embedded === 'string' && embedded.trim()) {
        return trimSection(sanitizePromptIdentityText(embedded.trim()), MAX_SKILL_BODY_CHARS);
    }

    if (!manifest.directory) {
        return undefined;
    }

    const skillMdPath = path.join(manifest.directory, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
        return undefined;
    }

    return trimSection(
        sanitizePromptIdentityText(fs.readFileSync(skillMdPath, 'utf-8').trim()),
        MAX_SKILL_BODY_CHARS
    );
}

function sanitizePromptIdentityText(text: string): string {
    if (!text) {
        return text;
    }

    return PROMPT_IDENTITY_REWRITES.reduce(
        (value, [pattern, replacement]) => value.replace(pattern, replacement),
        text
    );
}

function scorePromptSkill(
    skill: StoredSkill,
    normalizedMessage: string,
    tokens: string[],
    preferredIds: Set<string>,
    intentSignals: RoutingIntentSignals
): number {
    const manifest = skill.manifest;
    const fields = [
        { value: manifest.name, exactWeight: 36, tokenWeight: 12 },
        { value: manifest.description, exactWeight: 14, tokenWeight: 5 },
        ...((manifest.tags ?? []).map((tag) => ({ value: tag, exactWeight: 10, tokenWeight: 4 }))),
        ...((manifest.triggers ?? []).map((trigger) => ({ value: trigger, exactWeight: 18, tokenWeight: 6 }))),
        ...(((manifest.allowedTools ?? manifest.requires?.tools ?? [])).map((tool) => ({
            value: tool,
            exactWeight: 6,
            tokenWeight: 2,
        }))),
    ];

    let score = fields.reduce(
        (sum, field) => sum + scoreField(field.value, normalizedMessage, tokens, field.exactWeight, field.tokenWeight),
        0
    );

    if (preferredIds.has(manifest.name)) {
        score += 18;
    }

    if (hasDirectTriggerMatch(skill, normalizedMessage)) {
        score += 28;
    }

    score -= scoreIntentMismatchPenalty(skill, normalizedMessage, intentSignals);

    return score;
}

function scoreField(
    value: string,
    normalizedMessage: string,
    tokens: string[],
    exactWeight: number,
    tokenWeight: number
): number {
    const normalizedValue = normalizeSkillRoutingText(value);
    if (!normalizedValue) {
        return 0;
    }

    let score = 0;

    if (normalizedMessage && normalizedMessage.includes(normalizedValue)) {
        score += exactWeight;
    }

    for (const token of tokens) {
        if (normalizedValue.includes(token)) {
            score += tokenWeight;
        }
    }

    return score;
}

function hasDirectTriggerMatch(skill: StoredSkill, normalizedMessage: string): boolean {
    if (!normalizedMessage) {
        return false;
    }

    return (skill.manifest.triggers ?? [])
        .some((trigger) => normalizedMessage.includes(normalizeSkillRoutingText(trigger)));
}

function derivePreferredSkillIdsForRouting(skills: StoredSkill[], preferredSkillIds?: string[]): string[] {
    const deduped = dedupeSkillIds(preferredSkillIds);
    if (deduped.length === 0) {
        return [];
    }

    const availableSkillIds = new Set(skills.map((skill) => skill.manifest.name));
    const inScope = deduped.filter((skillId) => availableSkillIds.has(skillId));
    if (inScope.length === 0) {
        return [];
    }

    const coverageRatio = skills.length > 0 ? inScope.length / skills.length : 0;
    if (inScope.length > MAX_EXPLICITLY_PREFERRED_SKILLS || coverageRatio > MAX_PREFERRED_SKILL_RATIO) {
        return [];
    }

    return inScope;
}

function detectIntentSignals(userMessage: string, tokens: string[]): RoutingIntentSignals {
    const normalizedMessage = normalizeSkillRoutingText(userMessage);
    const hasToken = (...values: string[]) => values.some((value) => tokens.includes(value));
    const includesAny = (...values: string[]) => values.some((value) => normalizedMessage.includes(value));

    return {
        planning:
            hasToken('plan', 'planning', 'spec', 'requirements', 'implementing', 'implementation', 'feature') ||
            includesAny('implementation plan', 'write a plan', 'break down', 'requirements', 'plan this'),
        debugging:
            hasToken('bug', 'error', 'debug', 'debugging', 'failed', 'failure', 'failing', 'broken', 'crash') ||
            includesAny('not working', 'test failure', 'unexpected behavior'),
        browser:
            hasToken(
                'browser',
                'website',
                'webpage',
                'screenshot',
                'click',
                'fill',
                'navigate',
                'login',
                'form',
                'upload'
            ) || includesAny('open the website', 'open the browser', 'log into', 'take a screenshot'),
        smallTalk:
            (hasToken('hello', 'thanks', 'thank', 'hi', 'hey') ||
                includesAny('hello', 'hi there', 'hey there', 'thank you', 'how are you')) &&
            tokens.length <= 8,
    };
}

function scoreIntentMismatchPenalty(
    skill: StoredSkill,
    normalizedMessage: string,
    intentSignals: RoutingIntentSignals
): number {
    const tags = new Set((skill.manifest.tags ?? []).map((tag) => normalizeSkillRoutingText(tag)));
    const skillName = normalizeSkillRoutingText(skill.manifest.name);
    const explicitlyNamed = normalizedMessage.includes(skillName);

    if (explicitlyNamed) {
        return GLOBAL_PREFERRED_SKILL_PENALTY;
    }

    let penalty = 0;

    if (skill.isBuiltin && tags.has('process')) {
        const isPlanningSkill = tags.has('planning') || skillName.includes('plan');
        const isDebugSkill = tags.has('debugging') || skillName.includes('debug');
        const allowsProcessIntent = (!isPlanningSkill && !isDebugSkill)
            || (isPlanningSkill && intentSignals.planning)
            || (isDebugSkill && intentSignals.debugging);

        if (!allowsProcessIntent) {
            penalty += PROCESS_SKILL_INTENT_PENALTY;
        }
    }

    const hasBrowserTools = (skill.manifest.allowedTools ?? skill.manifest.requires?.tools ?? [])
        .some((tool) => tool.startsWith('browser_'));
    const isBrowserSkill = tags.has('browser')
        || tags.has('automation')
        || BROWSER_USE_SKILL_NAMES.has(skill.manifest.name)
        || hasBrowserTools;

    if (isBrowserSkill && !intentSignals.browser) {
        penalty += BROWSER_SKILL_INTENT_PENALTY;
    }

    return penalty;
}

function getSkillRouteFamily(skill: StoredSkill): string | undefined {
    const tags = new Set((skill.manifest.tags ?? []).map((tag) => normalizeSkillRoutingText(tag)));
    const name = normalizeSkillRoutingText(skill.manifest.name);

    if (tags.has('planning') || name.includes('plan') || name.includes('tdd')) {
        return 'planning';
    }
    if (tags.has('debugging') || name.includes('debug')) {
        return 'debugging';
    }
    if (tags.has('browser') || tags.has('automation') || BROWSER_USE_SKILL_NAMES.has(skill.manifest.name)) {
        return 'browser';
    }
    if (tags.has('weather') || name.includes('weather') || name.includes('forecast')) {
        return 'weather';
    }
    if (tags.has('finance') || tags.has('stocks') || name.includes('stock') || name.includes('valuation')) {
        return 'finance';
    }
    if (tags.has('reminder') || tags.has('schedule') || name.includes('reminder')) {
        return 'reminder';
    }
    if (tags.has('review') || name.includes('review')) {
        return 'review';
    }
    if (tags.has('slides') || tags.has('presentation') || name.includes('slides') || name.includes('deck')) {
        return 'slides';
    }
    if (tags.has('pdf') || name.includes('pdf')) {
        return 'pdf';
    }

    return undefined;
}

function collapseCompetingSkillFamilies(skills: ScoredPromptSkill[]): RoutedPromptSkill[] {
    const familyLeaders = new Map<string, ScoredPromptSkill>();
    const familyOrder: string[] = [];
    const collapsed: RoutedPromptSkill[] = [];

    for (const skill of skills) {
        if (!skill.family) {
            collapsed.push({
                name: skill.name,
                score: skill.score,
                reason: skill.reason,
            });
            continue;
        }

        const existing = familyLeaders.get(skill.family);
        if (!existing) {
            familyLeaders.set(skill.family, skill);
            familyOrder.push(skill.family);
            continue;
        }

        const shouldPreferCustom =
            existing.isBuiltin === true &&
            skill.isBuiltin !== true &&
            (
                skill.reason !== 'semantic' ||
                skill.score >= existing.score - CUSTOM_SKILL_FAMILY_OVERRIDE_MARGIN
            );

        if (shouldPreferCustom) {
            familyLeaders.set(skill.family, skill);
        }
    }

    for (const family of familyOrder) {
        const skill = familyLeaders.get(family);
        if (!skill) {
            continue;
        }

        collapsed.push({
            name: skill.name,
            score: skill.score,
            reason: skill.reason,
        });
    }

    return collapsed.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function buildSkillRoutingTelemetry(input: {
    totalEnabledSkillCount: number;
    preferredSkillIds?: string[];
    effectivePreferredSkillIds: string[];
    userMessage: string;
    routedSkills: Array<RoutedPromptSkill & { body?: string }>;
    skills: string;
    dynamic?: string;
    smallTalkSuppressed: boolean;
}): SkillRoutingTelemetry {
    const dynamicSkillBodyChars = input.routedSkills.reduce(
        (sum, skill) => sum + (skill.body?.length ?? 0),
        0
    );

    return {
        totalEnabledSkillCount: input.totalEnabledSkillCount,
        preferredSkillCount: dedupeSkillIds(input.preferredSkillIds).length,
        effectivePreferredSkillCount: input.effectivePreferredSkillIds.length,
        userMessageLength: input.userMessage.length,
        routedSkillCount: input.routedSkills.length,
        routedSkillNames: input.routedSkills.map((skill) => skill.name),
        stablePromptChars: input.skills.length,
        dynamicPromptChars: input.dynamic?.length ?? 0,
        dynamicSkillBodyChars,
        smallTalkSuppressed: input.smallTalkSuppressed,
    };
}

function normalizeSkillRoutingText(value: string): string {
    return value.trim().toLowerCase();
}

function tokenize(value: string): string[] {
    return normalizeSkillRoutingText(value)
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length > 1)
        .filter((token) => !SKILL_ROUTING_STOPWORDS.has(token));
}

function dedupeSkillIds(skillIds?: string[]): string[] {
    if (!skillIds || skillIds.length === 0) {
        return [];
    }

    return [...new Set(skillIds.map((skillId) => skillId.trim()).filter(Boolean))];
}

function trimSection(value: string, maxChars: number): string | undefined {
    if (!value) {
        return undefined;
    }

    if (value.length <= maxChars) {
        return value;
    }

    return `${value.slice(0, maxChars)}\n...[truncated]`;
}
