/**
 * TypeScript Compilation Verification Test
 *
 * Verifies that the sidecar TypeScript codebase compiles with zero errors.
 * This test guards against regressions introduced by code changes.
 *
 * Test Scope:
 *   - Full `npx tsc --noEmit` compilation of sidecar/src/**
 *   - Excludes test files (__tests__/, *.test.ts, *.spec.ts) per tsconfig.json
 *   - Verifies zero TS errors (exit code 0)
 *
 * What it covers:
 *   - Protocol schema types (commands.ts IpcCommand union completeness)
 *   - SkillStore public API (save, parseSkillMd visibility)
 *   - ToolContext interface compliance (taskId required)
 *   - SelfLearning types (CodeExecutionResult, DependencyInstallResult, ExperimentResult)
 *   - ConfidenceTracker API (getByConfidence, recordUsage signatures)
 *   - ReuseEngine dependencies (SkillRecord mapping, confidenceTracker required)
 *   - AnthropicMessage content access patterns (string vs content blocks)
 *   - Autonomous task command schemas in IpcCommand union
 *   - OpenClaw compatibility layer (SkillManifest field mapping)
 *   - Various data type assertions (json(), unknown to typed)
 *
 * Prerequisites:
 *   - Node.js with npx available
 *   - sidecar/node_modules installed (npm install)
 *
 * Run:
 *   cd desktop && npx playwright test tests/typescript-compilation.test.ts
 */

import { test, expect } from '@playwright/test';
import * as childProcess from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);
const SIDECAR_DIR = path.resolve(__dirname_local, '..', '..', 'sidecar');

