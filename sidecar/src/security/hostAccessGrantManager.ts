import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { EffectRequest } from '../protocol';
import type { HostAccessOperation } from '../orchestration/localWorkflowRegistry';

export type HostAccessGrantScope = 'session' | 'persistent';
export type BinaryAccessGrantScope = 'session' | 'persistent';

export type HostAccessGrant = {
    id: string;
    resolvedPath: string;
    access: HostAccessOperation[];
    scope: HostAccessGrantScope;
    createdAt: string;
    expiresAt?: string;
};

export type BinaryAccessGrant = {
    id: string;
    binaryName: string;
    binaryPath?: string;
    allowedArgPatterns: string[];
    scope: BinaryAccessGrantScope;
    createdAt: string;
    expiresAt?: string;
};

type PersistedHostAccessGrant = HostAccessGrant & {
    scope: 'persistent';
};
type PersistedBinaryAccessGrant = BinaryAccessGrant & {
    scope: 'persistent';
};

export class HostAccessGrantManager {
    private readonly sessionGrants = new Map<string, HostAccessGrant>();
    private readonly sessionBinaryGrants = new Map<string, BinaryAccessGrant>();
    private readonly binaryFilePath: string;

    constructor(
        private readonly filePath: string,
        binaryFilePath?: string,
    ) {
        this.binaryFilePath = binaryFilePath ?? deriveBinaryGrantFilePath(filePath);
    }

    hasGrant(input: { targetPath: string; access: HostAccessOperation[] }): boolean {
        const targetPath = path.resolve(input.targetPath);
        const grants = [...this.sessionGrants.values(), ...this.readPersistent()];

        return grants.some((grant) => {
            if (!this.isGrantActive(grant)) {
                return false;
            }

            const grantPath = path.resolve(grant.resolvedPath);
            const pathMatches = targetPath === grantPath || targetPath.startsWith(`${grantPath}${path.sep}`);
            const accessMatches = input.access.every((required) => grant.access.includes(required));
            return pathMatches && accessMatches;
        });
    }

    recordGrant(input: {
        targetPath: string;
        access: HostAccessOperation[];
        scope: HostAccessGrantScope;
        expiresAt?: string;
    }): HostAccessGrant {
        const grant: HostAccessGrant = {
            id: randomUUID(),
            resolvedPath: path.resolve(input.targetPath),
            access: Array.from(new Set(input.access)),
            scope: input.scope,
            createdAt: new Date().toISOString(),
            expiresAt: input.expiresAt,
        };

        if (grant.scope === 'persistent') {
            const persisted = this.readPersistent();
            persisted.push(grant as PersistedHostAccessGrant);
            this.writePersistent(persisted);
        } else {
            this.sessionGrants.set(grant.id, grant);
        }

        return grant;
    }

    hasBinaryGrant(input: {
        binaryPath: string;
        command?: string;
    }): boolean {
        const candidate = normalizeBinaryName(input.binaryPath);
        if (!candidate) {
            return false;
        }

        const grants = [...this.sessionBinaryGrants.values(), ...this.readPersistentBinary()];
        return grants.some((grant) => {
            if (!this.isGrantActive(grant)) {
                return false;
            }

            if (grant.binaryName !== candidate) {
                return false;
            }

            if (grant.allowedArgPatterns.length === 0) {
                return true;
            }

            if (!input.command) {
                return false;
            }

            return grant.allowedArgPatterns.some((patternSource) => {
                try {
                    return new RegExp(patternSource).test(input.command!);
                } catch {
                    return false;
                }
            });
        });
    }

    recordBinaryGrant(input: {
        binaryPath: string;
        allowedArgPatterns?: string[];
        scope: BinaryAccessGrantScope;
        expiresAt?: string;
    }): BinaryAccessGrant {
        const binaryName = normalizeBinaryName(input.binaryPath);
        if (!binaryName) {
            throw new Error('binaryPath is required');
        }

        const grant: BinaryAccessGrant = {
            id: randomUUID(),
            binaryName,
            binaryPath: input.binaryPath,
            allowedArgPatterns: Array.from(new Set((input.allowedArgPatterns ?? []).filter(Boolean))),
            scope: input.scope,
            createdAt: new Date().toISOString(),
            expiresAt: input.expiresAt,
        };

        if (grant.scope === 'persistent') {
            const persisted = this.readPersistentBinary();
            persisted.push(grant as PersistedBinaryAccessGrant);
            this.writePersistentBinary(persisted);
        } else {
            this.sessionBinaryGrants.set(grant.id, grant);
        }

        return grant;
    }

    private ensureDirectory(): void {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }

