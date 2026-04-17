import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    buildTaskTurnContract,
    detectTaskIntentDomain,
    resolveTaskCapabilityRequirements,
    type TaskCapabilityRequirement,
} from '../src/mastra/capabilityRegistry';
import { deriveHostControlShellCommand } from '../src/mastra/entrypoint';

type ReplayCase = {
    id: string;
    source: string;
    message: string;
    expectedDomain?: 'general' | 'market' | 'weather' | 'news' | 'browser';
    requiredCapabilities?: TaskCapabilityRequirement[];
    forbiddenCapabilities?: TaskCapabilityRequirement[];
    hostCommandByPlatform?: {
        darwin?: string;
        win32?: string;
        linux?: string;
        default?: string;
    };
};

type ReplayFixture = {
    cases: ReplayCase[];
};

function loadFixture(): ReplayFixture {
    const currentFilePath = fileURLToPath(import.meta.url);
    const fixturePath = path.join(path.dirname(currentFilePath), 'fixtures', 'production-general-replay-cases.json');
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    return JSON.parse(raw) as ReplayFixture;
}

function pickExpectedHostCommand(input?: ReplayCase['hostCommandByPlatform']): string | null {
    if (!input) {
        return null;
    }
    if (process.platform === 'darwin' && typeof input.darwin === 'string') {
        return input.darwin;
    }
    if (process.platform === 'win32' && typeof input.win32 === 'string') {
        return input.win32;
    }
    if (typeof input.linux === 'string') {
        return input.linux;
    }
    if (typeof input.default === 'string') {
        return input.default;
    }
    return null;
}

describe('production general replay scenarios', () => {
    const fixture = loadFixture();

    test('fixture has cases', () => {
        expect(Array.isArray(fixture.cases)).toBe(true);
        expect(fixture.cases.length).toBeGreaterThan(0);
    });

    for (const replayCase of fixture.cases) {
        test(`replay: ${replayCase.id}`, () => {
            const requirements = resolveTaskCapabilityRequirements({
                message: replayCase.message,
                workspacePath: process.cwd(),
            });

            if (replayCase.expectedDomain) {
                expect(detectTaskIntentDomain(replayCase.message)).toBe(replayCase.expectedDomain);
            }

            for (const capability of replayCase.requiredCapabilities ?? []) {
                expect(requirements).toContain(capability);
            }

            for (const capability of replayCase.forbiddenCapabilities ?? []) {
                expect(requirements).not.toContain(capability);
            }

            const contract = buildTaskTurnContract({
                message: replayCase.message,
                workspacePath: process.cwd(),
                mode: 'task',
                route: 'direct',
                createdAt: '2026-04-14T00:00:00.000Z',
            });

            expect(contract.hash).toMatch(/^[a-f0-9]{40}$/);
            for (const capability of replayCase.requiredCapabilities ?? []) {
                expect(contract.requiredCapabilities).toContain(capability);
            }

            const expectedHostCommand = pickExpectedHostCommand(replayCase.hostCommandByPlatform);
            if (expectedHostCommand) {
                const hostCommand = deriveHostControlShellCommand(replayCase.message);
                expect(hostCommand).toBe(expectedHostCommand);
            }
        });
    }
});
