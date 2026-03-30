import { describe, expect, test } from 'bun:test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SIDECAR_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(SIDECAR_ROOT, 'src');
const DESKTOP_TAURI_SRC_ROOT = path.resolve(SIDECAR_ROOT, '..', 'desktop', 'src-tauri', 'src');

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

    test('legacy runtime module directories are removed from sidecar source tree', () => {
        const removedDirs = [
            path.join(SRC_ROOT, 'agent'),
            path.join(SRC_ROOT, 'execution'),
            path.join(SRC_ROOT, 'llm'),
            path.join(SRC_ROOT, 'memory'),
            path.join(SRC_ROOT, 'services'),
        ];
        for (const directoryPath of removedDirs) {
            expect(fs.existsSync(directoryPath)).toBe(false);
        }
    });

    test('phase6 planned orchestration files are removed from original paths', () => {
        const removedFiles = [
            path.join(SRC_ROOT, 'orchestration', 'workRequestRuntime.ts'),
            path.join(SRC_ROOT, 'orchestration', 'workRequestStore.ts'),
            path.join(SRC_ROOT, 'orchestration', 'workRequestSnapshot.ts'),
        ];
        for (const filePath of removedFiles) {
            expect(fs.existsSync(filePath)).toBe(false);
        }
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

    test('tracked python utility scripts are removed after migration to non-python tooling', () => {
        const removedFiles = [
            path.resolve(SIDECAR_ROOT, 'remove_similar_images.py'),
            path.resolve(SIDECAR_ROOT, 'csv_demo.py'),
            path.resolve(SIDECAR_ROOT, 'csv_reading_demo.py'),
            path.resolve(SIDECAR_ROOT, 'read_csv_demo.py'),
            path.resolve(SIDECAR_ROOT, 'add_watermark.py'),
            path.resolve(SIDECAR_ROOT, 'save_screenshot.py'),
            path.resolve(SIDECAR_ROOT, 'screenshot_example.py'),
            path.resolve(SIDECAR_ROOT, 'sum100.py'),
            path.resolve(SIDECAR_ROOT, 'sum_100.py'),
            path.resolve(SIDECAR_ROOT, 'sum_1_to_10.py'),
            path.resolve(SIDECAR_ROOT, 'sum_1_to_100.py'),
            path.resolve(SIDECAR_ROOT, 'sum_numbers.py'),
            path.resolve(SIDECAR_ROOT, 'factorial.py'),
            path.resolve(SIDECAR_ROOT, 'factorial_calculator.py'),
            path.resolve(SIDECAR_ROOT, 'calculate_factorials.py'),
            path.resolve(SIDECAR_ROOT, 'create_ppt.py'),
            path.resolve(SIDECAR_ROOT, 'create_smart_city_ppt.py'),
            path.resolve(SIDECAR_ROOT, 'create_ai_smart_city_ppt.py'),
            path.resolve(SIDECAR_ROOT, 'create_ai_sanitation_ppt.py'),
            path.resolve(SIDECAR_ROOT, 'test_csv_reading.py'),
            path.resolve(SIDECAR_ROOT, 'ai_trends_analysis.py'),
            path.resolve(SIDECAR_ROOT, '..', 'desktop', 'src-tauri', 'fix_await.py'),
        ];

        for (const filePath of removedFiles) {
            expect(fs.existsSync(filePath)).toBe(false);
        }
    });

    test('desktop process manager no longer bootstraps python runtimes', () => {
        const processManagerPath = path.join(DESKTOP_TAURI_SRC_ROOT, 'process_manager.rs');
        const source = read(processManagerPath);

        expect(source).not.toContain("python-build-standalone");
        expect(source).not.toContain("main.py");
        expect(source).not.toContain("pip install");
        expect(source).not.toContain("virtualenv");
        expect(source).toContain("NoopManagedService");
    });

    test('desktop platform runtime marks python as not required and skips python probes', () => {
        const platformRuntimePath = path.join(DESKTOP_TAURI_SRC_ROOT, 'platform_runtime.rs');
        const source = read(platformRuntimePath);

        expect(source).toContain("not_required_in_mastra_single_process");
        expect(source).not.toContain("for cmd in [\"python3\", \"python\", \"py\"]");
        expect(source).not.toContain(".join(\"main.py\")");
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
        expect(pkg.scripts?.build).toBeDefined();
    });

    test('sidecar src has zero @ts-ignore/@ts-expect-error markers', () => {
        const command = `grep -r "@ts-ignore\\|@ts-expect-error" "${SRC_ROOT}" --include="*.ts" --include="*.tsx" -l || true`;
        const result = execSync(command, { encoding: 'utf-8' }).trim();
        expect(result).toBe('');
    });

    test('sidecar src has zero as any assertions', () => {
        const command = `rg -n "\\\\bas any\\\\b" "${SRC_ROOT}" --glob "*.ts" --glob "*.tsx" || true`;
        const result = execSync(command, { encoding: 'utf-8' }).trim();
        expect(result).toBe('');
    });
});
