import { describe, expect, test } from 'bun:test';
import { getMastraHealth } from '../src/mastra';

describe('mastra health', () => {
    test('reports loaded mastra package versions for runtime observability', () => {
        const health = getMastraHealth();
        expect(Array.isArray(health.agents)).toBe(true);
        expect(Array.isArray(health.workflows)).toBe(true);
        expect(typeof health.storageConfigured).toBe('boolean');
        expect(health.mastraPackages).toBeDefined();
        expect(typeof health.mastraPackages.core).toBe('string');
        expect(typeof health.mastraPackages.memory).toBe('string');
        expect(typeof health.mastraPackages.mcp).toBe('string');
    });
});
