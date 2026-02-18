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

        // 3. Calculate success
        const passedCount = testResults.filter(r => r.passed).length;
        const success = passedCount >= testResults.length * 0.7;  // 70% pass rate

        return {
            success,
            testResults,
            installedDependencies,
            discoveredIssues,
            refinements,
            executionTimeMs: Date.now() - startTime,
            finalWorkingCode,
            retryCount,
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
        // Basic success check
        if (!result.success || result.exitCode !== 0) {
            return false;
        }

        // Check for explicit success markers
        const output = result.stdout.toLowerCase();
        if (output.includes('success') || output.includes('passed') || output.includes('ok')) {
            return true;
        }

        // Check for explicit failure markers
        if (output.includes('failed') || output.includes('error') || output.includes('exception')) {
            return false;
        }

        // If no explicit markers and exit code is 0, consider it passed
        return result.exitCode === 0;
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
        testCases: TestCase[]
    ): ExperimentConfig {
        return {
            knowledge,
            testCases,
            maxRetries: this.config.maxExperimentRetries,
            timeoutMs: 30000,
            isolationLevel: this.config.experimentIsolation,
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
            });
        }

        // Test first step if procedure
        if (knowledge.steps && knowledge.steps.length > 0) {
            testCases.push({
                id: crypto.randomUUID(),
                name: 'First step execution',
                input: knowledge.steps[0],
                expectedBehavior: 'First step completes',
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
            });
        }

        return testCases;
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
