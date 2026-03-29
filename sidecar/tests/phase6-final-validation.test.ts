import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const SIDECAR_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(SIDECAR_ROOT, 'src');

function read(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

describe('Phase 6 Final Validation (implemented milestones)', () => {
    test('main.ts is a thin runtime bootstrap', () => {
        const mainPath = path.join(SRC_ROOT, 'main.ts');
        expect(fs.existsSync(mainPath)).toBe(true);

        const source = read(mainPath);
        const lineCount = source.split('\n').length;

        expect(lineCount).toBeLessThan(120);
        expect(source).toContain("'./main-mastra'");
        expect(source).not.toContain("'./main-legacy'");
    });

    test('runtime bootstrap is forced to mastra mode', () => {
        const source = read(path.join(SRC_ROOT, 'main.ts'));
        expect(source).toContain("process.env.COWORKANY_RUNTIME_MODE = 'mastra';");
    });

    test('main.ts imports main-mastra directly without legacy branch', () => {
        const source = read(path.join(SRC_ROOT, 'main.ts'));
        expect(source).toContain("await import('./main-mastra');");
        expect(source).not.toContain("runtimeMode === 'legacy'");
    });

    test('main-mastra no longer depends on legacy runtime bindings', () => {
        const source = read(path.join(SRC_ROOT, 'main-mastra.ts'));
        expect(source).not.toContain("./legacy/runtimeBindings");
        expect(source).toContain("./mastra/runtimeBindings");
    });

    test('legacy runtime implementation files are removed after single-path convergence', () => {
        const legacyMainPath = path.join(SRC_ROOT, 'main-legacy.ts');
        const legacyDirPath = path.join(SRC_ROOT, 'legacy');
        expect(fs.existsSync(legacyMainPath)).toBe(false);
        expect(fs.existsSync(legacyDirPath)).toBe(false);
    });

    test('legacy python sidecar service files are removed from repository tree', () => {
        const removedFiles = [
            path.resolve(SIDECAR_ROOT, '..', 'browser-use-service', 'main.py'),
            path.resolve(SIDECAR_ROOT, '..', 'browser-use-service', 'requirements.txt'),
            path.resolve(SIDECAR_ROOT, '..', 'rag-service', 'main.py'),
            path.resolve(SIDECAR_ROOT, '..', 'rag-service', 'requirements.txt'),
        ];

        for (const filePath of removedFiles) {
            expect(fs.existsSync(filePath)).toBe(false);
        }
    });

    test('package scripts no longer expose legacy/compat startup aliases', () => {
        const packageJsonPath = path.join(SIDECAR_ROOT, 'package.json');
        const pkg = JSON.parse(read(packageJsonPath)) as {
            scripts?: Record<string, string>;
        };

        expect(pkg.scripts?.['start:legacy']).toBeUndefined();
        expect(pkg.scripts?.['dev:legacy']).toBeUndefined();
        expect(pkg.scripts?.['start:mastra:compat']).toBeUndefined();
        expect(pkg.scripts?.['dev:mastra:compat']).toBeUndefined();
    });
});
