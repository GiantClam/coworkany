import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveRuntimeSearchConfig } from '../src/config/runtimeConfig';

const ORIGINAL_ENV = {
    COWORKANY_SEARCH_PROVIDER: process.env.COWORKANY_SEARCH_PROVIDER,
    SEARCH_PROVIDER: process.env.SEARCH_PROVIDER,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
    EXA_API_KEY: process.env.EXA_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    BRAVE_API_KEY: process.env.BRAVE_API_KEY,
};

const TEMP_DIRS: string[] = [];

afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
        if (typeof value === 'string') {
            process.env[key] = value;
        } else {
            delete process.env[key];
        }
    }
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function makeTempAppData(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-search-config-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('resolveRuntimeSearchConfig', () => {
    test('reads Exa provider and API key from llm-config.json', () => {
        const appDataDir = makeTempAppData();
        fs.writeFileSync(path.join(appDataDir, 'llm-config.json'), JSON.stringify({
            search: {
                provider: 'exa',
                exaApiKey: 'config-exa-key',
            },
        }, null, 2));

        const resolved = resolveRuntimeSearchConfig({
            appDataDir,
            env: {},
        });

        expect(resolved.settings.provider).toBe('exa');
        expect(resolved.settings.exaApiKey).toBe('config-exa-key');
        expect(resolved.sources.exaApiKey).toContain('config:');
        expect(resolved.conflicts).toEqual([]);
    });

    test('lets EXA_API_KEY override configured Exa key', () => {
        const appDataDir = makeTempAppData();
        fs.writeFileSync(path.join(appDataDir, 'llm-config.json'), JSON.stringify({
            search: {
                provider: 'exa',
                exaApiKey: 'config-exa-key',
            },
        }, null, 2));

        const resolved = resolveRuntimeSearchConfig({
            appDataDir,
            env: {
                EXA_API_KEY: 'env-exa-key',
            },
        });

        expect(resolved.settings.provider).toBe('exa');
        expect(resolved.settings.exaApiKey).toBe('env-exa-key');
        expect(resolved.sources.exaApiKey).toBe('env:EXA_API_KEY');
        expect(resolved.conflicts).toContain('search.exaApiKey env(EXA_API_KEY) overrides config');
    });
});
