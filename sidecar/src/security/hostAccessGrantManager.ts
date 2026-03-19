import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { EffectRequest } from '../protocol';
import type { HostAccessOperation } from '../orchestration/localWorkflowRegistry';

export type HostAccessGrantScope = 'session' | 'persistent';

export type HostAccessGrant = {
    id: string;
    resolvedPath: string;
    access: HostAccessOperation[];
    scope: HostAccessGrantScope;
    createdAt: string;
    expiresAt?: string;
};

type PersistedHostAccessGrant = HostAccessGrant & {
    scope: 'persistent';
};

export class HostAccessGrantManager {
    private readonly sessionGrants = new Map<string, HostAccessGrant>();

    constructor(private readonly filePath: string) {}

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
