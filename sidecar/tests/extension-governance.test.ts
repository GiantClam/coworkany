import { describe, expect, test } from 'bun:test';
import {
    buildExtensionGovernanceReview,
    summarizeSkillPermissions,
    summarizeToolpackPermissions,
} from '../src/extensions/governance';

describe('extension governance', () => {
    test('marks first install for review without blocking', () => {
        const review = buildExtensionGovernanceReview({
            extensionType: 'skill',
            extensionId: 'demo-skill',
            next: summarizeSkillPermissions({
                allowedTools: ['Read', 'Write'],
                requires: { tools: [], capabilities: ['filesystem:write'], bins: [], env: [], config: [] },
            } as any),
            blockOnPermissionExpansion: true,
        });

        expect(review.reviewRequired).toBe(true);
        expect(review.blocking).toBe(false);
        expect(review.reason).toBe('first_install_review');
        expect(review.installKind).toBe('first_install');
    });

    test('blocks updates when permissions expand and approval is absent', () => {
        const review = buildExtensionGovernanceReview({
            extensionType: 'toolpack',
            extensionId: 'demo-pack',
            previous: summarizeToolpackPermissions({
                tools: ['read_file'],
                effects: ['filesystem:read'],
            } as any),
            next: summarizeToolpackPermissions({
                tools: ['read_file', 'write_file'],
                effects: ['filesystem:read', 'network:outbound'],
            } as any),
            blockOnPermissionExpansion: true,
        });

        expect(review.installKind).toBe('update');
        expect(review.reviewRequired).toBe(true);
        expect(review.blocking).toBe(true);
        expect(review.reason).toBe('permission_expansion');
        expect(review.delta?.added.tools).toContain('write_file');
        expect(review.delta?.added.effects).toContain('network:outbound');
    });

    test('allows updates when no permission expansion exists', () => {
        const review = buildExtensionGovernanceReview({
            extensionType: 'toolpack',
            extensionId: 'stable-pack',
            previous: summarizeToolpackPermissions({
                tools: ['read_file'],
                effects: ['filesystem:read'],
            } as any),
            next: summarizeToolpackPermissions({
                tools: ['read_file'],
                effects: ['filesystem:read'],
            } as any),
            blockOnPermissionExpansion: true,
        });

        expect(review.reviewRequired).toBe(false);
        expect(review.blocking).toBe(false);
        expect(review.reason).toBe('none');
    });
});