test.describe('TypeScript Compilation - Sidecar', () => {
    test.setTimeout(120_000); // 2 minutes for compilation

    test('sidecar should compile with zero TypeScript errors', async () => {
        console.log(`[Test] Running tsc --noEmit in ${SIDECAR_DIR}...`);

        const result = childProcess.spawnSync(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['tsc', '--noEmit'],
            {
                cwd: SIDECAR_DIR,
                shell: true,
                encoding: 'utf-8',
                timeout: 90_000,
            }
        );

        const stdout = result.stdout || '';
        const stderr = result.stderr || '';
        const output = stdout + '\n' + stderr;

        const errorLines = output
            .split('\n')
            .filter(line => line.includes('error TS'));

        const errorsByFile = new Map<string, string[]>();
        for (const line of errorLines) {
            const match = line.match(/^(.*?)\(\d+,\d+\):/);
            const file = match ? match[1] : 'unknown';
            if (!errorsByFile.has(file)) errorsByFile.set(file, []);
            errorsByFile.get(file)!.push(line.trim());
        }

        console.log('');
        console.log('='.repeat(60));
        console.log('  TypeScript Compilation Report');
        console.log('='.repeat(60));
        console.log(`  Exit code: ${result.status}`);
        console.log(`  Total errors: ${errorLines.length}`);
        console.log(`  Files with errors: ${errorsByFile.size}`);

        if (errorsByFile.size > 0) {
            console.log('');
            for (const [file, errors] of errorsByFile) {
                console.log(`  ${file}: ${errors.length} error(s)`);
                for (const err of errors.slice(0, 5)) {
                    console.log(`    ${err}`);
                }
                if (errors.length > 5) {
                    console.log(`    ... (${errors.length - 5} more)`);
                }
            }
        }
        console.log('='.repeat(60));

        expect(result.status, `TypeScript compilation should exit with code 0 (got ${result.status})`).toBe(0);
        expect(errorLines.length, `Should have zero TS errors but found ${errorLines.length}`).toBe(0);
    });

    test('critical source files should exist', async () => {
        const fs = await import('fs');
        const criticalFiles = [
            'src/main.ts',
            'src/protocol/commands.ts',
            'src/agent/reactLoop.ts',
            'src/agent/autonomousAgent.ts',
            'src/agent/selfLearning/precipitator.ts',
            'src/data/defaults.ts',
            'src/tools/builtin.ts',
            'src/storage/skillStore.ts',
        ];

        for (const file of criticalFiles) {
            const fullPath = path.join(SIDECAR_DIR, file);
            const exists = fs.existsSync(fullPath);
            console.log(`  ${exists ? 'OK' : 'MISSING'} ${file}`);
            expect(exists, `Critical file ${file} should exist`).toBe(true);
        }
    });

    test('builtin skills should include Superpowers-inspired skills', async () => {
        const fs = await import('fs');
        const defaultsPath = path.join(SIDECAR_DIR, 'src', 'data', 'defaults.ts');
        const content = fs.readFileSync(defaultsPath, 'utf-8');

        const requiredSkills = [
            { id: 'verification-loop', desc: 'Verification before completion gate' },
            { id: 'systematic-debugging', desc: '4-Phase debugging with 3-Fix Rule' },
            { id: 'tdd-workflow', desc: 'TDD with anti-rationalization' },
            { id: 'brainstorming', desc: 'Collaborative design exploration' },
            { id: 'writing-plans', desc: 'Bite-sized implementation plans' },
            { id: 'system-analysis', desc: 'Platform-aware system analysis' },
        ];

        console.log('');
        console.log('  Builtin Skills Check:');
        for (const skill of requiredSkills) {
            const found = content.includes("id: '" + skill.id + "'");
            console.log(`  ${found ? 'OK' : 'MISSING'} ${skill.id} - ${skill.desc}`);
            expect(found, `Builtin skill "${skill.id}" should be registered`).toBe(true);
        }
    });

    test('Iron Laws should be embedded in ReAct prompt', async () => {
        const fs = await import('fs');
        const reactLoopPath = path.join(SIDECAR_DIR, 'src', 'agent', 'reactLoop.ts');
        const content = fs.readFileSync(reactLoopPath, 'utf-8');

        const ironLaws = [
            'Iron Law 1',
            'Iron Law 2',
            'Iron Law 3',
            'NO FINAL ANSWER UNTIL',
            'NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION',
            'NO FIXES WITHOUT ROOT CAUSE',
            'Rationalization Prevention',
        ];

        console.log('');
        console.log('  Iron Laws in ReAct Prompt:');
        for (const law of ironLaws) {
            const found = content.includes(law);
            console.log(`  ${found ? 'OK' : 'MISSING'} ${law}`);
            expect(found, `ReAct prompt should contain "${law}"`).toBe(true);
        }
    });

    test('Verification Gate should be implemented in agent loop', async () => {
        const fs = await import('fs');
        const mainPath = path.join(SIDECAR_DIR, 'src', 'main.ts');
        const content = fs.readFileSync(mainPath, 'utf-8');

        const gateIndicators = [
            'Verification Gate',
            'completionClaims',
            'verificationEvidence',
            'hasCompletionClaim',
            'gateWarnings',
            'Plan Completion Gate',
        ];

        console.log('');
        console.log('  Verification Gate in Agent Loop:');
        for (const indicator of gateIndicators) {
            const found = content.includes(indicator);
            console.log(`  ${found ? 'OK' : 'MISSING'} ${indicator}`);
            expect(found, `Agent loop should contain "${indicator}"`).toBe(true);
        }
    });

    test('Two-Stage Review should be in AutonomousAgent', async () => {
        const fs = await import('fs');
        const agentPath = path.join(SIDECAR_DIR, 'src', 'agent', 'autonomousAgent.ts');
        const content = fs.readFileSync(agentPath, 'utf-8');

        const reviewIndicators = [
            'SubtaskReviewResult',
            'reviewSubtask',
            'spec-compliance',
            'quality',
            'MAX_REVIEW_RETRIES',
            'Two-Stage Review',
        ];

        console.log('');
        console.log('  Two-Stage Review in AutonomousAgent:');
        for (const indicator of reviewIndicators) {
            const found = content.includes(indicator);
            console.log(`  ${found ? 'OK' : 'MISSING'} ${indicator}`);
            expect(found, `AutonomousAgent should contain "${indicator}"`).toBe(true);
        }
    });

    test('Skill quality validation should be in Precipitator', async () => {
        const fs = await import('fs');
        const precipPath = path.join(
            SIDECAR_DIR, 'src', 'agent', 'selfLearning', 'precipitator.ts'
        );
        const content = fs.readFileSync(precipPath, 'utf-8');

        const qualityIndicators = [
            'validateSkillQuality',
            'TDD for Skills',
            'score',
            'Use when',
        ];

        console.log('');
        console.log('  Skill Quality Validation in Precipitator:');
        for (const indicator of qualityIndicators) {
            const found = content.includes(indicator);
            console.log(`  ${found ? 'OK' : 'MISSING'} ${indicator}`);
            expect(found, `Precipitator should contain "${indicator}"`).toBe(true);
        }
    });

    test('Autonomous task commands should be in protocol schema', async () => {
        const fs = await import('fs');
        const commandsPath = path.join(SIDECAR_DIR, 'src', 'protocol', 'commands.ts');
        const content = fs.readFileSync(commandsPath, 'utf-8');

        const autonomousCommands = [
            'StartAutonomousTaskCommandSchema',
            'GetAutonomousTaskStatusCommandSchema',
            'PauseAutonomousTaskCommandSchema',
            'ResumeAutonomousTaskCommandSchema',
            'CancelAutonomousTaskCommandSchema',
            'ListAutonomousTasksCommandSchema',
        ];

        console.log('');
        console.log('  Autonomous Task Commands in Protocol:');
        for (const cmd of autonomousCommands) {
            const found = content.includes(cmd);
            console.log(`  ${found ? 'OK' : 'MISSING'} ${cmd}`);
            expect(found, `Protocol should define ${cmd}`).toBe(true);
        }
    });
});
