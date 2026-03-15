import * as fs from 'fs';
import * as path from 'path';

import {
    openclawCompat,
    type ClawHubSkillInfo,
    type OpenClawStore,
    type TencentSkillHubSkillInfo,
} from '../claude_skills/openclawCompat';
import { SkillStore, type ClaudeSkillManifest, type StoredSkill } from '../storage';
import { downloadSkillFromGitHub, scanDefaultRepositories, type DiscoveredSkill } from '../utils';

const MAX_SKILL_INSTRUCTIONS_CHARS = 12_000;
const MIN_CONFIDENT_MATCH_SCORE = 10;
const SKILL_REQUEST_STOPWORDS = new Set([
    'a',
    'an',
    'add',
    'and',
    'build',
    'call',
    'create',
    'download',
    'for',
    'help',
    'i',
    'install',
    'invoke',
    'me',
    'new',
    'please',
    'skill',
    'skills',
    'the',
    'to',
    'use',
]);

type MatchSource = 'local' | 'github' | OpenClawStore;

export interface ResolvedSkillDescriptor {
    name: string;
    description: string;
    source: MatchSource;
    directory?: string;
    enabled?: boolean;
    sourceRef?: string;
    instructions?: string;
    requiredEnv?: string[];
}

export interface SkillResolutionCandidate {
    name: string;
    description: string;
    source: MatchSource;
    sourceRef: string;
    score: number;
}

export interface SkillResolutionResult {
    success: boolean;
    query: string;
    normalizedQuery: string;
    resolution: 'local' | 'installed_from_market' | 'create_new';
    should_create: boolean;
    skill?: ResolvedSkillDescriptor;
    candidates: SkillResolutionCandidate[];
    searched: {
        local: number;
        github: number;
        clawhub: number;
        tencent_skillhub: number;
    };
    install_attempts?: Array<{
        source: MatchSource;
        sourceRef: string;
        success: boolean;
        error?: string;
    }>;
}

interface StoredSkillMatch {
    record: StoredSkill;
    score: number;
}

interface DiscoveredSkillMatch {
    skill: DiscoveredSkill;
    score: number;
}

interface ClawHubSkillMatch {
    skill: ClawHubSkillInfo;
    score: number;
}

interface TencentSkillHubSkillMatch {
    skill: TencentSkillHubSkillInfo;
    score: number;
}

interface ResolveSkillRequestOptions {
    query: string;
    workspacePath: string;
    skillStore: SkillStore;
    autoInstall?: boolean;
    limit?: number;
}

export function normalizeSkillRequestQuery(rawQuery: string): string {
    const tokens = tokenize(rawQuery).filter((token) => !SKILL_REQUEST_STOPWORDS.has(token));
    if (tokens.length > 0) {
        return tokens.join(' ');
    }
    return rawQuery.trim().toLowerCase();
}

