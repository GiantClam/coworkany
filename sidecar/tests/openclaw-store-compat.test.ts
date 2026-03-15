import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openclawCompat } from '../src/claude_skills/openclawCompat';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];
const TENCENT_DATASET_URL = 'https://skillhub.tencent.com/data/skills.json';
const TENCENT_DOWNLOAD_URL = 'https://downloads.example/tencent-demo-skill.zip';

afterEach(() => {
    globalThis.fetch = originalFetch;
    (openclawCompat as unknown as { tencentSkillHubDataCache: unknown }).tencentSkillHubDataCache = null;
    (openclawCompat as unknown as { tencentSkillHubDataPromise: unknown }).tencentSkillHubDataPromise = null;
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

    test('searches and installs skills from Tencent SkillHub dataset + zip download flow', async () => {
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            const asString = String(url);
            if (asString.includes('/ajax/rainbow?action=getRainbowConfig')) {
                expect(init?.method).toBe('POST');
                return new Response(
                    JSON.stringify({
                        data: [
                            {
                                rows: [
                                    {
                                        url: TENCENT_DATASET_URL,
                                    },
                                ],
                            },
                        ],
                    }),
                    { status: 200 }
                );
            }
            if (asString === TENCENT_DATASET_URL) {
                return new Response(
                    JSON.stringify({
                        skills: [
                            {
                                slug: 'tencent-demo-skill',
                                name: 'Tencent Demo Skill',
                                description: 'Tencent packaged skill',
                                owner: 'tencent',
                                downloads: 99,
                                score: 650,
                                downloadUrl: TENCENT_DOWNLOAD_URL,
                            },
                        ],
                    }),
                    { status: 200 }
                );
            }
            if (asString === TENCENT_DOWNLOAD_URL) {
                return new Response(createZipArchive({
                    'SKILL.md': `---
name: tencent-demo-skill
description: Tencent demo skill
---

Use this Tencent demo skill.`,
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/zip',
                    },
                });
            }
            return new Response('not-found', { status: 404 });
        }) as typeof fetch;

        const results = await openclawCompat.searchStore('tencent_skillhub', 'tencent demo');
        expect(results.length).toBe(1);
        expect(results[0].name).toBe('tencent-demo-skill');
        expect(results[0].displayName).toBe('Tencent Demo Skill');

        const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-tencent-skill-'));
        tempDirs.push(targetRoot);

        const installResult = await openclawCompat.installFromStore('tencent_skillhub', 'tencent-demo-skill', targetRoot);
        expect(installResult.success).toBe(true);
        expect(installResult.path).toBeDefined();

        const installedPath = installResult.path as string;
        expect(fs.existsSync(path.join(installedPath, 'SKILL.md'))).toBe(true);
        expect(fs.readFileSync(path.join(installedPath, 'SKILL.md'), 'utf-8')).toContain('Tencent demo skill');
    });
});

function createZipArchive(files: Record<string, string>): Uint8Array {
    const localChunks: Buffer[] = [];
    const centralChunks: Buffer[] = [];
    let offset = 0;

    for (const [name, content] of Object.entries(files)) {
        const fileName = Buffer.from(name, 'utf-8');
        const data = Buffer.from(content, 'utf-8');
        const crc32 = computeCrc32(data);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(crc32, 14);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(fileName.length, 26);
        localHeader.writeUInt16LE(0, 28);
        localChunks.push(localHeader, fileName, data);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(crc32, 16);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(fileName.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralChunks.push(centralHeader, fileName);

        offset += localHeader.length + fileName.length + data.length;
    }

    const centralDirectory = Buffer.concat(centralChunks);
    const localSection = Buffer.concat(localChunks);
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(Object.keys(files).length, 8);
    endRecord.writeUInt16LE(Object.keys(files).length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(localSection.length, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([localSection, centralDirectory, endRecord]);
}

function computeCrc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            const mask = -(crc & 1);
            crc = (crc >>> 1) ^ (0xedb88320 & mask);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
