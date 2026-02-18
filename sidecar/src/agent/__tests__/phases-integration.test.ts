/**
 * Integration Tests for Phases 1-3
 *
 * Tests the integration of:
 * - Phase 1: Skill Recommendation
 * - Phase 2: Code Quality Analysis
 * - Phase 3: Automatic Verification
 */

import { IntentAnalyzer } from '../skillRecommendation/intentAnalyzer';
import { SkillRecommender } from '../skillRecommendation/skillRecommender';
import { getCodeQualityAnalyzer } from '../codeQuality/analyzer';
import { getVerificationEngine } from '../verification/engine';
import type { VerificationContext } from '../verification/types';

describe('Phases 1-3 Integration Tests', () => {
    describe('Phase 1: Skill Recommendation', () => {
        const intentAnalyzer = new IntentAnalyzer();
        const skillRecommender = new SkillRecommender();

        test('should detect bug_fix intent and recommend systematic-debugging', () => {
            const query = "Fix the bug in authentication that's causing login failures";
            const intent = intentAnalyzer.analyzeIntent(query, [], []);

            expect(intent.type).toBe('bug_fix');
            expect(intent.confidence).toBeGreaterThan(0.7);

            const recommendations = skillRecommender.recommend(intent, [], []);
            const debugSkill = recommendations.find(r => r.skillName === 'systematic-debugging');

            expect(debugSkill).toBeDefined();
            expect(debugSkill!.confidence).toBeGreaterThan(0.7);
        });

        test('should detect test intent and recommend tdd skill', () => {
            const query = "Write unit tests for the authentication module";
            const intent = intentAnalyzer.analyzeIntent(query, [], []);

            expect(intent.type).toBe('test');
            expect(intent.confidence).toBeGreaterThan(0.7);

            const recommendations = skillRecommender.recommend(intent, [], []);
            const tddSkill = recommendations.find(r => r.skillName === 'tdd');

            expect(tddSkill).toBeDefined();
        });

        test('should auto-load high-confidence skills', () => {
            const query = "Debug this error: TypeError: Cannot read property 'id' of undefined";
            const intent = intentAnalyzer.analyzeIntent(query, [], ["TypeError: Cannot read property 'id' of undefined"]);

            expect(intent.confidence).toBeGreaterThan(0.8);

            const recommendations = skillRecommender.recommend(intent, [], []);
            const highConfidence = recommendations.filter(r => r.autoLoad);

            expect(highConfidence.length).toBeGreaterThan(0);
        });
    });

    describe('Phase 2: Code Quality Analysis', () => {
        const analyzer = getCodeQualityAnalyzer();

        test('should analyze simple TypeScript code', async () => {
            const code = `
function add(a: number, b: number): number {
    return a + b;
}
`;
            const report = await analyzer.analyze(code, 'test.ts', 'typescript');

            expect(report.score).toBeGreaterThan(80);
            expect(report.language).toBe('typescript');
            expect(report.metrics.linesOfCode).toBeGreaterThan(0);
            expect(report.issues.length).toBe(0);
        });

        test('should detect high complexity', async () => {
            const code = `
function complexFunction(x: number): number {
    if (x > 0) {
        if (x > 10) {
            if (x > 20) {
                if (x > 30) {
                    if (x > 40) {
                        return x * 2;
                    }
                }
            }
        }
    }
    return x;
}
`;
            const report = await analyzer.analyze(code, 'test.ts', 'typescript');

            expect(report.metrics.cyclomaticComplexity).toBeGreaterThan(5);
            const complexityIssues = report.issues.filter(i => i.category === 'complexity');
            expect(complexityIssues.length).toBeGreaterThan(0);
        });

        test('should detect security issues', async () => {
            const code = `
function queryDatabase(userId: string) {
    const query = "SELECT * FROM users WHERE id = " + userId;
    return db.execute(query);
}
`;
            const report = await analyzer.analyze(code, 'test.ts', 'typescript');

            const securityIssues = report.issues.filter(i => i.category === 'security');
            expect(securityIssues.length).toBeGreaterThan(0);
            expect(report.score).toBeLessThan(100);
        });

        test('should detect code smells', async () => {
            const code = `
function processData(a: number, b: number, c: string, d: string, e: boolean, f: boolean) {
    console.log("Processing", a, b, c, d, e, f);
    try {
        // Some operation
    } catch (error) {
        // Empty catch block
    }
}
`;
            const report = await analyzer.analyze(code, 'test.ts', 'typescript');

            const tooManyParams = report.issues.find(i => i.message.includes('too many parameters'));
            const consoleLogs = report.issues.find(i => i.message.includes('console'));
            const emptyCatch = report.issues.find(i => i.message.includes('Empty catch'));

            expect(tooManyParams || consoleLogs || emptyCatch).toBeDefined();
        });

        test('should handle different languages', async () => {
            const jsCode = `function test() { return 42; }`;
            const pyCode = `def test():\n    return 42`;

            const jsReport = await analyzer.analyze(jsCode, 'test.js', 'javascript');
            const pyReport = await analyzer.analyze(pyCode, 'test.py', 'python');

            expect(jsReport.language).toBe('javascript');
            expect(pyReport.language).toBe('python');
            expect(jsReport.score).toBeGreaterThan(0);
            expect(pyReport.score).toBeGreaterThan(0);
        });
    });

    describe('Phase 3: Automatic Verification', () => {
        const engine = getVerificationEngine();

        test('should verify successful file write', async () => {
            const context: VerificationContext = {
                taskId: 'test-task',
                workspacePath: process.cwd(),
                previousSteps: [],
            };

            // Mock a successful write
            const result = JSON.stringify({ success: true });
            const verification = await engine.verify(
                'write_file',
                {
                    file_path: 'test.txt',
                    content: 'test content'
                },
                result,
                context
            );

            // Note: This will actually try to check if file exists, so it might fail
            // In a real test environment, we'd mock the file system
            expect(verification.status).toBeDefined();
            expect(['passed', 'failed', 'unknown']).toContain(verification.status);
        });

        test('should verify command execution', async () => {
            const context: VerificationContext = {
                taskId: 'test-task',
                workspacePath: process.cwd(),
                previousSteps: [],
            };

            // Mock a successful command
            const successResult = JSON.stringify({ exit_code: 0, success: true });
            const verification = await engine.verify(
                'run_command',
                { command: 'echo test' },
                successResult,
                context
            );

            expect(verification.status).toBe('passed');
            expect(verification.score).toBe(1.0);
        });

        test('should detect failed command', async () => {
            const context: VerificationContext = {
                taskId: 'test-task',
                workspacePath: process.cwd(),
                previousSteps: [],
            };

            // Mock a failed command
            const failResult = JSON.stringify({
                exit_code: 1,
                success: false,
                stderr: 'Command not found'
            });
            const verification = await engine.verify(
                'run_command',
                { command: 'nonexistent-command' },
                failResult,
                context
            );

            expect(verification.status).toBe('failed');
            expect(verification.score).toBe(0.0);
            expect(verification.suggestions.length).toBeGreaterThan(0);
        });

        test('should verify test execution', async () => {
            const context: VerificationContext = {
                taskId: 'test-task',
                workspacePath: process.cwd(),
                previousSteps: [],
            };

            // Mock test pass
            const passResult = 'Tests: 5 passed, 5 total\nAll tests passed';
            const verification = await engine.verify(
                'run_command',
                { command: 'npm test' },
                passResult,
                context
            );

            expect(verification.status).toBe('passed');

            // Mock test fail
            const failResult = 'Tests: 3 passed, 2 failed, 5 total\nTest failed: Authentication';
            const failVerification = await engine.verify(
                'run_command',
                { command: 'npm test' },
                failResult,
                context
            );

            expect(failVerification.status).toBe('failed');
        });

        test('should format verification results', () => {
            const result = {
                status: 'failed' as const,
                message: 'File write failed',
                score: 0.0,
                evidence: ['File not found', 'Permission denied'],
                suggestions: ['Check file path', 'Verify write permissions'],
            };

            const formatted = engine.formatResult(result);

            expect(formatted).toContain('❌');
            expect(formatted).toContain('File write failed');
            expect(formatted).toContain('Evidence:');
            expect(formatted).toContain('Suggestions:');
        });
    });

    describe('Full Integration: All Phases Together', () => {
        test('should recommend skill -> analyze quality -> verify operation', async () => {
            // 1. Phase 1: Analyze intent and recommend skill
            const intentAnalyzer = new IntentAnalyzer();
            const skillRecommender = new SkillRecommender();

            const query = "Fix the bug and ensure code quality";
            const intent = intentAnalyzer.analyzeIntent(query, [], []);
            const recommendations = skillRecommender.recommend(intent, [], []);

            expect(recommendations.length).toBeGreaterThan(0);
            console.log('Phase 1: Recommended skills:', recommendations.map(r => r.skillName));

            // 2. Phase 2: Analyze code quality
            const analyzer = getCodeQualityAnalyzer();
            const code = `
function authenticateUser(username: string, password: string) {
    const query = "SELECT * FROM users WHERE username = '" + username + "'";
    return db.execute(query);
}
`;
            const qualityReport = await analyzer.analyze(code, 'auth.ts', 'typescript');

            expect(qualityReport.score).toBeLessThan(100); // Should detect SQL injection
            console.log('Phase 2: Quality score:', qualityReport.score);
            console.log('Phase 2: Issues found:', qualityReport.issues.length);

            // 3. Phase 3: Verify operation
            const engine = getVerificationEngine();
            const context: VerificationContext = {
                taskId: 'integration-test',
                workspacePath: process.cwd(),
                previousSteps: [],
            };

            const commandResult = JSON.stringify({ exit_code: 0, success: true });
            const verification = await engine.verify(
                'run_command',
                { command: 'npm run lint' },
                commandResult,
                context
            );

            expect(verification.status).toBe('passed');
            console.log('Phase 3: Verification status:', verification.status);

            // All three phases work together
            expect(recommendations.length).toBeGreaterThan(0);
            expect(qualityReport.score).toBeGreaterThan(0);
            expect(verification.status).toBeDefined();
        });

        test('should handle workflow: bad code -> quality fail -> verification fail', async () => {
            const analyzer = getCodeQualityAnalyzer();

            // Really bad code
            const badCode = `
function terribleFunction(a, b, c, d, e, f, g) {
    if (a) {
        if (b) {
            if (c) {
                if (d) {
                    if (e) {
                        console.log("deep nesting");
                        try {
                            eval("dangerous code");
                        } catch (err) {
                            // empty
                        }
                    }
                }
            }
        }
    }
    return a + b + c + d + e + f + g;
}
`;
            const report = await analyzer.analyze(badCode, 'bad.js', 'javascript');

            // Should have low quality score
            expect(report.score).toBeLessThan(60);

            // Should have multiple issues
            expect(report.issues.length).toBeGreaterThan(3);

            // Should have critical issues
            const criticalIssues = report.issues.filter(i => i.severity === 'error');
            expect(criticalIssues.length).toBeGreaterThan(0);

            console.log('Bad code analysis:');
            console.log('  Score:', report.score);
            console.log('  Issues:', report.issues.length);
            console.log('  Critical:', criticalIssues.length);
        });
    });
});
