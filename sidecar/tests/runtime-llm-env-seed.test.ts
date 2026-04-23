import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { seedRuntimeLlmEnvFromConfig } from '../src/config/runtimeConfig';

const TEMP_DIRS: string[] = [];

afterEach(() => {
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function makeTempAppData(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-llm-env-seed-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('seedRuntimeLlmEnvFromConfig', () => {
    test('seeds openai-compatible env from llm-config.json', () => {
        const appDataDir = makeTempAppData();
        fs.writeFileSync(path.join(appDataDir, 'llm-config.json'), JSON.stringify({
            provider: 'openai',
            openai: {
                apiKey: 'config-openai-key',
                baseUrl: 'https://aiberm.com/v1/chat/completions',
                model: 'claude-sonnet-4-6',
            },
        }, null, 2));

        const env: NodeJS.ProcessEnv = {};
        const seeded = seedRuntimeLlmEnvFromConfig({
            appDataDir,
            env,
        });

        expect(seeded.loadedFromPath).toBe(path.join(appDataDir, 'llm-config.json'));
        expect(seeded.provider).toBe('openai');
        expect(env.COWORKANY_LLM_CONFIG_PROVIDER).toBe('openai');
        expect(env.OPENAI_API_KEY).toBe('config-openai-key');
        expect(env.OPENAI_BASE_URL).toBe('https://aiberm.com/v1');
        expect(env.COWORKANY_MODEL).toBe('openai/claude-sonnet-4-6');
    });

    test('prefers active profile when top-level openai block is incomplete', () => {
        const appDataDir = makeTempAppData();
        fs.writeFileSync(path.join(appDataDir, 'llm-config.json'), JSON.stringify({
            provider: 'aiberm',
            openai: {
                model: 'claude-sonnet-4-6',
            },
            profiles: [
                {
                    id: 'profile-aiberm',
                    provider: 'aiberm',
                    openai: {
                        apiKey: 'profile-openai-key',
                        baseUrl: 'https://aiberm.com/v1',
                        model: 'claude-sonnet-4-6',
                    },
                    verified: true,
                },
            ],
            activeProfileId: 'profile-aiberm',
        }, null, 2));

        const env: NodeJS.ProcessEnv = {};
        const seeded = seedRuntimeLlmEnvFromConfig({
            appDataDir,
            env,
        });

        expect(seeded.provider).toBe('aiberm');
        expect(env.COWORKANY_LLM_CONFIG_PROVIDER).toBe('aiberm');
        expect(env.OPENAI_API_KEY).toBe('profile-openai-key');
        expect(env.OPENAI_BASE_URL).toBe('https://aiberm.com/v1');
        expect(env.COWORKANY_MODEL).toBe('aiberm/claude-sonnet-4-6');
    });

    test('does not overwrite explicit env values', () => {
        const appDataDir = makeTempAppData();
        fs.writeFileSync(path.join(appDataDir, 'llm-config.json'), JSON.stringify({
            provider: 'aiberm',
            openai: {
                apiKey: 'config-openai-key',
                baseUrl: 'https://aiberm.com/v1',
                model: 'claude-sonnet-4-6',
            },
        }, null, 2));

        const env: NodeJS.ProcessEnv = {
            COWORKANY_LLM_CONFIG_PROVIDER: 'custom',
            OPENAI_API_KEY: 'env-openai-key',
            OPENAI_BASE_URL: 'https://custom.example/v1',
            COWORKANY_MODEL: 'openai/gpt-5',
        };
        const seeded = seedRuntimeLlmEnvFromConfig({
            appDataDir,
            env,
        });

        expect(seeded.provider).toBe('aiberm');
        expect(seeded.seededKeys).toEqual([]);
        expect(env.COWORKANY_LLM_CONFIG_PROVIDER).toBe('custom');
        expect(env.OPENAI_API_KEY).toBe('env-openai-key');
        expect(env.OPENAI_BASE_URL).toBe('https://custom.example/v1');
        expect(env.COWORKANY_MODEL).toBe('openai/gpt-5');
    });

    test('does not fall back to cwd config when explicit appDataDir has no llm-config.json', () => {
        const appDataDir = makeTempAppData();
        const env: NodeJS.ProcessEnv = {};
        const seeded = seedRuntimeLlmEnvFromConfig({
            appDataDir,
            env,
        });

        expect(seeded.loadedFromPath).toBeNull();
        expect(seeded.provider).toBeNull();
        expect(seeded.modelId).toBeNull();
        expect(seeded.seededKeys).toEqual([]);
        expect(Object.keys(env)).toEqual([]);
    });

    test('falls back to cwd llm-config.json when appDataDir is implicit', () => {
        const rootDir = makeTempAppData();
        fs.mkdirSync(path.join(rootDir, '.coworkany'), { recursive: true });
        fs.writeFileSync(path.join(rootDir, 'llm-config.json'), JSON.stringify({
            provider: 'openai',
            openai: {
                apiKey: 'cwd-openai-key',
                baseUrl: 'https://aiberm.com/v1/chat/completions',
                model: 'claude-sonnet-4-6',
            },
        }, null, 2));

        const env: NodeJS.ProcessEnv = {};
        const seeded = seedRuntimeLlmEnvFromConfig({
            cwd: rootDir,
            env,
        });

        expect(seeded.loadedFromPath).toBe(path.join(rootDir, 'llm-config.json'));
        expect(seeded.provider).toBe('openai');
        expect(env.COWORKANY_LLM_CONFIG_PROVIDER).toBe('openai');
        expect(env.OPENAI_API_KEY).toBe('cwd-openai-key');
        expect(env.OPENAI_BASE_URL).toBe('https://aiberm.com/v1');
        expect(env.COWORKANY_MODEL).toBe('openai/claude-sonnet-4-6');
    });

    test('seeds insecure TLS env when active provider enables allowInsecureTls', () => {
        const appDataDir = makeTempAppData();
        fs.writeFileSync(path.join(appDataDir, 'llm-config.json'), JSON.stringify({
            provider: 'openai',
            openai: {
                apiKey: 'config-openai-key',
                baseUrl: 'https://aiberm.com/v1',
                model: 'claude-sonnet-4-6',
                allowInsecureTls: true,
            },
        }, null, 2));

        const env: NodeJS.ProcessEnv = {};
        const seeded = seedRuntimeLlmEnvFromConfig({
            appDataDir,
            env,
        });

        expect(seeded.provider).toBe('openai');
        expect(env.COWORKANY_ALLOW_INSECURE_TLS).toBe('1');
        expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
    });
});
