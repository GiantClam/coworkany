/**
 * Automatic Verification Engine
 *
 * Verifies that tool executions achieved their intended goals
 */

import type {
    VerificationStrategy,
    VerificationResult,
    VerificationContext,
    VerificationConfig,
    DEFAULT_VERIFICATION_CONFIG,
} from './types';
import * as fs from 'fs/promises';
import * as path from 'path';

export class VerificationEngine {
    private strategies: VerificationStrategy[] = [];
    private config: VerificationConfig;

    constructor(config?: Partial<VerificationConfig>) {
        this.config = {
            enabled: true,
            autoCorrect: true,
            requiredConfidence: 0.7,
            maxRetries: 3,
            ...config,
        };

        // Register built-in strategies
        this.registerBuiltInStrategies();
    }

    /**
     * Register a verification strategy
     */
    registerStrategy(strategy: VerificationStrategy): void {
        this.strategies.push(strategy);
    }

    /**
     * Verify a tool execution
     */
    async verify(
        toolName: string,
        args: Record<string, unknown>,
        result: string,
        context: VerificationContext
    ): Promise<VerificationResult> {
        if (!this.config.enabled) {
            return {
                status: 'skipped',
                message: 'Verification disabled',
                score: 0,
                evidence: [],
                suggestions: [],
            };
        }

        // Find applicable strategies
        const applicableStrategies = this.strategies.filter(s =>
            s.canVerify(toolName, args, result)
        );

        if (applicableStrategies.length === 0) {
            return {
                status: 'unknown',
                message: 'No verification strategy available',
                score: 0.5,
                evidence: ['No applicable verification strategy found'],
                suggestions: [],
            };
        }

        // Run all applicable strategies
        const results = await Promise.all(
            applicableStrategies.map(s => s.verify(toolName, args, result, context))
        );

        // Aggregate results (use the most confident one)
        const bestResult = results.reduce((best, current) =>
            current.score > best.score ? current : best
        );

        return bestResult;
    }

