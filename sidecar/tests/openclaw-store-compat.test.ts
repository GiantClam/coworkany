import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openclawCompat } from '../src/claude_skills/openclawCompat';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // ignore cleanup errors
        }
    }
});

describe('OpenClaw store compatibility', () => {
    test('searches skills from clawhub store endpoint', async () => {
        globalThis.fetch = (async (url: string | URL | Request) => {
            const asString = String(url);
            if (asString.includes('clawhub.ai/api/skills/search')) {
                return new Response(
                    JSON.stringify({
                        skills: [
                            {
                                name: 'ocr-pdf-tools',
                                description: 'PDF parsing and OCR workflow',
                                author: 'community',
                                version: '1.2.0',
                            },
                        ],
                    }),
                    { status: 200 }
                );
            }
            return new Response('not-found', { status: 404 });
        }) as typeof fetch;

        const results = await openclawCompat.searchStore('clawhub', 'pdf');
        expect(results.length).toBe(1);
        expect(results[0].name).toBe('ocr-pdf-tools');
    });

    test('installs skill package from store and writes SKILL.md', async () => {
        globalThis.fetch = (async (url: string | URL | Request) => {
            const asString = String(url);
            if (asString.includes('/api/skills/demo-skill')) {
                return new Response(
                    JSON.stringify({
                        name: 'demo-skill',
                        description: 'demo',
                        repoUrl: 'https://github.com/demo/demo-skill',
                        files: ['SKILL.md', 'scripts/run.sh'],
                    }),
                    { status: 200 }
                );
            }
            if (asString.endsWith('/raw/main/SKILL.md')) {
                return new Response(
                    `---
name: demo-skill
description: Demo skill
---

Use this demo skill.`,
                    { status: 200 }
                );
            }
            if (asString.endsWith('/raw/main/scripts/run.sh')) {
                return new Response('#!/usr/bin/env bash\necho demo\n', { status: 200 });
            }
            return new Response('not-found', { status: 404 });
        }) as typeof fetch;

        const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-skill-'));
        tempDirs.push(targetRoot);

        const installResult = await openclawCompat.installFromStore('clawhub', 'demo-skill', targetRoot);
        expect(installResult.success).toBe(true);
        expect(installResult.path).toBeDefined();

        const installedPath = installResult.path as string;
        expect(fs.existsSync(path.join(installedPath, 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(installedPath, 'scripts', 'run.sh'))).toBe(true);
    });
});
