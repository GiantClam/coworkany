/**
 * Code Quality Tools
 *
 * Tools for checking code quality, complexity, and security issues
 */

import { getCodeQualityAnalyzer } from '../agent/codeQuality';
import type { ToolDefinition, ToolContext } from './standard';
import type { CodeQualityConfig } from '../agent/codeQuality/types';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Check code quality of a file or code snippet
 */
const checkCodeQualityTool: ToolDefinition = {
    name: 'check_code_quality',
    description: 'Analyze code for quality issues including complexity, security vulnerabilities, and code smells. Use this tool after writing or modifying code to ensure it meets quality standards.',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            code: {
                type: 'string',
                description: 'Code content to analyze (if not providing file_path)',
            },
            file_path: {
                type: 'string',
                description: 'Path to file to analyze (relative to workspace root)',
            },
            language: {
                type: 'string',
                enum: ['typescript', 'javascript', 'python', 'rust', 'go', 'java'],
                description: 'Programming language of the code',
            },
            max_complexity: {
                type: 'number',
                description: 'Maximum allowed cyclomatic complexity (default: 10)',
            },
            enable_security_checks: {
                type: 'boolean',
                description: 'Enable security vulnerability checks (default: true)',
            },
        },
        required: ['language'],
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
        try {
            const language = args.language as string;
            const maxComplexity = (args.max_complexity as number) ?? 10;
            const enableSecurityChecks = (args.enable_security_checks as boolean) ?? true;

            let code: string;
            let filePath: string;

            // Get code content
            if (args.file_path) {
                filePath = args.file_path as string;
                const fullPath = path.join(context.workspacePath, filePath);
                code = await fs.readFile(fullPath, 'utf-8');
            } else if (args.code) {
                code = args.code as string;
                filePath = '<inline>';
            } else {
                throw new Error('Either code or file_path must be provided');
            }

            // Configure analyzer
            const config: Partial<CodeQualityConfig> = {
                maxComplexity,
                enableSecurityChecks,
                enableComplexityChecks: true,
                enableStyleChecks: true,
            };

            // Analyze code
            const analyzer = getCodeQualityAnalyzer(config);
            const report = await analyzer.analyze(code, filePath, language);

            // Format and return
            const formatted = analyzer.formatReport(report);

            return JSON.stringify({
                success: true,
                report: {
                    filePath: report.filePath,
                    language: report.language,
                    score: report.score,
                    metrics: report.metrics,
                    issueCount: report.issues.length,
                    errors: report.issues.filter(i => i.severity === 'error').length,
                    warnings: report.issues.filter(i => i.severity === 'warning').length,
                    issues: report.issues,
                },
                formatted,
            });
        } catch (error) {
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    },
};

/**
 * Get quality metrics for a file
 */
const getQualityMetricsTool: ToolDefinition = {
    name: 'get_quality_metrics',
    description: 'Get complexity and maintainability metrics for a file without full analysis. Faster than check_code_quality for quick metrics.',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            file_path: {
                type: 'string',
                description: 'Path to file to analyze (relative to workspace root)',
            },
            language: {
                type: 'string',
                enum: ['typescript', 'javascript', 'python', 'rust', 'go', 'java'],
                description: 'Programming language of the code',
            },
        },
        required: ['file_path', 'language'],
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
        try {
            const filePath = args.file_path as string;
            const language = args.language as string;

            const fullPath = path.join(context.workspacePath, filePath);
            const code = await fs.readFile(fullPath, 'utf-8');

            // Analyze with minimal checks
            const analyzer = getCodeQualityAnalyzer({
                enableSecurityChecks: false,
                enableComplexityChecks: true,
                enableStyleChecks: false,
            });

            const report = await analyzer.analyze(code, filePath, language);

            return JSON.stringify({
                success: true,
                metrics: report.metrics,
                score: report.score,
            });
        } catch (error) {
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    },
};

/**
 * Batch check multiple files
 */
const batchCheckQualityTool: ToolDefinition = {
    name: 'batch_check_quality',
    description: 'Check code quality for multiple files at once. Returns aggregated results.',
    effects: ['filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            file_paths: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of file paths to analyze',
            },
            language: {
                type: 'string',
                enum: ['typescript', 'javascript', 'python', 'rust', 'go', 'java'],
                description: 'Programming language (assumes all files are same language)',
            },
        },
        required: ['file_paths', 'language'],
    },
    handler: async (args: Record<string, unknown>, context: ToolContext) => {
        try {
            const filePaths = args.file_paths as string[];
            const language = args.language as string;

            const analyzer = getCodeQualityAnalyzer();
            const results = [];
            let totalScore = 0;
            let totalErrors = 0;
            let totalWarnings = 0;

            for (const filePath of filePaths) {
                try {
                    const fullPath = path.join(context.workspacePath, filePath);
                    const code = await fs.readFile(fullPath, 'utf-8');
                    const report = await analyzer.analyze(code, filePath, language);

                    results.push({
                        filePath: report.filePath,
                        score: report.score,
                        issues: report.issues.length,
                        errors: report.issues.filter(i => i.severity === 'error').length,
                        warnings: report.issues.filter(i => i.severity === 'warning').length,
                    });

                    totalScore += report.score;
                    totalErrors += report.issues.filter(i => i.severity === 'error').length;
                    totalWarnings += report.issues.filter(i => i.severity === 'warning').length;
                } catch (error) {
                    results.push({
                        filePath,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            const averageScore = Math.round(totalScore / filePaths.length);

            return JSON.stringify({
                success: true,
                summary: {
                    filesAnalyzed: filePaths.length,
                    averageScore,
                    totalErrors,
                    totalWarnings,
                },
                results,
            });
        } catch (error) {
            return JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    },
};

export const CODE_QUALITY_TOOLS: ToolDefinition[] = [
    checkCodeQualityTool,
    getQualityMetricsTool,
    batchCheckQualityTool,
];
