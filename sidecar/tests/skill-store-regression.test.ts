import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillStore } from '../src/storage';

const tempDirs: string[] = [];

function makeTempWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-skill-store-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // ignore cleanup failures
        }
    }
});

describe('SkillStore regression', () => {
    test('prunes stale installed skills whose directory is missing', () => {
        const workspace = makeTempWorkspace();
        const storageDir = path.join(workspace, '.coworkany');
        fs.mkdirSync(storageDir, { recursive: true });

        const staleDir = path.join(workspace, '.coworkany', 'skills', 'codex-e2e-nanobanana-local');
        const storagePath = path.join(storageDir, 'skills.json');
        fs.writeFileSync(
            storagePath,
            JSON.stringify(
                {
                    'codex-e2e-nanobanana-local': {
                        manifest: {
                            name: 'codex-e2e-nanobanana-local',
                            version: '1.0.0',
                            description: 'Local nanobanana 2 image generation skill used by desktop E2E.',
                            directory: staleDir,
                            triggers: ['nanobanana 2'],
                        },
                        enabled: true,
                        installedAt: '2026-03-12T04:33:10.166Z',
                    },
                },
                null,
                2
            )
        );

        const store = new SkillStore(workspace);
        const skills = store.list();

        expect(skills.some((skill) => skill.manifest.name === 'codex-e2e-nanobanana-local')).toBe(false);

        const persisted = JSON.parse(fs.readFileSync(storagePath, 'utf-8')) as Record<string, unknown>;
        expect('codex-e2e-nanobanana-local' in persisted).toBe(false);
    });
});
