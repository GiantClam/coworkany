import { describe, expect, test } from 'bun:test';
import { hasGitRemoteHeadMatch } from '../scripts/release-readiness';

describe('release readiness script helpers', () => {
    test('hasGitRemoteHeadMatch returns false for empty ls-remote output', () => {
        expect(hasGitRemoteHeadMatch('')).toBe(false);
        expect(hasGitRemoteHeadMatch('\n\n')).toBe(false);
    });

    test('hasGitRemoteHeadMatch returns true when at least one ref line is present', () => {
        const sample = '2e65efe2a145dda7ee51d1741299f848e5bf752e\trefs/heads/main\n';
        expect(hasGitRemoteHeadMatch(sample)).toBe(true);
    });
});