    /**
     * Register built-in verification strategies
     */
    private registerBuiltInStrategies(): void {
        // File write verification
        this.registerStrategy({
            name: 'file_write_verification',
            description: 'Verify file was written successfully',
            canVerify: (toolName, args, result) => {
                return toolName === 'write_file' || toolName === 'create_file';
            },
            verify: async (toolName, args, result, context) => {
                const filePath = args.file_path as string;
                const fullPath = path.join(context.workspacePath, filePath);

                try {
                    // Check if file exists
                    await fs.access(fullPath);

                    // Check if content matches
                    const content = await fs.readFile(fullPath, 'utf-8');
                    const expectedContent = args.content as string;

                    if (content === expectedContent) {
                        return {
                            status: 'passed',
                            message: `File ${filePath} written successfully`,
                            score: 1.0,
                            evidence: [
                                'File exists',
                                'Content matches expected',
                            ],
                            suggestions: [],
                        };
                    } else {
                        return {
                            status: 'failed',
                            message: `File ${filePath} exists but content differs`,
                            score: 0.5,
                            evidence: [
                                'File exists',
                                'Content mismatch',
                            ],
                            suggestions: [
                                'Verify the write operation completed',
                                'Check for concurrent modifications',
                            ],
                        };
                    }
                } catch (error) {
                    return {
                        status: 'failed',
                        message: `File ${filePath} not found after write`,
                        score: 0.0,
                        evidence: [
                            `Error: ${error instanceof Error ? error.message : String(error)}`,
                        ],
                        suggestions: [
                            'Check file path is correct',
                            'Verify write permissions',
                            'Retry the write operation',
                        ],
                    };
                }
            },
        });

        // File edit verification
        this.registerStrategy({
            name: 'file_edit_verification',
            description: 'Verify file was edited successfully',
            canVerify: (toolName, args, result) => {
                return toolName === 'edit_file' || toolName === 'replace_in_file';
            },
            verify: async (toolName, args, result, context) => {
                const filePath = args.file_path as string;
                const fullPath = path.join(context.workspacePath, filePath);

                try {
                    const content = await fs.readFile(fullPath, 'utf-8');
                    const newString = args.new_string as string;

                    if (content.includes(newString)) {
                        return {
                            status: 'passed',
                            message: `File ${filePath} edited successfully`,
                            score: 1.0,
                            evidence: [
                                'File exists',
                                'New content found in file',
                            ],
                            suggestions: [],
                        };
                    } else {
                        return {
                            status: 'failed',
                            message: `Edit to ${filePath} may have failed`,
                            score: 0.3,
                            evidence: [
                                'File exists',
                                'New content not found in file',
                            ],
                            suggestions: [
                                'Verify the old_string was found',
                                'Check if edit was applied correctly',
                                'Read the file to confirm changes',
                            ],
                        };
                    }
                } catch (error) {
                    return {
                        status: 'failed',
                        message: `Cannot verify edit to ${filePath}`,
                        score: 0.0,
                        evidence: [
                            `Error: ${error instanceof Error ? error.message : String(error)}`,
                        ],
                        suggestions: [
                            'Check file path is correct',
                            'Verify file exists',
                        ],
                    };
                }
            },
        });

        // Command execution verification
        this.registerStrategy({
            name: 'command_verification',
            description: 'Verify command executed successfully',
            canVerify: (toolName, args, result) => {
                return toolName === 'run_command' || toolName === 'execute_shell';
            },
            verify: async (toolName, args, result, context) => {
                try {
                    // Parse result (assuming JSON)
                    const resultObj = JSON.parse(result);

                    const exitCode = resultObj.exit_code ?? resultObj.exitCode;
                    const success = resultObj.success;

                    // Check exit code
                    if (exitCode === 0 || success === true) {
                        return {
                            status: 'passed',
                            message: 'Command executed successfully',
                            score: 1.0,
                            evidence: [
                                `Exit code: ${exitCode ?? 'success'}`,
                                'No errors detected',
                            ],
                            suggestions: [],
                        };
                    } else {
                        const stderr = resultObj.stderr || '';
                        return {
                            status: 'failed',
                            message: 'Command execution failed',
                            score: 0.0,
                            evidence: [
                                `Exit code: ${exitCode}`,
                                stderr ? `Error: ${stderr.substring(0, 200)}` : 'Command failed',
                            ],
                            suggestions: [
                                'Check error message for details',
                                'Verify command syntax',
                                'Check if required tools are installed',
                            ],
                        };
                    }
                } catch (error) {
                    // If result is not JSON, check for error keywords
                    const lowerResult = result.toLowerCase();
                    const hasError = lowerResult.includes('error') ||
                                   lowerResult.includes('failed') ||
                                   lowerResult.includes('exception');

                    if (hasError) {
                        return {
                            status: 'failed',
                            message: 'Command appears to have failed',
                            score: 0.2,
                            evidence: [
                                'Error keywords found in output',
                            ],
                            suggestions: [
                                'Review command output for error details',
                                'Try running the command manually',
                            ],
                        };
                    } else {
                        return {
                            status: 'unknown',
                            message: 'Cannot determine command status',
                            score: 0.5,
                            evidence: [
                                'Unable to parse command result',
                            ],
                            suggestions: [],
                        };
                    }
                }
            },
        });

        // Test execution verification
        this.registerStrategy({
            name: 'test_verification',
            description: 'Verify tests passed',
            canVerify: (toolName, args, result) => {
                const command = args.command as string;
                return !!(toolName === 'run_command' && command && (
                    command.includes('test') ||
                    command.includes('jest') ||
                    command.includes('mocha') ||
                    command.includes('pytest')
                ));
            },
            verify: async (toolName, args, result, context) => {
                const lowerResult = result.toLowerCase();

                // Check for test pass indicators
                const passIndicators = [
                    'all tests passed',
                    'tests passed',
                    '0 failed',
                    'ok',
                    'passed:',
                ];

                const failIndicators = [
                    'failed',
                    'failures',
                    'error',
                    'test failed',
                ];

                const hasPassed = passIndicators.some(ind => lowerResult.includes(ind));
                const hasFailed = failIndicators.some(ind => lowerResult.includes(ind));

                if (hasPassed && !hasFailed) {
                    return {
                        status: 'passed',
                        message: 'Tests passed successfully',
                        score: 1.0,
                        evidence: [
                            'Test pass indicators found',
                            'No failure indicators',
                        ],
                        suggestions: [],
                    };
                } else if (hasFailed) {
                    return {
                        status: 'failed',
                        message: 'Tests failed',
                        score: 0.0,
                        evidence: [
                            'Test failure indicators found',
                        ],
                        suggestions: [
                            'Review test output for failure details',
                            'Fix failing tests before proceeding',
                        ],
                    };
                } else {
                    return {
                        status: 'unknown',
                        message: 'Cannot determine test status',
                        score: 0.5,
                        evidence: [
                            'No clear pass/fail indicators',
                        ],
                        suggestions: [
                            'Review test output manually',
                        ],
                    };
                }
            },
        });

        // Build verification
        this.registerStrategy({
            name: 'build_verification',
            description: 'Verify build succeeded',
            canVerify: (toolName, args, result) => {
                const command = args.command as string;
                return !!(toolName === 'run_command' && command && (
                    command.includes('build') ||
                    command.includes('compile') ||
                    command.includes('tsc') ||
                    command.includes('webpack')
                ));
            },
            verify: async (toolName, args, result, context) => {
                const lowerResult = result.toLowerCase();

                // Check for build success indicators
                const successIndicators = [
                    'build succeeded',
                    'built successfully',
                    'compiled successfully',
                    'done in',
                ];

                const errorIndicators = [
                    'build failed',
                    'compilation error',
                    'error ts',
                    'syntax error',
                ];

                const hasSuccess = successIndicators.some(ind => lowerResult.includes(ind));
                const hasErrors = errorIndicators.some(ind => lowerResult.includes(ind));

                if (hasSuccess && !hasErrors) {
                    return {
                        status: 'passed',
                        message: 'Build completed successfully',
                        score: 1.0,
                        evidence: [
                            'Build success indicators found',
                            'No error indicators',
                        ],
                        suggestions: [],
                    };
                } else if (hasErrors) {
                    return {
                        status: 'failed',
                        message: 'Build failed with errors',
                        score: 0.0,
                        evidence: [
                            'Build error indicators found',
                        ],
                        suggestions: [
                            'Review build errors',
                            'Fix compilation errors',
                            'Check for missing dependencies',
                        ],
                    };
                } else {
                    return {
                        status: 'unknown',
                        message: 'Cannot determine build status',
                        score: 0.5,
                        evidence: [
                            'No clear success/error indicators',
                        ],
                        suggestions: [
                            'Check build output manually',
                        ],
                    };
                }
            },
        });

        // Code quality verification (integrates with Phase 2)
        this.registerStrategy({
            name: 'quality_verification',
            description: 'Verify code quality after modifications',
            canVerify: (toolName, args, result) => {
                return toolName === 'write_file' ||
                       toolName === 'edit_file' ||
                       toolName === 'create_file';
            },
            verify: async (toolName, args, result, context) => {
                const filePath = args.file_path as string;

                // Check if file is code
                const codeExtensions = ['.ts', '.js', '.py', '.rs', '.go', '.java'];
                const isCodeFile = codeExtensions.some(ext => filePath.endsWith(ext));

                if (!isCodeFile) {
                    return {
                        status: 'skipped',
                        message: 'Not a code file, skipping quality check',
                        score: 0.5,
                        evidence: ['File is not a code file'],
                        suggestions: [],
                    };
                }

                // Note: Actual quality check would integrate with CodeQualityAnalyzer
                // For now, return a placeholder
                return {
                    status: 'unknown',
                    message: 'Code quality check not yet integrated',
                    score: 0.5,
                    evidence: ['Quality check integration pending'],
                    suggestions: [
                        'Run check_code_quality tool manually',
                    ],
                };
            },
        });
    }

    /**
     * Format verification result as human-readable text
     */
    formatResult(result: VerificationResult): string {
        const lines: string[] = [];

        // Status icon
        const statusIcon = {
            passed: '✅',
            failed: '❌',
            skipped: '⏭️',
            unknown: '❓',
        }[result.status];

        lines.push(`${statusIcon} Verification: ${result.message}`);
        lines.push(`Confidence: ${(result.score * 100).toFixed(0)}%`);

        if (result.evidence.length > 0) {
            lines.push('');
            lines.push('Evidence:');
            result.evidence.forEach(e => lines.push(`  • ${e}`));
        }

        if (result.suggestions.length > 0) {
            lines.push('');
            lines.push('Suggestions:');
            result.suggestions.forEach(s => lines.push(`  💡 ${s}`));
        }

        return lines.join('\n');
    }
}

// Singleton instance
let instance: VerificationEngine | null = null;

export function getVerificationEngine(config?: Partial<VerificationConfig>): VerificationEngine {
    if (!instance) {
        instance = new VerificationEngine(config);
    }
    return instance;
}
