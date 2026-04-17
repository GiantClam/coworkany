import type { SkillStore } from '../storage/skillStore';
import { detectDependencyCycles, verifyAndDemotePlugins } from './pluginDependencyResolver';
import { detectTaskIntentDomain } from './capabilityRegistry';

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
const EXPLICIT_SKILL_CONTENT_MAX_CHARS = 2_000;
const AUTO_CRITICAL_SKILL_CONTENT_MAX_CHARS = 2_400;

function normalizeSkillIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function readSkillInstructionContent(skill: {
    manifest: Record<string, unknown>;
}, maxChars = EXPLICIT_SKILL_CONTENT_MAX_CHARS): string | undefined {
    const raw = skill.manifest.content;
    if (typeof raw !== 'string') {
        return undefined;
    }
    const normalized = raw.trim();
    if (normalized.length === 0) {
        return undefined;
    }
    if (normalized.length <= maxChars) {
        return normalized;
    }
    return `${normalized.slice(0, maxChars)}\n...[truncated]`;
}

type SkillPromptDomain = ReturnType<typeof detectTaskIntentDomain>;

const AUTO_CRITICAL_SKILL_IDS_BY_DOMAIN: Partial<Record<SkillPromptDomain, string[]>> = {
    market: ['stock-research'],
};

const DOMAIN_SKILL_KEYWORDS: Record<SkillPromptDomain, string[]> = {
    market: ['stock', 'stocks', 'market', 'finance', 'financial', 'invest', 'investment', 'equity', 'ticker', 'quote', '股', '股票', '港股', '美股', '行情', '股价', '投资', '财经'],
    weather: ['weather', 'forecast', 'temperature', 'humidity', 'rain', 'snow', '风', '天气', '气温', '温度', '预报'],
    news: ['news', 'headline', 'breaking', 'trend', '资讯', '新闻', '头条', '快讯', '趋势'],
    browser: ['browser', 'playwright', 'click', 'navigate', '网页', '浏览器', '点击', '页面', '截图'],
    general: [],
};

function buildSkillKeywordCorpus(skill: {
    manifest: {
        name?: string;
        description?: string;
        tags?: string[];
        triggers?: string[];
    };
}): string {
    const segments: string[] = [];
    if (typeof skill.manifest.name === 'string') {
        segments.push(skill.manifest.name);
    }
    if (typeof skill.manifest.description === 'string') {
        segments.push(skill.manifest.description);
    }
    if (Array.isArray(skill.manifest.tags)) {
        segments.push(...skill.manifest.tags);
    }
    if (Array.isArray(skill.manifest.triggers)) {
        segments.push(...skill.manifest.triggers);
    }
    return segments.join(' ').toLowerCase();
}

function isDomainRelevantSkill(
    skill: {
        manifest: {
            name?: string;
            description?: string;
            tags?: string[];
            triggers?: string[];
        };
    },
    domain: SkillPromptDomain,
): boolean {
    if (domain === 'general') {
        return false;
    }
    const keywords = DOMAIN_SKILL_KEYWORDS[domain];
    if (!keywords || keywords.length === 0) {
        return false;
    }
    const corpus = buildSkillKeywordCorpus(skill);
    return keywords.some((keyword) => corpus.includes(keyword.toLowerCase()));
}

