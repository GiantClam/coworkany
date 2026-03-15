import { invoke } from '@tauri-apps/api/core';
import type { SkillRecord } from '../hooks/useSkills';
import { deleteConfig, getConfig, saveConfig } from './configStore';
import { safeTauriCall } from './tauri';

const SKILL_CREDENTIALS_KEY = 'skills.credentials';

export type SkillCredentials = Record<string, string>;
type SkillCredentialStore = Record<string, SkillCredentials>;

type SkillWithRequirements = Pick<SkillRecord, 'enabled' | 'manifest'>;

function normalizeCredentials(values: SkillCredentials): SkillCredentials {
    return Object.fromEntries(
        Object.entries(values)
            .map(([key, value]) => [key.trim(), value.trim()])
            .filter(([key, value]) => key.length > 0 && value.length > 0)
    );
}

export function getRequiredSkillEnvVars(skill: Pick<SkillRecord, 'manifest'>): string[] {
    const envVars = skill.manifest.requires?.env;
    if (!Array.isArray(envVars)) {
        return [];
    }

    return envVars
        .map((envVar) => envVar.trim())
        .filter((envVar, index, list) => envVar.length > 0 && list.indexOf(envVar) === index);
}

export async function getAllSkillCredentials(): Promise<SkillCredentialStore> {
    return (await getConfig<SkillCredentialStore>(SKILL_CREDENTIALS_KEY)) ?? {};
}

export async function getSkillCredentials(skillId: string): Promise<SkillCredentials> {
    const all = await getAllSkillCredentials();
    return all[skillId] ?? {};
}

export async function saveSkillCredentials(skillId: string, values: SkillCredentials): Promise<void> {
    const all = await getAllSkillCredentials();
    const normalized = normalizeCredentials(values);

    if (Object.keys(normalized).length === 0) {
        delete all[skillId];
    } else {
        all[skillId] = normalized;
    }

    if (Object.keys(all).length === 0) {
        await deleteConfig(SKILL_CREDENTIALS_KEY);
        return;
    }

    await saveConfig(SKILL_CREDENTIALS_KEY, all);
}

export async function deleteSkillCredentials(skillId: string): Promise<void> {
    const all = await getAllSkillCredentials();
    if (!(skillId in all)) {
        return;
    }

    delete all[skillId];
    if (Object.keys(all).length === 0) {
        await deleteConfig(SKILL_CREDENTIALS_KEY);
        return;
    }

    await saveConfig(SKILL_CREDENTIALS_KEY, all);
}

export async function syncEnabledSkillEnvironment(skills: SkillWithRequirements[]): Promise<void> {
    const all = await getAllSkillCredentials();
    const env: Record<string, string> = {};

    for (const skill of skills) {
        if (!skill.enabled) {
            continue;
        }

        const credentials = all[skill.manifest.id] ?? {};
        for (const envVar of getRequiredSkillEnvVars(skill)) {
            const value = credentials[envVar]?.trim();
            if (value) {
                env[envVar] = value;
            }
        }
    }

    await safeTauriCall(
        () => invoke('sync_skill_environment', { input: { env } }),
        undefined,
        'sync_skill_environment'
    );
}
