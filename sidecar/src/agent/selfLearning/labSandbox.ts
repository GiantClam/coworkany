/**
 * CoworkAny - Lab Sandbox
 *
 * Executes experiments to validate learned knowledge in an isolated environment.
 * Integrates with CodeExecutor for safe code execution and SelfCorrectionEngine for auto-fix.
 */

import * as crypto from 'crypto';
import type {
    ProcessedKnowledge,
    TestCase,
    TestResult,
    ExperimentConfig,
    ExperimentResult,
    SelfLearningConfig,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ============================================================================
// Types
// ============================================================================

export interface CodeExecutionResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    executionTimeMs: number;
}

export interface DependencyInstallResult {
    package: string;
    success: boolean;
    error?: string;
}

export interface LabSandboxDependencies {
    /**
     * Execute code in sandbox
     */
    executeCode: (code: string, language: string, timeoutMs?: number) => Promise<CodeExecutionResult>;

    /**
     * Install a dependency package
     */
    installDependency: (pkg: string, language: string) => Promise<DependencyInstallResult>;

    /**
     * Analyze error and suggest fix (from SelfCorrectionEngine)
     */
    analyzeError?: (stderr: string, code: string) => {
        suggestedFix?: string;
        canAutoRetry: boolean;
    };
}

// ============================================================================
// LabSandbox Class
// ============================================================================

export class LabSandbox {
    private config: SelfLearningConfig;
    private deps: LabSandboxDependencies;

