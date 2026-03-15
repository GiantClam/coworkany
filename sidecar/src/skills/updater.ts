import * as fs from 'fs';
import * as path from 'path';
import { downloadFromGitHub } from '../utils';
import { SkillStore, type ClaudeSkillManifest, type StoredSkill } from '../storage/skillStore';
import { buildGitHubSkillSource, resolveSkillUpstream, type SkillUpstreamSpec } from './upstreamCatalog';

export interface ClaudeSkillUpdateInfo {
    skillId: string;
    supported: boolean;
    hasUpdate: boolean;
    currentVersion?: string;
    latestVersion?: string;
    sourceRepo?: string;
    sourcePath?: string;
    sourceRef?: string;
    checkedAt: string;
    error?: string;
}

export interface UpgradeClaudeSkillResult {
    success: boolean;
    skillId: string;
    skill?: StoredSkill;
    update: ClaudeSkillUpdateInfo;
    error?: string;
}

function rawSkillUrl(spec: SkillUpstreamSpec): string {
    return `https://raw.githubusercontent.com/${spec.repo}/${spec.ref}/${spec.repoPath}/SKILL.md`;
}

function createBaseUpdate(
    skillId: string,
    spec: SkillUpstreamSpec | null,
    currentVersion?: string
): ClaudeSkillUpdateInfo {
    return {
        skillId,
        supported: Boolean(spec),
        hasUpdate: false,
        currentVersion,
        sourceRepo: spec?.repo,
        sourcePath: spec?.repoPath,
        sourceRef: spec?.ref,
        checkedAt: new Date().toISOString(),
    };
}

function versionsDiffer(currentVersion?: string, latestVersion?: string): boolean {
    const current = currentVersion?.trim();
    const latest = latestVersion?.trim();
    if (!current || !latest) {
        return false;
    }
    return current !== latest;
}

async function fetchRemoteManifest(spec: SkillUpstreamSpec): Promise<ClaudeSkillManifest> {
    const response = await fetch(rawSkillUrl(spec), {
        headers: {
            'User-Agent': 'CoworkAny-Sidecar',
            'Accept': 'text/plain',
        },
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch upstream SKILL.md (${response.status} ${response.statusText})`);
    }

    const content = await response.text();
    const manifest = SkillStore.parseSkillMd(spec.name, spec.repoPath, content);
    if (!manifest) {
        throw new Error('Upstream SKILL.md is invalid');
    }

    return manifest;
}

export async function checkSkillForUpdates(skill: StoredSkill): Promise<ClaudeSkillUpdateInfo> {
    const spec = resolveSkillUpstream(skill.manifest.name);
    const base = createBaseUpdate(skill.manifest.name, spec, skill.manifest.version);

    if (skill.isBuiltin) {
        return {
            ...base,
            supported: false,
            error: 'builtin_skills_are_not_upgradeable',
        };
    }

    if (!spec) {
        return {
            ...base,
            error: 'no_known_upstream',
        };
    }

    try {
        const remote = await fetchRemoteManifest(spec);
        return {
            ...base,
            latestVersion: remote.version,
            hasUpdate: versionsDiffer(skill.manifest.version, remote.version),
        };
    } catch (error) {
        return {
            ...base,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function checkSkillsForUpdates(skills: StoredSkill[]): Promise<ClaudeSkillUpdateInfo[]> {
    return Promise.all(skills.map((skill) => checkSkillForUpdates(skill)));
}

function cleanupDirectory(targetPath: string): void {
    if (!fs.existsSync(targetPath)) {
        return;
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
}

async function downloadLatestSkillVersion(spec: SkillUpstreamSpec, tempDir: string) {
    const source = buildGitHubSkillSource(spec);
    const result = await downloadFromGitHub(source, tempDir, { branch: spec.ref });
    if (!result.success) {
        throw new Error(result.error ?? 'Failed to download upstream skill');
    }
}

export async function upgradeSkillFromUpstream(
    skillStore: SkillStore,
    skillId: string
): Promise<UpgradeClaudeSkillResult> {
    const existing = skillStore.get(skillId);
    if (!existing) {
        return {
            success: false,
            skillId,
            update: createBaseUpdate(skillId, null),
            error: 'skill_not_found',
        };
    }

    const initialUpdate = await checkSkillForUpdates(existing);
    if (!initialUpdate.supported) {
        return {
            success: false,
            skillId,
            update: initialUpdate,
            error: initialUpdate.error ?? 'unsupported_skill',
        };
    }

    if (initialUpdate.error) {
        return {
            success: false,
            skillId,
            update: initialUpdate,
            error: initialUpdate.error,
        };
    }

    const spec = resolveSkillUpstream(existing.manifest.name);
    if (!spec) {
        return {
            success: false,
            skillId,
            update: initialUpdate,
            error: 'no_known_upstream',
        };
    }

    const targetDir = existing.manifest.directory;
    const parentDir = path.dirname(targetDir);
    const tempDir = path.join(parentDir, `.${path.basename(targetDir)}.upgrade-${Date.now()}`);

    try {
        fs.mkdirSync(parentDir, { recursive: true });
        cleanupDirectory(tempDir);
        await downloadLatestSkillVersion(spec, tempDir);

        const downloadedManifest = SkillStore.loadFromDirectory(tempDir);
        if (!downloadedManifest) {
            throw new Error('Downloaded skill is missing SKILL.md');
        }

        cleanupDirectory(targetDir);
        fs.renameSync(tempDir, targetDir);

        const installedManifest = SkillStore.loadFromDirectory(targetDir);
        if (!installedManifest) {
            throw new Error('Installed skill is missing SKILL.md after upgrade');
        }

        skillStore.install(installedManifest);
        const nextSkill = skillStore.get(skillId);
        if (!nextSkill) {
            throw new Error('Skill could not be reloaded after upgrade');
        }

        return {
            success: true,
            skillId,
            skill: nextSkill,
            update: await checkSkillForUpdates(nextSkill),
        };
    } catch (error) {
        cleanupDirectory(tempDir);
        return {
            success: false,
            skillId,
            update: {
                ...initialUpdate,
                checkedAt: new Date().toISOString(),
                error: error instanceof Error ? error.message : String(error),
            },
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
