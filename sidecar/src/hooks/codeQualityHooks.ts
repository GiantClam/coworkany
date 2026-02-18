/**
 * Code Quality Hooks
 * Post-tool-use hooks for code quality checks
 *
 * Based on everything-claude-code hooks:
 * - Console.log detection
 * - TypeScript validation
 * - Prettier formatting reminder
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface HookResult {
    passed: boolean;
    warning?: string;
    error?: string;
    suggestions?: string[];
}

/**
 * Check for console.log statements in code
 */
export function checkConsoleLog(filePath: string, content?: string): HookResult {
    try {
        const fileContent = content || fs.readFileSync(filePath, 'utf-8');
        const lines = fileContent.split('\n');

        const consoleLines: Array<{ line: number; content: string }> = [];

        lines.forEach((line, idx) => {
            // Skip comments
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                return;
            }

            if (line.includes('console.log') || line.includes('console.warn') || line.includes('console.error')) {
                consoleLines.push({
                    line: idx + 1,
                    content: line.trim(),
                });
            }
        });

        if (consoleLines.length > 0) {
            const warning = [
                `⚠️  检测到 ${consoleLines.length} 个 console 调试语句`,
                '',
                consoleLines.slice(0, 5).map(l => `  第 ${l.line} 行: ${l.content}`).join('\n'),
                consoleLines.length > 5 ? `  ... 还有 ${consoleLines.length - 5} 个` : '',
                '',
                '💡 提交前记得删除调试语句',
            ]
                .filter(Boolean)
                .join('\n');

            return {
                passed: true, // Warning, not blocking
                warning,
                suggestions: ['在提交代码前移除所有 console 调试语句'],
            };
        }

        return { passed: true };
    } catch (error) {
        console.error('[Hook:ConsoleLog] Error:', error);
        return {
            passed: true,
            error: `无法检查文件: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Run TypeScript type checking
 */
export function checkTypeScript(workspacePath: string, filePath: string): HookResult {
    try {
        // Check if it's a TypeScript file
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
            return { passed: true };
        }

        // Check if tsconfig.json exists
        const tsconfigPath = path.join(workspacePath, 'tsconfig.json');
        if (!fs.existsSync(tsconfigPath)) {
            return {
                passed: true,
                warning: '未找到 tsconfig.json，跳过 TypeScript 检查',
            };
        }

        // Run tsc --noEmit
        try {
            execSync('npx tsc --noEmit', {
                cwd: workspacePath,
                stdio: 'pipe',
                encoding: 'utf-8',
            });

            return {
                passed: true,
                suggestions: ['TypeScript 类型检查通过 ✓'],
            };
        } catch (error: any) {
            const stderr = error.stderr || error.stdout || '';

            // Parse TypeScript errors
            const errors = stderr
                .split('\n')
                .filter((line: string) => line.includes(filePath) || line.trim().startsWith('error TS'))
                .slice(0, 10); // Limit to 10 errors

            if (errors.length > 0) {
                return {
                    passed: false,
                    error: [
                        '❌ TypeScript 类型错误:',
                        '',
                        ...errors.map((e: string) => `  ${e}`),
                        errors.length === 10 ? '  ... 还有更多错误' : '',
                    ]
                        .filter(Boolean)
                        .join('\n'),
                    suggestions: ['修复 TypeScript 类型错误后再继续'],
                };
            }

            return { passed: true };
        }
    } catch (error) {
        console.error('[Hook:TypeScript] Error:', error);
        return {
            passed: true,
            error: `TypeScript 检查失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Check if Prettier is needed
 */
export function checkPrettier(filePath: string): HookResult {
    try {
        // Check if it's a formattable file
        const formattableExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.md'];
        const ext = path.extname(filePath);

        if (!formattableExtensions.includes(ext)) {
            return { passed: true };
        }

        // Check if prettier is available
        try {
            execSync('npx prettier --version', { stdio: 'ignore' });
        } catch {
            return { passed: true }; // Prettier not available
        }

        // Check if file needs formatting
        try {
            execSync(`npx prettier --check "${filePath}"`, { stdio: 'ignore' });
            return {
                passed: true,
                suggestions: ['代码格式正确 ✓'],
            };
        } catch {
            return {
                passed: true,
                warning: `💡 文件可能需要格式化，运行: npx prettier --write "${path.basename(filePath)}"`,
                suggestions: ['使用 Prettier 格式化代码以保持一致性'],
            };
        }
    } catch (error) {
        console.error('[Hook:Prettier] Error:', error);
        return { passed: true };
    }
}

/**
 * Run all post-edit hooks
 */
export function runPostEditHooks(workspacePath: string, filePath: string, content?: string): HookResult[] {
    const results: HookResult[] = [];

    // 1. Console.log check
    if (filePath.match(/\.(js|jsx|ts|tsx)$/)) {
        results.push(checkConsoleLog(filePath, content));
    }

    // 2. TypeScript check
    if (filePath.match(/\.(ts|tsx)$/)) {
        results.push(checkTypeScript(workspacePath, filePath));
    }

    // 3. Prettier check
    results.push(checkPrettier(filePath));

    return results.filter(r => !r.passed || r.warning || r.suggestions);
}

/**
 * Format hook results for display
 */
export function formatHookResults(results: HookResult[]): string {
    if (results.length === 0) {
        return '';
    }

    const messages: string[] = [];

    results.forEach(result => {
        if (result.error) {
            messages.push(result.error);
        }
        if (result.warning) {
            messages.push(result.warning);
        }
        if (result.suggestions && result.suggestions.length > 0) {
            messages.push('\n建议:');
            result.suggestions.forEach(s => messages.push(`  • ${s}`));
        }
    });

    return messages.join('\n\n');
}
