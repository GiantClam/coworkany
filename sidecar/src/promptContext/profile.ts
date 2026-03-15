import * as fs from 'fs';
import * as path from 'path';

export interface SoulProfile {
    version: number;
    identity?: string;
    stablePreferences?: string[];
    workingStyle?: string[];
    longTermGoals?: string[];
    avoid?: string[];
    outputRules?: string[];
    updatedAt?: string;
}

export interface SessionPromptContext {
    workspacePath?: string;
    activeFile?: string;
    enabledSkillIds?: string[];
    historyCount?: number;
}

const WORKSPACE_POLICY_FILES = [
    '.coworkany/WORKSPACE_POLICY.md',
    'WORKSPACE_POLICY.md',
    'CLAUDE.md',
    'AGENTS.md',
];

function normalizeLines(values?: string[]): string[] {
    return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function limitContent(content: string, maxChars: number): string {
    const normalized = content.trim();
    if (normalized.length <= maxChars) {
        return normalized;
    }
    return `${normalized.slice(0, maxChars).trim()}\n\n[truncated]`;
}

export function defaultSoulProfile(): SoulProfile {
    return {
        version: 1,
        identity: '',
        stablePreferences: [],
        workingStyle: [],
        longTermGoals: [],
        avoid: [],
        outputRules: [],
    };
}

export function loadSoulProfile(appStateRoot: string): SoulProfile {
    const profilePath = path.join(appStateRoot, 'user-profile.json');
    if (!fs.existsSync(profilePath)) {
        return defaultSoulProfile();
    }

    try {
        const raw = fs.readFileSync(profilePath, 'utf-8');
        const parsed = JSON.parse(raw) as SoulProfile;
        return {
            ...defaultSoulProfile(),
            ...parsed,
            version: 1,
            stablePreferences: normalizeLines(parsed.stablePreferences),
            workingStyle: normalizeLines(parsed.workingStyle),
            longTermGoals: normalizeLines(parsed.longTermGoals),
            avoid: normalizeLines(parsed.avoid),
            outputRules: normalizeLines(parsed.outputRules),
        };
    } catch (error) {
        console.error('[SoulProfile] Failed to load user-profile.json:', error);
        return defaultSoulProfile();
    }
}

export function formatSoulSection(profile: SoulProfile): string {
    const lines: string[] = [];
    const identity = profile.identity?.trim();

    if (identity) {
        lines.push('## Soul');
        lines.push('');
        lines.push(identity);
    }

    const sections: Array<[string, string[] | undefined]> = [
        ['Stable Preferences', profile.stablePreferences],
        ['Working Style', profile.workingStyle],
        ['Long-Term Goals', profile.longTermGoals],
        ['Do Not Do', profile.avoid],
        ['Output Rules', profile.outputRules],
    ];

    for (const [title, values] of sections) {
        const normalized = normalizeLines(values);
        if (normalized.length === 0) {
            continue;
        }
        if (lines.length === 0) {
            lines.push('## Soul');
            lines.push('');
        }
        lines.push(`### ${title}`);
        lines.push(...normalized.map((value) => `- ${value}`));
        lines.push('');
    }

    return lines.join('\n').trim();
}

export function loadWorkspacePolicySection(workspaceRootPath?: string, maxChars: number = 6000): string {
    if (!workspaceRootPath) {
        return '';
    }

    const chunks: string[] = [];
    let remaining = maxChars;

    for (const relativePath of WORKSPACE_POLICY_FILES) {
        if (remaining <= 0) {
            break;
        }

        const absolutePath = path.join(workspaceRootPath, relativePath);
        if (!fs.existsSync(absolutePath)) {
            continue;
        }

        try {
            const raw = fs.readFileSync(absolutePath, 'utf-8');
            const limited = limitContent(raw, remaining);
            if (!limited) {
                continue;
            }
            chunks.push(`### ${relativePath}\n${limited}`);
            remaining -= limited.length;
        } catch (error) {
            console.error(`[WorkspacePolicy] Failed to read ${absolutePath}:`, error);
        }
    }

    if (chunks.length === 0) {
        return '';
    }

    return `## Workspace Policy\n\n${chunks.join('\n\n')}`.trim();
}

export function buildCurrentSessionSection(context: SessionPromptContext): string {
    const lines: string[] = [];

    if (context.workspacePath) {
        lines.push(`- Workspace: ${context.workspacePath}`);
    }
    if (context.activeFile) {
        lines.push(`- Active File: ${context.activeFile}`);
    }
    if ((context.enabledSkillIds?.length ?? 0) > 0) {
        lines.push(`- Enabled Skills For This Session: ${context.enabledSkillIds?.join(', ')}`);
    }
    if (typeof context.historyCount === 'number') {
        lines.push(`- Conversation Messages In Context: ${context.historyCount}`);
    }

    if (lines.length === 0) {
        return '';
    }

    return `## Current Session Context\n\n${lines.join('\n')}`;
}
