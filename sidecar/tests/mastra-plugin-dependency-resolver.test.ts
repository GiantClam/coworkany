import { describe, expect, test } from 'bun:test';
import {
    detectDependencyCycles,
    findReverseDependents,
    verifyAndDemotePlugins,
} from '../src/mastra/pluginDependencyResolver';

describe('mastra plugin dependency resolver', () => {
    test('demotes enabled plugins whose dependencies are missing or disabled', () => {
        const result = verifyAndDemotePlugins([
            {
                id: 'dep-a',
                name: 'dep-a',
                enabled: false,
                dependencies: [],
            },
            {
                id: 'skill-main',
                name: 'skill-main',
                enabled: true,
                dependencies: ['dep-a', 'dep-b'],
            },
        ]);

        expect(result.demoted.has('skill-main')).toBe(true);
        expect(result.errors.some((entry) =>
            entry.source === 'skill-main'
            && entry.dependency === 'dep-a'
            && entry.reason === 'not-enabled',
        )).toBe(true);
    });

    test('finds reverse dependents for an enabled plugin', () => {
        const dependents = findReverseDependents('base-skill', [
            {
                id: 'base-skill',
                name: 'base-skill',
                enabled: true,
                dependencies: [],
            },
            {
                id: 'consumer-a',
                name: 'Consumer A',
                enabled: true,
                dependencies: ['base-skill'],
            },
            {
                id: 'consumer-b',
                name: 'Consumer B',
                enabled: false,
                dependencies: ['base-skill'],
            },
        ]);

        expect(dependents).toEqual(['Consumer A']);
    });

    test('detects dependency cycle reachable from root plugin', () => {
        const cycles = detectDependencyCycles([
            {
                id: 'main',
                name: 'main',
                enabled: true,
                dependencies: ['dep-a'],
            },
            {
                id: 'dep-a',
                name: 'dep-a',
                enabled: true,
                dependencies: ['dep-b'],
            },
            {
                id: 'dep-b',
                name: 'dep-b',
                enabled: true,
                dependencies: ['dep-a'],
            },
        ], 'main');

        expect(cycles.length).toBeGreaterThan(0);
        expect(cycles.some((cycle) => cycle.join('>').includes('dep-a>dep-b>dep-a'))).toBe(true);
    });
});