    constructor(
        deps: LabSandboxDependencies,
        config?: Partial<SelfLearningConfig>
    ) {
        this.deps = deps;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ========================================================================
    // Main Experiment Method
    // ========================================================================

    /**
     * Run a complete experiment to validate knowledge
     */
    async runExperiment(config: ExperimentConfig): Promise<ExperimentResult> {
        const startTime = Date.now();
        const testResults: TestResult[] = [];
        const installedDependencies: string[] = [];
        const discoveredIssues: string[] = [];
        const refinements: string[] = [];
        let retryCount = 0;
        let finalWorkingCode: string | undefined;

        // 1. Setup dependencies
        const depResult = await this.setupDependencies(config.knowledge.dependencies);
        installedDependencies.push(...depResult.installed);

        if (depResult.failed.length > 0) {
            discoveredIssues.push(`Failed to install: ${depResult.failed.join(', ')}`);
        }

        // 2. Run test cases with retry
        for (const testCase of config.testCases) {
            let result = await this.runTestCase(testCase, config);

            // Auto-retry on failure
            while (!result.passed && retryCount < config.maxRetries) {
                retryCount++;

                const fixAttempt = await this.attemptFix(testCase, result, config.knowledge);
                if (fixAttempt.fixed) {
                    refinements.push(fixAttempt.refinement);
                    result = await this.runTestCase(
                        { ...testCase, input: fixAttempt.modifiedInput },
                        config
                    );

                    if (result.passed) {
                        finalWorkingCode = fixAttempt.modifiedInput;
                    }
                } else {
                    break;
                }
            }

            testResults.push(result);

            if (!result.passed) {
                discoveredIssues.push(`Test "${testCase.name}" failed: ${result.error || 'Unknown error'}`);
            }
        }

        const validationPolicy = config.validationPolicy ?? {
            positivePassRateThreshold: 0.9,
            negativeRejectRateThreshold: 0.95,
            requireNegativeExamples: config.sideEffectRisk === 'write_external',
            requireNoUnauthorizedExternalCalls: true,
            requireReplaySuitability: config.sideEffectRisk === 'write_external',
        };
        const unauthorizedExternalCalls = this.detectUnauthorizedExternalCalls(config);
        const structuralValidationPassed =
            (!validationPolicy.requireNoUnauthorizedExternalCalls || unauthorizedExternalCalls.length === 0)
            && depResult.failed.length === 0;
        const positiveTests = testResults.filter((result) => (result.testCase.expectation ?? 'success') === 'success');
        const negativeTests = testResults.filter((result) => (result.testCase.expectation ?? 'success') === 'reject');
        const positivePassed = positiveTests.filter((result) => result.passed).length;
        const negativeRejected = negativeTests.filter((result) => result.passed).length;
        const positivePassRate = positiveTests.length > 0 ? positivePassed / positiveTests.length : 1;
        const negativeRejectRate = negativeTests.length > 0 ? negativeRejected / negativeTests.length : 1;
        const replaySuitability = this.inferReplaySuitability(config);
        const replaySuitabilityPassed = !validationPolicy.requireReplaySuitability || (
            replaySuitability.deterministicEnough
            && replaySuitability.duplicateRiskHandled
            && replaySuitability.rollbackOrSafeAbortDefined
        );
        const hasRequiredNegativeExamples = !validationPolicy.requireNegativeExamples || negativeTests.length > 0;
        const success =
            structuralValidationPassed
            && positivePassRate >= validationPolicy.positivePassRateThreshold
            && negativeRejectRate >= validationPolicy.negativeRejectRateThreshold
            && hasRequiredNegativeExamples
            && replaySuitabilityPassed;

        if (unauthorizedExternalCalls.length > 0) {
            discoveredIssues.push(...unauthorizedExternalCalls.map((entry) => `Unauthorized external call pattern detected: ${entry}`));
        }
        if (!hasRequiredNegativeExamples) {
            discoveredIssues.push('Validation did not include the required negative examples for this capability risk tier.');
        }
        if (!replaySuitabilityPassed) {
            discoveredIssues.push('Replay suitability requirements were not fully demonstrated for this capability.');
        }

        return {
            success,
            testResults,
            installedDependencies,
            discoveredIssues,
            refinements,
            executionTimeMs: Date.now() - startTime,
            finalWorkingCode,
            retryCount,
            validationSummary: {
                structuralValidationPassed,
                noUnauthorizedExternalCalls: unauthorizedExternalCalls.length === 0,
                positivePassRate,
                negativeRejectRate,
                hasNegativeExamples: negativeTests.length > 0,
                replaySuitability,
            },
        };
    }

    // ========================================================================
    // Dependency Management
    // ========================================================================

    /**
     * Install and verify dependencies
     */
    async setupDependencies(deps: string[]): Promise<{
        installed: string[];
        failed: string[];
    }> {
        const installed: string[] = [];
        const failed: string[] = [];

        for (const dep of deps) {
            // Detect language from package name patterns
            const language = this.detectLanguage(dep);

            try {
                const result = await this.deps.installDependency(dep, language);

                if (result.success) {
                    installed.push(dep);
                } else {
                    failed.push(dep);
                }
            } catch (error) {
                failed.push(dep);
            }
        }

        return { installed, failed };
    }

    /**
     * Detect language from package name
     */
    private detectLanguage(pkg: string): string {
        // Common Python package patterns
        if (/^(py|python|pip|numpy|pandas|scipy|matplotlib|requests|flask|django)/i.test(pkg)) {
            return 'python';
        }

        // Common JavaScript package patterns
        if (/^(@|react|vue|angular|express|lodash|axios|webpack|babel)/i.test(pkg)) {
            return 'javascript';
        }

        // Default to Python (more common for data/ML tasks)
        return 'python';
    }

    // ========================================================================
    // Test Execution
    // ========================================================================

    /**
     * Run a single test case
     */
    private async runTestCase(
        testCase: TestCase,
        config: ExperimentConfig
    ): Promise<TestResult> {
        const startTime = Date.now();

        try {
            // Determine code to execute
            const code = testCase.validationScript || testCase.input;
            const language = this.detectCodeLanguage(code);

            // Execute with timeout
            const result = await this.deps.executeCode(
                code,
                language,
                config.timeoutMs
            );

            // Determine pass/fail
            const passed = this.evaluateResult(result, testCase);

            return {
                testCase,
                passed,
                output: result.stdout,
                error: result.success ? undefined : result.stderr,
                executionTimeMs: Date.now() - startTime,
            };
        } catch (error) {
            return {
                testCase,
                passed: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                executionTimeMs: Date.now() - startTime,
            };
        }
    }

    /**
     * Evaluate execution result against expected behavior
     */
    private evaluateResult(
        result: CodeExecutionResult,
        testCase: TestCase
    ): boolean {
        const expectation = testCase.expectation ?? 'success';
        // Basic success check
        if (!result.success || result.exitCode !== 0) {
            return expectation === 'reject';
        }

        // Check for explicit success markers
        const output = result.stdout.toLowerCase();
        if (output.includes('success') || output.includes('passed') || output.includes('ok')) {
            return expectation === 'success';
        }

        // Check for explicit failure markers
        if (output.includes('failed') || output.includes('error') || output.includes('exception')) {
            return expectation === 'reject';
        }

        // If no explicit markers and exit code is 0, consider it passed
        return expectation === 'success' ? result.exitCode === 0 : false;
    }

    /**
     * Detect programming language from code
     */
    private detectCodeLanguage(code: string): string {
        // Python indicators
        if (/^import\s+\w+|^from\s+\w+\s+import|def\s+\w+\(|print\(/.test(code)) {
            return 'python';
        }

        // JavaScript indicators
        if (/const\s+\w+|let\s+\w+|var\s+\w+|function\s+\w+|=>\s*{|require\(|import\s+.*from/.test(code)) {
            return 'javascript';
        }

        // Shell indicators
        if (/^#!\/bin\/(bash|sh)|^\$\s+|^pip\s+|^npm\s+|^apt\s+|^brew\s+/.test(code)) {
            return 'shell';
        }

        // Default to Python
        return 'python';
    }

    // ========================================================================
    // Auto-Fix
    // ========================================================================

    /**
     * Attempt to fix a failed test
     */
    private async attemptFix(
        testCase: TestCase,
        failedResult: TestResult,
        knowledge: ProcessedKnowledge
    ): Promise<{
        fixed: boolean;
        modifiedInput: string;
        refinement: string;
    }> {
        const error = failedResult.error || '';

        // Try error analysis if available
        if (this.deps.analyzeError) {
            const analysis = this.deps.analyzeError(error, testCase.input);
            if (analysis.suggestedFix && analysis.canAutoRetry) {
                const modifiedInput = this.applyFix(testCase.input, analysis.suggestedFix, error);
                return {
                    fixed: true,
                    modifiedInput,
                    refinement: `Applied fix: ${analysis.suggestedFix}`,
                };
            }
        }

        // Try common fixes
        const commonFix = this.tryCommonFixes(testCase.input, error);
        if (commonFix) {
            return {
                fixed: true,
                modifiedInput: commonFix.code,
                refinement: commonFix.description,
            };
        }

        return {
            fixed: false,
            modifiedInput: testCase.input,
            refinement: '',
        };
    }

    /**
     * Apply a suggested fix to code
     */
    private applyFix(code: string, suggestion: string, error: string): string {
        // Handle missing imports
        if (/ModuleNotFoundError|ImportError|Cannot find module/.test(error)) {
            const moduleMatch = error.match(/['"]([^'"]+)['"]/);
            if (moduleMatch) {
                const moduleName = moduleMatch[1].split('.')[0];
                // Add import at the beginning
                if (!code.includes(`import ${moduleName}`)) {
                    return `import ${moduleName}\n${code}`;
                }
            }
        }

        // Handle syntax errors - try to fix common issues
        if (/SyntaxError/.test(error)) {
            // Fix missing colons
            code = code.replace(/^(\s*)(def|if|else|elif|for|while|class|try|except|finally|with)\s+([^:]+)$/gm, '$1$2 $3:');

            // Fix unclosed parentheses (simple cases)
            const openParens = (code.match(/\(/g) || []).length;
            const closeParens = (code.match(/\)/g) || []).length;
            if (openParens > closeParens) {
                code += ')'.repeat(openParens - closeParens);
            }
        }

        // Handle indentation errors
        if (/IndentationError/.test(error)) {
            // Normalize indentation to 4 spaces
            const lines = code.split('\n');
            const fixedLines = lines.map(line => {
                const match = line.match(/^(\s*)/);
                if (match) {
                    const spaces = match[1].replace(/\t/g, '    ');
                    return spaces + line.trimStart();
                }
                return line;
            });
            return fixedLines.join('\n');
        }

        return code;
    }

    /**
     * Try common fixes for known error patterns
     */
    private tryCommonFixes(code: string, error: string): { code: string; description: string } | null {
        // Fix: Missing print statement for output
        if (error.includes('no output') || error.includes('empty output')) {
            if (!code.includes('print(')) {
                const lines = code.split('\n');
                const lastLine = lines[lines.length - 1].trim();
                if (lastLine && !lastLine.startsWith('#') && !lastLine.endsWith(':')) {
                    lines[lines.length - 1] = `print(${lastLine})`;
                    return {
                        code: lines.join('\n'),
                        description: 'Added print statement for output',
                    };
                }
            }
        }

        // Fix: Add shebang for shell scripts
        if (error.includes('permission denied') && !code.startsWith('#!')) {
            return {
                code: '#!/bin/bash\n' + code,
                description: 'Added shebang for shell script',
            };
        }

        // Fix: Handle Python 2 vs 3 print
        if (error.includes('SyntaxError') && code.includes('print ')) {
            return {
                code: code.replace(/print\s+([^(].*?)$/gm, 'print($1)'),
                description: 'Converted Python 2 print to Python 3',
            };
        }

        // Fix: f-string in older Python
        if (error.includes('SyntaxError') && code.includes('f"') || code.includes("f'")) {
            const fixed = code.replace(/f(['"])(.*?)\1/g, (match, quote, content) => {
                const vars = content.match(/\{(\w+)\}/g) || [];
                let result = content;
                const varNames: string[] = [];
                vars.forEach((v: string) => {
                    const varName = v.slice(1, -1);
                    result = result.replace(v, '{}');
                    varNames.push(varName);
                });
                return `${quote}${result}${quote}.format(${varNames.join(', ')})`;
            });
            return {
                code: fixed,
                description: 'Converted f-strings to .format() for compatibility',
            };
        }

        return null;
    }

    // ========================================================================
    // Batch Execution
    // ========================================================================

    /**
     * Run multiple experiments in parallel (with limit)
     */
    async runExperimentsBatch(
        configs: ExperimentConfig[],
        concurrency: number = 2
    ): Promise<ExperimentResult[]> {
        const results: ExperimentResult[] = [];

        for (let i = 0; i < configs.length; i += concurrency) {
            const batch = configs.slice(i, i + concurrency);
            const batchResults = await Promise.all(
                batch.map(config => this.runExperiment(config))
            );
            results.push(...batchResults);
        }

        return results;
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Create experiment config from knowledge
     */
    createExperimentConfig(
        knowledge: ProcessedKnowledge,
        testCases: TestCase[],
        options?: {
            maxValidationAttempts?: number;
            sideEffectRisk?: 'none' | 'read_only' | 'write_external';
        },
    ): ExperimentConfig {
        return {
            knowledge,
            testCases,
            maxRetries: Math.max(1, options?.maxValidationAttempts ?? this.config.maxExperimentRetries),
            timeoutMs: 30000,
            isolationLevel: this.config.experimentIsolation,
            sideEffectRisk: options?.sideEffectRisk ?? 'none',
            validationPolicy: {
                positivePassRateThreshold: 0.9,
                negativeRejectRateThreshold: 0.95,
                requireNegativeExamples: (options?.sideEffectRisk ?? 'none') === 'write_external',
                requireNoUnauthorizedExternalCalls: true,
                requireReplaySuitability: (options?.sideEffectRisk ?? 'none') === 'write_external',
            },
        };
    }

    /**
     * Generate basic test cases if none provided
     */
    generateBasicTestCases(knowledge: ProcessedKnowledge): TestCase[] {
        const testCases: TestCase[] = [];

        // Test code template if available
        if (knowledge.codeTemplate) {
            testCases.push({
                id: crypto.randomUUID(),
                name: 'Code template syntax check',
                input: knowledge.codeTemplate,
                expectedBehavior: 'Code parses without syntax errors',
                expectation: 'success',
            });
            testCases.push({
                id: crypto.randomUUID(),
                name: 'Code template invalid input rejection',
                input: `${knowledge.codeTemplate}\nthis is definitely invalid syntax ###`,
                expectedBehavior: 'Invalid template input should be rejected',
                expectation: 'reject',
            });
        }

        // Test first step if procedure
        if (knowledge.steps && knowledge.steps.length > 0) {
            testCases.push({
                id: crypto.randomUUID(),
                name: 'First step execution',
                input: knowledge.steps[0],
                expectedBehavior: 'First step completes',
                expectation: 'success',
            });
        }

        // Import test for dependencies
        for (const dep of knowledge.dependencies.slice(0, 3)) {
            const language = this.detectLanguage(dep);
            const importCode = language === 'python'
                ? `import ${dep}\nprint("${dep} imported successfully")`
                : `const ${dep} = require('${dep}');\nconsole.log('${dep} imported successfully');`;

            testCases.push({
                id: crypto.randomUUID(),
                name: `Import ${dep}`,
                input: importCode,
                expectedBehavior: `${dep} can be imported`,
                expectation: 'success',
            });
        }

        testCases.push({
            id: crypto.randomUUID(),
            name: 'Reject missing dependency import',
            input: `import definitely_missing_capability_dependency\nprint('should not succeed')`,
            expectedBehavior: 'Missing dependency should be rejected',
            expectation: 'reject',
        });

        return testCases;
    }

    private detectUnauthorizedExternalCalls(config: ExperimentConfig): string[] {
        const suspiciousPatterns = [
            /https?:\/\//i,
            /\bfetch\s*\(/i,
            /\baxios\./i,
            /\brequests\.(get|post|put|delete)\b/i,
            /\bcurl\s+/i,
            /\bbrowser_(navigate|click|fill|ai_action)\b/i,
        ];
        const candidates = config.testCases.map((testCase) => testCase.validationScript || testCase.input);
        return suspiciousPatterns.flatMap((pattern) =>
            candidates.some((candidate) => pattern.test(candidate))
                ? [pattern.source]
                : []
        );
    }

    private inferReplaySuitability(config: ExperimentConfig): {
        deterministicEnough: boolean;
        duplicateRiskHandled: boolean;
        rollbackOrSafeAbortDefined: boolean;
    } {
        if (config.sideEffectRisk !== 'write_external') {
            return {
                deterministicEnough: true,
                duplicateRiskHandled: true,
                rollbackOrSafeAbortDefined: true,
            };
        }

        const evidenceText = [
            config.knowledge.summary,
            config.knowledge.detailedContent,
            config.knowledge.codeTemplate,
            ...(config.knowledge.steps ?? []),
        ]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .join('\n')
            .toLowerCase();

        return {
            deterministicEnough: Boolean(config.knowledge.steps?.length || config.knowledge.codeTemplate),
            duplicateRiskHandled: /(idempot|duplicate|already|草稿|查重|去重|重复发布|exists)/i.test(evidenceText),
            rollbackOrSafeAbortDefined: /(rollback|safe abort|abort|cancel|撤回|回滚|删除草稿|停止发布)/i.test(evidenceText),
        };
    }

    /**
     * Summarize experiment results
     */
    summarizeResults(results: ExperimentResult[]): {
        totalExperiments: number;
        successCount: number;
        failureCount: number;
        successRate: number;
        totalDependencies: string[];
        allIssues: string[];
    } {
        const successCount = results.filter(r => r.success).length;
        const allDeps = new Set<string>();
        const allIssues: string[] = [];

        for (const result of results) {
            result.installedDependencies.forEach(d => allDeps.add(d));
            allIssues.push(...result.discoveredIssues);
        }

        return {
            totalExperiments: results.length,
            successCount,
            failureCount: results.length - successCount,
            successRate: results.length > 0 ? successCount / results.length : 0,
            totalDependencies: [...allDeps],
            allIssues,
        };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createLabSandbox(
    deps: LabSandboxDependencies,
    config?: Partial<SelfLearningConfig>
): LabSandbox {
    return new LabSandbox(deps, config);
}