    private isGrantActive(grant: HostAccessGrant): boolean {
        return !grant.expiresAt || new Date(grant.expiresAt).getTime() > Date.now();
    }

    private readPersistent(): PersistedHostAccessGrant[] {
        try {
            if (!fs.existsSync(this.filePath)) {
                return [];
            }

            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
            if (!Array.isArray(raw)) {
                return [];
            }

            return raw.filter((item): item is PersistedHostAccessGrant => {
                if (!item || typeof item !== 'object') {
                    return false;
                }

                const candidate = item as Partial<PersistedHostAccessGrant>;
                return (
                    typeof candidate.id === 'string' &&
                    typeof candidate.resolvedPath === 'string' &&
                    Array.isArray(candidate.access) &&
                    candidate.scope === 'persistent' &&
                    typeof candidate.createdAt === 'string'
                );
            });
        } catch (error) {
            console.error('[HostAccessGrantManager] Failed to read persistent grants:', error);
            return [];
        }
    }

    private writePersistent(grants: PersistedHostAccessGrant[]): void {
        this.ensureDirectory();
        fs.writeFileSync(this.filePath, JSON.stringify(grants, null, 2), 'utf-8');
    }

    private readPersistentBinary(): PersistedBinaryAccessGrant[] {
        try {
            if (!fs.existsSync(this.binaryFilePath)) {
                return [];
            }

            const raw = JSON.parse(fs.readFileSync(this.binaryFilePath, 'utf-8'));
            if (!Array.isArray(raw)) {
                return [];
            }

            return raw.filter((item): item is PersistedBinaryAccessGrant => {
                if (!item || typeof item !== 'object') {
                    return false;
                }

                const candidate = item as Partial<PersistedBinaryAccessGrant>;
                return (
                    typeof candidate.id === 'string' &&
                    typeof candidate.binaryName === 'string' &&
                    Array.isArray(candidate.allowedArgPatterns) &&
                    candidate.scope === 'persistent' &&
                    typeof candidate.createdAt === 'string'
                );
            });
        } catch (error) {
            console.error('[HostAccessGrantManager] Failed to read persistent binary grants:', error);
            return [];
        }
    }

    private writePersistentBinary(grants: PersistedBinaryAccessGrant[]): void {
        this.ensureDirectory();
        fs.writeFileSync(this.binaryFilePath, JSON.stringify(grants, null, 2), 'utf-8');
    }
}

export function deriveHostAccessRequest(effectRequest: EffectRequest | null): {
    targetPath: string;
    access: HostAccessOperation[];
} | null {
    if (!effectRequest?.payload.path) {
        return null;
    }

    switch (effectRequest.effectType) {
        case 'filesystem:read':
            return {
                targetPath: effectRequest.payload.path,
                access: ['read'],
            };
        case 'filesystem:write':
            return {
                targetPath: effectRequest.payload.path,
                access: effectRequest.payload.operation === 'delete' ? ['delete'] : ['write'],
            };
        default:
            return null;
    }
}

export function deriveBinaryAccessRequest(effectRequest: EffectRequest | null): {
    binaryPath: string;
    commandPattern: string;
} | null {
    if (effectRequest?.effectType !== 'shell:write') {
        return null;
    }

    const command = typeof effectRequest.payload.command === 'string'
        ? effectRequest.payload.command.trim()
        : '';
    if (!command) {
        return null;
    }

    const binary = extractCommandBinary(command);
    if (!binary) {
        return null;
    }

    return {
        binaryPath: binary,
        commandPattern: `^\\s*${escapeRegex(command)}\\s*$`,
    };
}

function deriveBinaryGrantFilePath(filePath: string): string {
    const extension = path.extname(filePath);
    if (!extension) {
        return `${filePath}.binaries`;
    }
    const base = filePath.slice(0, -extension.length);
    return `${base}.binaries${extension}`;
}

function normalizeBinaryName(binaryPath: string): string {
    const normalized = binaryPath.trim().replace(/\\/g, '/');
    if (!normalized) {
        return '';
    }
    const basename = normalized.split('/').filter(Boolean).pop() ?? normalized;
    return basename.toLowerCase();
}

function extractCommandBinary(command: string): string | null {
    const trimmed = command.trim();
    if (!trimmed) {
        return null;
    }

    if (trimmed.startsWith('"')) {
        const end = trimmed.indexOf('"', 1);
        if (end <= 1) {
            return null;
        }
        return trimmed.slice(1, end);
    }

    if (trimmed.startsWith("'")) {
        const end = trimmed.indexOf("'", 1);
        if (end <= 1) {
            return null;
        }
        return trimmed.slice(1, end);
    }

    const token = trimmed.split(/\s+/)[0];
    return token ? token.trim() : null;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