export function buildSkillPromptFromStore(
    store: Pick<SkillStore, 'list' | 'findByTrigger' | 'get'>,
    input: SkillPromptInput,
): SkillPromptOutput {
    const allSkills = store.list();
    const skillById = new Map(
        allSkills.map((skill) => [skill.manifest.name, skill]),
    );
    const triggered = store.findByTrigger(input.userMessage).map((skill) => skill.manifest.name);
    const explicit = normalizeSkillIds(input.explicitEnabledSkills);
    const domain = detectTaskIntentDomain(input.userMessage);
    const domainRelevantUserSkills = allSkills
        .filter((skill) => skill.enabled && !skill.isBuiltin && isDomainRelevantSkill(skill, domain))
        .map((skill) => skill.manifest.name);
    const domainRelevantBuiltinSkills = allSkills
        .filter((skill) => skill.enabled && skill.isBuiltin && isDomainRelevantSkill(skill, domain))
        .map((skill) => skill.manifest.name);
    const selectedIds = Array.from(new Set([
        ...explicit,
        ...triggered,
        ...domainRelevantUserSkills,
        ...domainRelevantBuiltinSkills,
    ]));
    const maxSkills = typeof input.maxSkills === 'number' && input.maxSkills > 0
        ? Math.floor(input.maxSkills)
        : 6;
    const explicitPriority = new Map(explicit.map((skillId, index) => [skillId, index]));
    const triggeredPriority = new Map(triggered.map((skillId, index) => [skillId, index]));
    const scoredIds = selectedIds
        .map((skillId) => {
            const skill = skillById.get(skillId) ?? store.get(skillId);
            if (!skill) {
                return {
                    skillId,
                    score: Number.NEGATIVE_INFINITY,
                };
            }
            let score = 0;
            if (explicitPriority.has(skillId)) {
                score += 10_000 - (explicitPriority.get(skillId) ?? 0);
            }
            if (triggeredPriority.has(skillId)) {
                score += 5_000 - (triggeredPriority.get(skillId) ?? 0);
            }
            if (!skill.isBuiltin) {
                score += 1_000;
            }
            if (isDomainRelevantSkill(skill, domain)) {
                score += 600;
            }
            return {
                skillId,
                score,
            };
        })
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.skillId);
    const slicedIds = scoredIds.slice(0, maxSkills);
    const dependencyCheck = verifyAndDemotePlugins(
        allSkills.map((skill) => ({
            id: skill.manifest.name,
            name: skill.manifest.name,
            enabled: skill.enabled,
            dependencies: skill.manifest.dependencies ?? [],
        })),
    );
    const cycles = detectDependencyCycles(
        allSkills.map((skill) => ({
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
    const explicitSet = new Set(explicit);
    const explicitInstructionBlocks = resolved
        .filter((skill) => explicitSet.has(skill.manifest.name))
        .map((skill) => ({
            name: skill.manifest.name,
            content: readSkillInstructionContent(skill as unknown as { manifest: Record<string, unknown> }),
        }))
        .filter((entry): entry is { name: string; content: string } => Boolean(entry.content));
    if (explicitInstructionBlocks.length > 0) {
        lines.push('', '[Explicit Skill Instructions]');
        for (const block of explicitInstructionBlocks) {
            lines.push(`Skill: ${block.name}`);
            lines.push(block.content);
        }
    }
    const criticalSkillIds = new Set(
        (AUTO_CRITICAL_SKILL_IDS_BY_DOMAIN[domain] ?? [])
            .map((skillId) => skillId.trim().toLowerCase())
            .filter((skillId) => skillId.length > 0),
    );
    const autoCriticalInstructionBlocks = resolved
        .filter((skill) => criticalSkillIds.has(skill.manifest.name.trim().toLowerCase()))
        .filter((skill) => !explicitSet.has(skill.manifest.name))
        .map((skill) => ({
            name: skill.manifest.name,
            content: readSkillInstructionContent(
                skill as unknown as { manifest: Record<string, unknown> },
                AUTO_CRITICAL_SKILL_CONTENT_MAX_CHARS,
            ),
        }))
        .filter((entry): entry is { name: string; content: string } => Boolean(entry.content));
    if (autoCriticalInstructionBlocks.length > 0) {
        lines.push('', '[Critical Skill Instructions]');
        lines.push('These mandatory domain rules must be followed for this request:');
        for (const block of autoCriticalInstructionBlocks) {
            lines.push(`Skill: ${block.name}`);
            lines.push(block.content);
        }
    }

    return {
        prompt: lines.join('\n'),
        enabledSkillIds: resolved.map((skill) => skill.manifest.name),
    };
}
