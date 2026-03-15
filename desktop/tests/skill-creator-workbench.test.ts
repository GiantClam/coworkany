import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { deriveAnalyzerReliability } from '../src/components/Skills/SkillCreatorWorkbench';

const WORKBENCH_PATH = path.resolve(
    __dirname,
    '../src/components/Skills/SkillCreatorWorkbench.tsx'
);

describe('Skill Creator Workbench - Functional Model', () => {
    test('deriveAnalyzerReliability returns unknown with no history', () => {
        expect(deriveAnalyzerReliability([])).toEqual({
            level: 'unknown',
            label: 'Unknown',
        });
    });

    test('deriveAnalyzerReliability returns healthy for all-success recent history', () => {
        const history = [
            { id: '1', status: { configured: true, reachable: true } },
            { id: '2', status: { configured: true, reachable: true } },
            { id: '3', status: { configured: true, reachable: true } },
        ] as const;

        expect(deriveAnalyzerReliability([...history])).toEqual({
            level: 'healthy',
            label: 'Healthy',
        });
    });

    test('deriveAnalyzerReliability returns degraded for mixed recent history', () => {
        const history = [
            { id: '1', status: { configured: true, reachable: true } },
            { id: '2', status: { configured: true, reachable: false } },
            { id: '3', status: { configured: true, reachable: true } },
        ] as const;

        expect(deriveAnalyzerReliability([...history])).toEqual({
            level: 'degraded',
            label: 'Degraded',
        });
    });

    test('deriveAnalyzerReliability returns unhealthy for consecutive recent failures', () => {
        const history = [
            { id: '1', status: { configured: true, reachable: false } },
            { id: '2', status: { configured: true, reachable: false } },
            { id: '3', status: { configured: true, reachable: true } },
        ] as const;

        expect(deriveAnalyzerReliability([...history])).toEqual({
            level: 'unhealthy',
            label: 'Unhealthy',
        });
    });
});

describe('Skill Creator Workbench - UI Contract', () => {
    test('workbench exposes analyzer smoke, status, history, and log controls', () => {
        const content = fs.readFileSync(WORKBENCH_PATH, 'utf-8');

        expect(content).toContain('Run analyzer smoke');
        expect(content).toContain('Open analyzer log');
        expect(content).toContain('Open status file');
        expect(content).toContain('Open history file');
        expect(content).toContain('Recent analyzer health');
        expect(content).toContain('Recent analyzer events');
        expect(content).toContain('Analyzer readiness gate');
        expect(content).toContain('Assess readiness');
        expect(content).toContain('Open readiness file');
        expect(content).toContain('Failure budget:');
    });

    test('workbench uses analyzer IPC contract for probe, smoke, and history', () => {
        const content = fs.readFileSync(WORKBENCH_PATH, 'utf-8');

        expect(content).toContain("invoke<IpcResult>('check_skill_benchmark_analyzer'");
        expect(content).toContain("invoke<IpcResult>('run_skill_benchmark_analyzer_smoke'");
        expect(content).toContain("invoke<IpcResult>('load_skill_benchmark_analyzer_history'");
        expect(content).toContain("invoke<IpcResult>('assess_skill_benchmark_analyzer_readiness'");
        expect(content).toContain('deriveAnalyzerReliability');
    });
});