export function searchInstalledSkills(
    query: string,
    skills: StoredSkill[],
    limit: number = 5
): StoredSkillMatch[] {
    const normalizedQuery = normalizeSkillRequestQuery(query);
    const tokens = tokenize(normalizedQuery);

    return skills
        .map((record) => ({
            record,
            score: scoreSkill(
                normalizedQuery,
                tokens,
                record.manifest.name,
                record.manifest.description,
                record.manifest.tags ?? [],
                record.manifest.triggers ?? []
            ),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.record.manifest.name.localeCompare(b.record.manifest.name))
        .slice(0, Math.max(1, limit));
}

export async function resolveSkillRequest(
    options: ResolveSkillRequestOptions
): Promise<SkillResolutionResult> {
    const query = options.query.trim();
    const normalizedQuery = normalizeSkillRequestQuery(query);
    const limit = Math.max(1, options.limit ?? 5);
    const autoInstall = options.autoInstall !== false;
    const localMatches = searchInstalledSkills(query, options.skillStore.list(), limit);

    if (localMatches[0] && localMatches[0].score >= MIN_CONFIDENT_MATCH_SCORE) {
        const bestLocal = localMatches[0].record;
        if (!bestLocal.enabled) {
            options.skillStore.setEnabled(bestLocal.manifest.name, true);
        }

        return {
            success: true,
            query,
            normalizedQuery,
            resolution: 'local',
            should_create: false,
            skill: buildResolvedSkill(bestLocal.manifest, 'local', undefined, true),
            candidates: localMatches.map((match) => ({
                name: match.record.manifest.name,
                description: match.record.manifest.description,
                source: 'local',
                sourceRef: match.record.manifest.name,
                score: match.score,
            })),
            searched: {
                local: localMatches.length,
                github: 0,
                clawhub: 0,
                tencent_skillhub: 0,
            },
        };
    }

    const [githubScan, clawhubSkills, tencentSkillHubSkills] = await Promise.all([
        scanDefaultRepositories().catch((error) => {
            console.error('[SkillResolver] GitHub scan failed:', error);
            return { skills: [], mcpServers: [], errors: [String(error)] };
        }),
        openclawCompat.searchClawHub(normalizedQuery || query, limit).catch((error) => {
            console.error('[SkillResolver] ClawHub search failed:', error);
            return [] as ClawHubSkillInfo[];
        }),
        openclawCompat.searchTencentSkillHub(normalizedQuery || query, limit).catch((error) => {
            console.error('[SkillResolver] Tencent SkillHub search failed:', error);
            return [] as TencentSkillHubSkillInfo[];
        }),
    ]);

    const githubMatches = rankDiscoveredSkills(query, githubScan.skills, limit);
    const clawhubMatches = rankClawHubSkills(query, clawhubSkills, limit);
    const tencentSkillHubMatches = rankTencentSkillHubSkills(query, tencentSkillHubSkills, limit);
    const allCandidates: SkillResolutionCandidate[] = [
        ...githubMatches.map((match) => ({
            name: match.skill.name,
            description: match.skill.description,
            source: 'github' as const,
            sourceRef: match.skill.source,
            score: match.score,
        })),
        ...clawhubMatches.map((match) => ({
            name: match.skill.displayName || match.skill.name,
            description: match.skill.description,
            source: 'clawhub' as const,
            sourceRef: match.skill.slug || match.skill.name,
            score: match.score,
        })),
        ...tencentSkillHubMatches.map((match) => ({
            name: match.skill.displayName || match.skill.name,
            description: match.skill.description,
            source: 'tencent_skillhub' as const,
            sourceRef: match.skill.slug || match.skill.name,
            score: match.score,
        })),
    ]
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, limit);

    if (!autoInstall || allCandidates.length === 0 || allCandidates[0].score < MIN_CONFIDENT_MATCH_SCORE) {
        return {
            success: true,
            query,
            normalizedQuery,
            resolution: 'create_new',
            should_create: true,
            candidates: allCandidates,
            searched: {
                local: localMatches.length,
                github: githubMatches.length,
                clawhub: clawhubMatches.length,
                tencent_skillhub: tencentSkillHubMatches.length,
            },
        };
    }

    const installAttempts: SkillResolutionResult['install_attempts'] = [];
    const skillsRoot = path.join(options.workspacePath, '.coworkany', 'skills');
    fs.mkdirSync(skillsRoot, { recursive: true });

    for (const candidate of allCandidates) {
        if (candidate.source === 'github') {
            const installResult = await downloadSkillFromGitHub(candidate.sourceRef, options.workspacePath);
            installAttempts.push({
                source: 'github',
                sourceRef: candidate.sourceRef,
                success: installResult.success,
                error: installResult.error,
            });
            if (!installResult.success) {
                continue;
            }

            const manifest = SkillStore.loadFromDirectory(installResult.path);
            if (!manifest) {
                installAttempts.push({
                    source: 'github',
                    sourceRef: candidate.sourceRef,
                    success: false,
                    error: 'missing_skill_manifest',
                });
                continue;
            }

            options.skillStore.install(manifest);
            return {
                success: true,
                query,
                normalizedQuery,
                resolution: 'installed_from_market',
                should_create: false,
                skill: buildResolvedSkill(manifest, 'github', candidate.sourceRef, true),
                candidates: allCandidates,
                searched: {
                    local: localMatches.length,
                    github: githubMatches.length,
                    clawhub: clawhubMatches.length,
                    tencent_skillhub: tencentSkillHubMatches.length,
                },
                install_attempts: installAttempts,
            };
        }

        const installResult = await openclawCompat.installFromStore(
            candidate.source as OpenClawStore,
            candidate.sourceRef,
            skillsRoot
        );
        installAttempts.push({
            source: candidate.source,
            sourceRef: candidate.sourceRef,
            success: installResult.success,
            error: installResult.error,
        });
        if (!installResult.success || !installResult.path) {
            continue;
        }

        const manifest = SkillStore.loadFromDirectory(installResult.path);
        if (!manifest) {
            installAttempts.push({
                source: candidate.source,
                sourceRef: candidate.sourceRef,
                success: false,
                error: 'missing_skill_manifest',
            });
            continue;
        }

        options.skillStore.install(manifest);
        return {
            success: true,
            query,
            normalizedQuery,
            resolution: 'installed_from_market',
            should_create: false,
            skill: buildResolvedSkill(manifest, candidate.source, candidate.sourceRef, true),
            candidates: allCandidates,
            searched: {
                local: localMatches.length,
                github: githubMatches.length,
                clawhub: clawhubMatches.length,
                tencent_skillhub: tencentSkillHubMatches.length,
            },
            install_attempts: installAttempts,
        };
    }

    return {
        success: true,
        query,
        normalizedQuery,
        resolution: 'create_new',
        should_create: true,
        candidates: allCandidates,
        searched: {
            local: localMatches.length,
            github: githubMatches.length,
            clawhub: clawhubMatches.length,
            tencent_skillhub: tencentSkillHubMatches.length,
        },
        install_attempts: installAttempts,
    };
}

function rankDiscoveredSkills(query: string, skills: DiscoveredSkill[], limit: number): DiscoveredSkillMatch[] {
    const normalizedQuery = normalizeSkillRequestQuery(query);
    const tokens = tokenize(normalizedQuery);

    return skills
        .map((skill) => ({
            skill,
            score: scoreSkill(
                normalizedQuery,
                tokens,
                skill.name,
                skill.description,
                [skill.runtime ?? '', skill.path],
                [skill.source]
            ),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
        .slice(0, limit);
}

function rankClawHubSkills(query: string, skills: ClawHubSkillInfo[], limit: number): ClawHubSkillMatch[] {
    const normalizedQuery = normalizeSkillRequestQuery(query);
    const tokens = tokenize(normalizedQuery);

    return skills
        .map((skill) => ({
            skill,
            score: scoreSkill(
                normalizedQuery,
                tokens,
                skill.displayName || skill.name || '',
                skill.description,
                skill.tags ?? [],
                [skill.slug ?? '', skill.repoUrl ?? '']
            ),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || (a.skill.name || '').localeCompare(b.skill.name || ''))
        .slice(0, limit);
}

function rankTencentSkillHubSkills(
    query: string,
    skills: TencentSkillHubSkillInfo[],
    limit: number
): TencentSkillHubSkillMatch[] {
    const normalizedQuery = normalizeSkillRequestQuery(query);
    const tokens = tokenize(normalizedQuery);

    return skills
        .map((skill) => ({
            skill,
            score: scoreSkill(
                normalizedQuery,
                tokens,
                skill.displayName || skill.name || '',
                skill.description,
                skill.tags ?? [],
                [skill.slug ?? '', skill.homepage ?? '', skill.author ?? '']
            ),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || (a.skill.name || '').localeCompare(b.skill.name || ''))
        .slice(0, limit);
}

function buildResolvedSkill(
    manifest: ClaudeSkillManifest,
    source: MatchSource,
    sourceRef?: string,
    enabled?: boolean
): ResolvedSkillDescriptor {
    return {
        name: manifest.name,
        description: manifest.description,
        source,
        directory: manifest.directory,
        enabled,
        sourceRef,
        instructions: readSkillInstructions(manifest),
        requiredEnv: manifest.requires?.env ?? [],
    };
}

function readSkillInstructions(manifest: ClaudeSkillManifest): string | undefined {
    const embedded = (manifest as ClaudeSkillManifest & { content?: string }).content;
    if (typeof embedded === 'string' && embedded.trim()) {
        return embedded.trim().slice(0, MAX_SKILL_INSTRUCTIONS_CHARS);
    }

    if (!manifest.directory) {
        return undefined;
    }

    const skillMdPath = path.join(manifest.directory, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
        return undefined;
    }

    return fs.readFileSync(skillMdPath, 'utf-8').trim().slice(0, MAX_SKILL_INSTRUCTIONS_CHARS);
}

function scoreSkill(
    normalizedQuery: string,
    tokens: string[],
    name: string,
    description: string,
    tags: string[],
    triggers: string[]
): number {
    return (
        scoreField(name, normalizedQuery, tokens, 30, 10) +
        scoreField(description, normalizedQuery, tokens, 10, 4) +
        tags.reduce((sum, tag) => sum + scoreField(tag, normalizedQuery, tokens, 8, 4), 0) +
        triggers.reduce((sum, trigger) => sum + scoreField(trigger, normalizedQuery, tokens, 8, 4), 0)
    );
}

function scoreField(
    value: string,
    normalizedQuery: string,
    tokens: string[],
    exactWeight: number,
    tokenWeight: number
): number {
    if (!value) {
        return 0;
    }

    const lower = value.toLowerCase();
    let score = 0;

    if (normalizedQuery && lower.includes(normalizedQuery)) {
        score += exactWeight;
    }

    for (const token of tokens) {
        if (token.length === 1 && !/^\d+$/.test(token)) {
            continue;
        }
        if (/^\d+$/.test(token) && token.length < 3) {
            continue;
        }
        if (lower.includes(token)) {
            score += tokenWeight;
        }
    }

    return score;
}

function tokenize(value: string): string[] {
    return (value.toLowerCase().match(/[a-z0-9\u4e00-\u9fff]+/g) ?? []).filter(Boolean);
}
