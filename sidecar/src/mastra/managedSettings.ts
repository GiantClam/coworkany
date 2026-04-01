import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type ManagedSettingsPayload = {
    policySettings?: Record<string, unknown>;
    extensionAllowlist?: Record<string, unknown>;
    mcpServers?: Array<Record<string, unknown>>;
};

export type ManagedSettingsSyncEntry = {
    id: string;
    at: string;
    action: 'sync' | 'rollback';
    source: string;
    success: boolean;
    settingsPath?: string;
    rollback: {
        policySettingsRaw?: string | null;
        extensionAllowlistRaw?: string | null;
        mcpMutations?: Array<Record<string, unknown>>;
    };
    applied: {
        policySettingsUpdated: boolean;
        extensionAllowlistUpdated: boolean;
        mcpServerCount: number;
    };
    error?: string;
};

type ManagedSettingsEnvelope = {
    entries: ManagedSettingsSyncEntry[];
};

const STORE_FILE_NAME = 'mastra-managed-settings-sync-log.json';

function ensureParent(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function safeReadText(filePath: string): string | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }
}

function safeWriteJson(filePath: string, value: unknown): void {
    ensureParent(filePath);
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf-8');
    fs.renameSync(temp, filePath);
}

export function readManagedSettingsPayload(input: {
    workspaceRoot: string;
    payload: Record<string, unknown>;
}): {
    success: boolean;
    settings?: ManagedSettingsPayload;
    source: string;
    settingsPath?: string;
    error?: string;
} {
    const payloadSettings = input.payload.settings;
    if (payloadSettings && typeof payloadSettings === 'object' && !Array.isArray(payloadSettings)) {
        return {
            success: true,
            settings: payloadSettings as ManagedSettingsPayload,
            source: 'inline_payload',
        };
    }
    const pathFromPayload = typeof input.payload.settingsPath === 'string'
        ? input.payload.settingsPath.trim()
        : '';
    const resolvedPath = pathFromPayload
        ? path.resolve(pathFromPayload)
        : path.join(input.workspaceRoot, '.coworkany', 'managed-settings.json');
    if (!fs.existsSync(resolvedPath)) {
        return {
            success: false,
            source: 'file_path',
            settingsPath: resolvedPath,
            error: 'managed_settings_file_not_found',
        };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {
                success: false,
                source: 'file_path',
                settingsPath: resolvedPath,
                error: 'managed_settings_invalid_json',
            };
        }
        return {
            success: true,
            settings: parsed as ManagedSettingsPayload,
            source: 'file_path',
            settingsPath: resolvedPath,
        };
    } catch {
        return {
            success: false,
            source: 'file_path',
            settingsPath: resolvedPath,
            error: 'managed_settings_invalid_json',
        };
    }
}

export function applyManagedSettingsFiles(input: {
    workspaceRoot: string;
    settings: ManagedSettingsPayload;
}): {
    rollback: {
        policySettingsRaw?: string | null;
        extensionAllowlistRaw?: string | null;
    };
    applied: {
        policySettingsUpdated: boolean;
        extensionAllowlistUpdated: boolean;
    };
} {
    const policyPath = path.join(input.workspaceRoot, '.coworkany', 'policy-settings.json');
    const allowlistPath = path.join(input.workspaceRoot, '.coworkany', 'extension-allowlist.json');
    const rollback = {
        policySettingsRaw: safeReadText(policyPath),
        extensionAllowlistRaw: safeReadText(allowlistPath),
    };
    let policySettingsUpdated = false;
    let extensionAllowlistUpdated = false;
    if (input.settings.policySettings && typeof input.settings.policySettings === 'object') {
        safeWriteJson(policyPath, input.settings.policySettings);
        policySettingsUpdated = true;
    }
    if (input.settings.extensionAllowlist && typeof input.settings.extensionAllowlist === 'object') {
        safeWriteJson(allowlistPath, input.settings.extensionAllowlist);
        extensionAllowlistUpdated = true;
    }
    return {
        rollback,
        applied: {
            policySettingsUpdated,
            extensionAllowlistUpdated,
        },
    };
}

export function restoreManagedSettingsFiles(input: {
    workspaceRoot: string;
    rollback: {
        policySettingsRaw?: string | null;
        extensionAllowlistRaw?: string | null;
    };
}): {
    policySettingsRestored: boolean;
    extensionAllowlistRestored: boolean;
} {
    const policyPath = path.join(input.workspaceRoot, '.coworkany', 'policy-settings.json');
    const allowlistPath = path.join(input.workspaceRoot, '.coworkany', 'extension-allowlist.json');
    const restoreOne = (filePath: string, raw: string | null | undefined): boolean => {
        if (raw === null || raw === undefined) {
            fs.rmSync(filePath, { force: true });
            return true;
        }
        ensureParent(filePath);
        fs.writeFileSync(filePath, raw, 'utf-8');
        return true;
    };
    return {
        policySettingsRestored: restoreOne(policyPath, input.rollback.policySettingsRaw),
        extensionAllowlistRestored: restoreOne(allowlistPath, input.rollback.extensionAllowlistRaw),
    };
}

export class ManagedSettingsSyncStore {
    private readonly storePath: string;
    private readonly entries: ManagedSettingsSyncEntry[] = [];

    constructor(appDataRoot: string) {
        this.storePath = path.join(appDataRoot, STORE_FILE_NAME);
        this.load();
    }

    append(input: Omit<ManagedSettingsSyncEntry, 'id' | 'at'>): ManagedSettingsSyncEntry {
        const entry: ManagedSettingsSyncEntry = {
            id: `managed-settings-sync-${randomUUID()}`,
            at: new Date().toISOString(),
            ...input,
        };
        this.entries.push(entry);
        this.save();
        return entry;
    }

    get(entryId: string): ManagedSettingsSyncEntry | undefined {
        const normalized = entryId.trim();
        if (!normalized) {
            return undefined;
        }
        return this.entries.find((entry) => entry.id === normalized);
    }

    latest(): ManagedSettingsSyncEntry | undefined {
        return this.entries.at(-1);
    }

    list(limit?: number): ManagedSettingsSyncEntry[] {
        const entries = this.entries.slice().sort((left, right) => right.at.localeCompare(left.at));
        if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
            return entries.slice(0, Math.floor(limit));
        }
        return entries;
    }

    private load(): void {
        if (!fs.existsSync(this.storePath)) {
            return;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) as unknown;
            const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as ManagedSettingsEnvelope
                : { entries: [] };
            if (!Array.isArray(envelope.entries)) {
                return;
            }
            for (const rawEntry of envelope.entries) {
                if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
                    continue;
                }
                const entry = rawEntry as ManagedSettingsSyncEntry;
                if (
                    typeof entry.id !== 'string'
                    || typeof entry.at !== 'string'
                    || typeof entry.source !== 'string'
                    || typeof entry.success !== 'boolean'
                ) {
                    continue;
                }
                this.entries.push({
                    ...entry,
                    action: entry.action === 'rollback' ? 'rollback' : 'sync',
                });
            }
        } catch {
            // ignore malformed history file
        }
    }

    private save(): void {
        ensureParent(this.storePath);
        const temp = `${this.storePath}.tmp`;
        const envelope: ManagedSettingsEnvelope = {
            entries: this.entries,
        };
        fs.writeFileSync(temp, JSON.stringify(envelope, null, 2), 'utf-8');
        fs.renameSync(temp, this.storePath);
    }
}
