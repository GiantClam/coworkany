/**
 * CoworkAny - Sandboxed Code Execution
 *
 * Provides isolated Python/JavaScript code execution with automatic
 * dependency installation and error analysis.
 *
 * OpenClaw-style "Code as Tool" implementation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, SpawnOptions } from 'child_process';
import { randomUUID } from 'crypto';
import type { ToolDefinition, ToolContext, ToolEffect } from './standard';

// ============================================================================
// Types
// ============================================================================

export type SupportedLanguage = 'python' | 'javascript' | 'shell';

export interface CodeExecutionRequest {
    language: SupportedLanguage;
    code: string;
    dependencies?: string[];
    timeout_ms?: number;
    sandbox_id?: string;
    working_dir?: string;
    env?: Record<string, string>;
}

export interface ErrorAnalysis {
    errorType:
        | 'python_syntax'
        | 'python_runtime'
        | 'missing_module'
        | 'missing_command'
        | 'permission_denied'
        | 'timeout'
        | 'network'
        | 'file_not_found'
        | 'web_search_failed'              // Web search returned no useful results
        | 'web_interaction_required'       // Page requires browser automation
        | 'plan_refinement_needed'         // Current approach isn't working
        | 'browser_spa_not_rendered'       // SPA page didn't render (JS not available)
        | 'browser_smart_mode_unavailable' // browser-use-service not running
        | 'browser_element_not_found'      // Element not found in browser page
        | 'unknown';
    originalError: string;
    suggestedFix: string;
    confidence: number;
    canAutoRetry: boolean;
    retryStrategy?: {
        modifiedCode?: string;
        additionalDeps?: string[];
        envChanges?: Record<string, string>;
        alternativeCommands?: string[];  // For command not found errors
    };
}

export interface CodeExecutionResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exit_code: number;
    duration_ms: number;
    sandbox_id: string;
    installed_deps?: string[];
    error_analysis?: ErrorAnalysis;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const MAX_TIMEOUT_MS = 300000; // 5 minutes
const SANDBOX_BASE_DIR = '.coworkany/sandbox';

// Common module name mappings (pip package name differs from import name)
const MODULE_TO_PACKAGE: Record<string, string> = {
    cv2: 'opencv-python',
    PIL: 'Pillow',
    sklearn: 'scikit-learn',
    yaml: 'pyyaml',
    bs4: 'beautifulsoup4',
    dotenv: 'python-dotenv',
};

// ============================================================================
// Sandbox Manager
// ============================================================================

export class SandboxManager {
    private baseDir: string;

    constructor(workspacePath?: string) {
        this.baseDir = workspacePath
            ? path.join(workspacePath, SANDBOX_BASE_DIR)
            : path.join(os.homedir(), SANDBOX_BASE_DIR);
    }

    /**
     * Ensure sandbox directories exist
     */
    async ensureSandboxDirs(): Promise<void> {
        const dirs = [
            this.baseDir,
            path.join(this.baseDir, 'python'),
            path.join(this.baseDir, 'python', 'workspace'),
            path.join(this.baseDir, 'nodejs'),
            path.join(this.baseDir, 'nodejs', 'workspace'),
            path.join(this.baseDir, 'temp'),
        ];

        for (const dir of dirs) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
    }

    /**
     * Get sandbox path for a language
     */
    getSandboxPath(language: SupportedLanguage): string {
        switch (language) {
            case 'python':
                return path.join(this.baseDir, 'python', 'workspace');
            case 'javascript':
                return path.join(this.baseDir, 'nodejs', 'workspace');
            default:
                return path.join(this.baseDir, 'temp');
        }
    }

    /**
     * Get Python virtual environment path
     */
    getPythonVenvPath(): string {
        return path.join(this.baseDir, 'python', 'venv');
    }

    /**
     * Check if Python venv exists
     */
    async hasPythonVenv(): Promise<boolean> {
        const venvPath = this.getPythonVenvPath();
        const activatePath =
            process.platform === 'win32'
                ? path.join(venvPath, 'Scripts', 'activate.bat')
                : path.join(venvPath, 'bin', 'activate');
        try {
            await fs.promises.access(activatePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Create Python virtual environment
     */
    async createPythonVenv(): Promise<{ success: boolean; error?: string }> {
        const venvPath = this.getPythonVenvPath();

        return new Promise((resolve) => {
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            const child = spawn(pythonCmd, ['-m', 'venv', venvPath], {
                shell: true,
            });

            let stderr = '';
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true });
                } else {
                    resolve({ success: false, error: stderr || 'Failed to create venv' });
                }
            });

            child.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * Get Python executable path (from venv or system)
     */
    async getPythonExecutable(): Promise<string> {
        const venvPath = this.getPythonVenvPath();
        const venvPython =
            process.platform === 'win32'
                ? path.join(venvPath, 'Scripts', 'python.exe')
                : path.join(venvPath, 'bin', 'python');

        try {
            await fs.promises.access(venvPython);
            return venvPython;
        } catch {
            return process.platform === 'win32' ? 'python' : 'python3';
        }
    }

    /**
     * Get pip executable path
     */
    async getPipExecutable(): Promise<string> {
        const venvPath = this.getPythonVenvPath();
        const venvPip =
            process.platform === 'win32'
                ? path.join(venvPath, 'Scripts', 'pip.exe')
                : path.join(venvPath, 'bin', 'pip');

        try {
            await fs.promises.access(venvPip);
            return venvPip;
        } catch {
            return process.platform === 'win32' ? 'pip' : 'pip3';
        }
    }

    /**
     * Clean up temporary files
     */
    async cleanupTemp(): Promise<void> {
        const tempDir = path.join(this.baseDir, 'temp');
        try {
            const files = await fs.promises.readdir(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stat = await fs.promises.stat(filePath);
                // Remove files older than 1 hour
                if (Date.now() - stat.mtimeMs > 3600000) {
                    await fs.promises.unlink(filePath);
                }
            }
        } catch {
            // Ignore cleanup errors
        }
    }
}

// ============================================================================
// Error Analysis Engine
// ============================================================================

export class ErrorAnalyzer {
    /**
     * Analyze error output and provide suggestions
     */
    analyze(stderr: string, code: string, language: SupportedLanguage): ErrorAnalysis {
        const lowerStderr = stderr.toLowerCase();

        // Python-specific errors
        if (language === 'python') {
            // Missing module
            const moduleMatch = stderr.match(/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/);
            if (moduleMatch) {
                const moduleName = moduleMatch[1].split('.')[0];
                const packageName = MODULE_TO_PACKAGE[moduleName] || moduleName;
                return {
                    errorType: 'missing_module',
                    originalError: stderr,
                    suggestedFix: `Install the missing package: pip install ${packageName}`,
                    confidence: 0.95,
                    canAutoRetry: true,
                    retryStrategy: {
                        additionalDeps: [packageName],
                    },
                };
            }

            // Import error (similar to module not found)
            const importMatch = stderr.match(/ImportError: cannot import name ['"]([^'"]+)['"]/);
            if (importMatch) {
                return {
                    errorType: 'missing_module',
                    originalError: stderr,
                    suggestedFix: `Check if the module is installed correctly or if the import path is correct`,
                    confidence: 0.7,
                    canAutoRetry: false,
                };
            }

            // Syntax error
            const syntaxMatch = stderr.match(/SyntaxError: (.+)/);
            if (syntaxMatch) {
                const lineMatch = stderr.match(/line (\d+)/);
                return {
                    errorType: 'python_syntax',
                    originalError: stderr,
                    suggestedFix: lineMatch
                        ? `Syntax error on line ${lineMatch[1]}: ${syntaxMatch[1]}`
                        : `Syntax error: ${syntaxMatch[1]}`,
                    confidence: 0.9,
                    canAutoRetry: false,
                };
            }

            // File not found
            if (stderr.includes('FileNotFoundError') || stderr.includes('No such file or directory')) {
                const fileMatch = stderr.match(/['"]([^'"]+)['"]/);
                return {
                    errorType: 'file_not_found',
                    originalError: stderr,
                    suggestedFix: fileMatch
                        ? `File not found: ${fileMatch[1]}. Check if the file path is correct.`
                        : 'File not found. Check if the file path is correct.',
                    confidence: 0.85,
                    canAutoRetry: false,
                };
            }

            // Permission error
            if (stderr.includes('PermissionError')) {
                return {
                    errorType: 'permission_denied',
                    originalError: stderr,
                    suggestedFix: 'Permission denied. Check file permissions or run with appropriate privileges.',
                    confidence: 0.9,
                    canAutoRetry: false,
                };
            }
        }

        // Shell-specific errors
        if (language === 'shell') {
            // Command not found
            const cmdMatch = stderr.match(/(.+): command not found/);
            if (cmdMatch || lowerStderr.includes('is not recognized')) {
                const cmd = cmdMatch ? cmdMatch[1] : 'Unknown command';
                return {
                    errorType: 'missing_command',
                    originalError: stderr,
                    suggestedFix: `Command '${cmd}' not found. Install it or check if it's in PATH.`,
                    confidence: 0.9,
                    canAutoRetry: false,
                };
            }
        }

        // Timeout
        if (lowerStderr.includes('timeout') || lowerStderr.includes('timed out')) {
            return {
                errorType: 'timeout',
                originalError: stderr,
                suggestedFix: 'Operation timed out. Try increasing the timeout or optimizing the code.',
                confidence: 0.85,
                canAutoRetry: true,
                retryStrategy: {
                    envChanges: { TIMEOUT_MULTIPLIER: '2' },
                },
            };
        }

        // Network errors
        if (
            lowerStderr.includes('connection refused') ||
            lowerStderr.includes('network unreachable') ||
            lowerStderr.includes('name resolution failed')
        ) {
            return {
                errorType: 'network',
                originalError: stderr,
                suggestedFix: 'Network error. Check your internet connection or the target URL.',
                confidence: 0.8,
                canAutoRetry: true,
            };
        }

        // Unknown error
        return {
            errorType: 'unknown',
            originalError: stderr,
            suggestedFix: 'An unknown error occurred. Review the error message for details.',
            confidence: 0.3,
            canAutoRetry: false,
        };
    }
}

// ============================================================================
// Code Executor
// ============================================================================

export class CodeExecutor {
    private sandboxManager: SandboxManager;
    private errorAnalyzer: ErrorAnalyzer;

    constructor(workspacePath?: string) {
        this.sandboxManager = new SandboxManager(workspacePath);
        this.errorAnalyzer = new ErrorAnalyzer();
    }

    /**
     * Install Python packages
     */
    async installPythonPackages(packages: string[]): Promise<{ success: boolean; error?: string }> {
        if (packages.length === 0) return { success: true };

        await this.sandboxManager.ensureSandboxDirs();

        // Ensure venv exists
        if (!(await this.sandboxManager.hasPythonVenv())) {
            const venvResult = await this.sandboxManager.createPythonVenv();
            if (!venvResult.success) {
                return { success: false, error: `Failed to create venv: ${venvResult.error}` };
            }
        }

        const pip = await this.sandboxManager.getPipExecutable();

        return new Promise((resolve) => {
            const child = spawn(pip, ['install', ...packages], {
                shell: true,
                timeout: 120000, // 2 minutes for installation
            });

            let stderr = '';
            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true });
                } else {
                    resolve({ success: false, error: stderr || 'pip install failed' });
                }
            });

            child.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * Execute Python code
     */
    async executePython(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
        const startTime = Date.now();
        const sandboxId = request.sandbox_id || randomUUID();
        const installedDeps: string[] = [];

        await this.sandboxManager.ensureSandboxDirs();

        // Install dependencies if specified
        if (request.dependencies && request.dependencies.length > 0) {
            const installResult = await this.installPythonPackages(request.dependencies);
            if (installResult.success) {
                installedDeps.push(...request.dependencies);
            } else {
                return {
                    success: false,
                    stdout: '',
                    stderr: installResult.error || 'Failed to install dependencies',
                    exit_code: -1,
                    duration_ms: Date.now() - startTime,
                    sandbox_id: sandboxId,
                    error_analysis: {
                        errorType: 'missing_module',
                        originalError: installResult.error || 'Dependency installation failed',
                        suggestedFix: 'Check package names and try again',
                        confidence: 0.8,
                        canAutoRetry: false,
                    },
                };
            }
        }

        // Write code to temp file
        const workDir = request.working_dir || this.sandboxManager.getSandboxPath('python');
        const scriptPath = path.join(workDir, `script_${sandboxId}.py`);
        await fs.promises.writeFile(scriptPath, request.code, 'utf-8');

        const python = await this.sandboxManager.getPythonExecutable();
        const timeout = Math.min(request.timeout_ms || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const child = spawn(python, [scriptPath], {
                cwd: workDir,
                env: { ...process.env, ...request.env },
                shell: true,
            });

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
            }, timeout);

            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', async (code) => {
                clearTimeout(timer);

                // Clean up script file
                try {
                    await fs.promises.unlink(scriptPath);
                } catch {
                    // Ignore cleanup errors
                }

                const duration = Date.now() - startTime;
                const exitCode = timedOut ? -1 : code ?? 0;
                const success = !timedOut && code === 0;

                let errorAnalysis: ErrorAnalysis | undefined;
                if (!success && stderr) {
                    errorAnalysis = this.errorAnalyzer.analyze(stderr, request.code, 'python');
                } else if (timedOut) {
                    errorAnalysis = {
                        errorType: 'timeout',
                        originalError: 'Execution timed out',
                        suggestedFix: `Increase timeout (current: ${timeout}ms) or optimize the code`,
                        confidence: 1.0,
                        canAutoRetry: true,
                    };
                }

                resolve({
                    success,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exit_code: exitCode,
                    duration_ms: duration,
                    sandbox_id: sandboxId,
                    installed_deps: installedDeps.length > 0 ? installedDeps : undefined,
                    error_analysis: errorAnalysis,
                });
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                resolve({
                    success: false,
                    stdout: '',
                    stderr: err.message,
                    exit_code: -1,
                    duration_ms: Date.now() - startTime,
                    sandbox_id: sandboxId,
                    error_analysis: {
                        errorType: 'unknown',
                        originalError: err.message,
                        suggestedFix: 'Check if Python is installed correctly',
                        confidence: 0.5,
                        canAutoRetry: false,
                    },
                });
            });
        });
    }

    /**
     * Execute JavaScript code
     */
    async executeJavaScript(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
        const startTime = Date.now();
        const sandboxId = request.sandbox_id || randomUUID();

        await this.sandboxManager.ensureSandboxDirs();

        // Write code to temp file
        const workDir = request.working_dir || this.sandboxManager.getSandboxPath('javascript');
        const scriptPath = path.join(workDir, `script_${sandboxId}.js`);
        await fs.promises.writeFile(scriptPath, request.code, 'utf-8');

        const timeout = Math.min(request.timeout_ms || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

        // Try bun first, then node
        const runtime = process.env.BUN_INSTALL ? 'bun' : 'node';

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const child = spawn(runtime, [scriptPath], {
                cwd: workDir,
                env: { ...process.env, ...request.env },
                shell: true,
            });

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
            }, timeout);

            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', async (code) => {
                clearTimeout(timer);

                // Clean up script file
                try {
                    await fs.promises.unlink(scriptPath);
                } catch {
                    // Ignore cleanup errors
                }

                const duration = Date.now() - startTime;
                const exitCode = timedOut ? -1 : code ?? 0;
                const success = !timedOut && code === 0;

                let errorAnalysis: ErrorAnalysis | undefined;
                if (!success && stderr) {
                    errorAnalysis = this.errorAnalyzer.analyze(stderr, request.code, 'javascript');
                } else if (timedOut) {
                    errorAnalysis = {
                        errorType: 'timeout',
                        originalError: 'Execution timed out',
                        suggestedFix: `Increase timeout (current: ${timeout}ms) or optimize the code`,
                        confidence: 1.0,
                        canAutoRetry: true,
                    };
                }

                resolve({
                    success,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exit_code: exitCode,
                    duration_ms: duration,
                    sandbox_id: sandboxId,
                    error_analysis: errorAnalysis,
                });
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                resolve({
                    success: false,
                    stdout: '',
                    stderr: err.message,
                    exit_code: -1,
                    duration_ms: Date.now() - startTime,
                    sandbox_id: sandboxId,
                    error_analysis: {
                        errorType: 'unknown',
                        originalError: err.message,
                        suggestedFix: 'Check if Node.js/Bun is installed correctly',
                        confidence: 0.5,
                        canAutoRetry: false,
                    },
                });
            });
        });
    }

    /**
     * Execute code based on language
     */
    async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
        switch (request.language) {
            case 'python':
                return this.executePython(request);
            case 'javascript':
                return this.executeJavaScript(request);
            default:
                return {
                    success: false,
                    stdout: '',
                    stderr: `Unsupported language: ${request.language}`,
                    exit_code: -1,
                    duration_ms: 0,
                    sandbox_id: randomUUID(),
                    error_analysis: {
                        errorType: 'unknown',
                        originalError: `Unsupported language: ${request.language}`,
                        suggestedFix: 'Use python, javascript, or shell',
                        confidence: 1.0,
                        canAutoRetry: false,
                    },
                };
        }
    }
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Execute Python code with automatic dependency installation
 */
export const executePythonTool: ToolDefinition = {
    name: 'execute_python',
    description:
        'Execute Python code in a sandboxed environment. Automatically installs dependencies if specified. Use this when you need to run Python scripts for data analysis, calculations, or automation.',
    effects: ['code:execute', 'process:spawn'] as ToolEffect[],
    input_schema: {
        type: 'object',
        properties: {
            code: {
                type: 'string',
                description: 'The Python code to execute.',
            },
            dependencies: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of pip packages to install before execution (e.g., ["pandas", "numpy"]).',
            },
            timeout_ms: {
                type: 'integer',
                description: 'Timeout in milliseconds (default: 30000, max: 300000).',
            },
        },
        required: ['code'],
    },
    handler: async (
        args: { code: string; dependencies?: string[]; timeout_ms?: number },
        context: ToolContext
    ) => {
        const executor = new CodeExecutor(context.workspacePath);
        const result = await executor.executePython({
            language: 'python',
            code: args.code,
            dependencies: args.dependencies,
            timeout_ms: args.timeout_ms,
        });

        // Format result for AI consumption
        let output = '';

        if (result.success) {
            output = `Execution successful (${result.duration_ms}ms)\n`;
            if (result.installed_deps?.length) {
                output += `Installed: ${result.installed_deps.join(', ')}\n`;
            }
            output += `\nOutput:\n${result.stdout || '(no output)'}`;
        } else {
            output = `Execution failed (exit code: ${result.exit_code})\n`;
            output += `\nError:\n${result.stderr}`;

            if (result.error_analysis) {
                output += `\n\n[Self-Correction Hint]\n`;
                output += `Error Type: ${result.error_analysis.errorType}\n`;
                output += `Suggestion: ${result.error_analysis.suggestedFix}\n`;
                output += `Can Auto-Retry: ${result.error_analysis.canAutoRetry}\n`;

                if (result.error_analysis.retryStrategy?.additionalDeps) {
                    output += `Missing Dependencies: ${result.error_analysis.retryStrategy.additionalDeps.join(', ')}\n`;
                }
            }
        }

        return output;
    },
};

/**
 * Execute JavaScript code
 */
export const executeJavaScriptTool: ToolDefinition = {
    name: 'execute_javascript',
    description:
        'Execute JavaScript/Node.js code in a sandboxed environment. Use this for JavaScript-based automation or calculations.',
    effects: ['code:execute', 'process:spawn'] as ToolEffect[],
    input_schema: {
        type: 'object',
        properties: {
            code: {
                type: 'string',
                description: 'The JavaScript code to execute.',
            },
            timeout_ms: {
                type: 'integer',
                description: 'Timeout in milliseconds (default: 30000, max: 300000).',
            },
        },
        required: ['code'],
    },
    handler: async (args: { code: string; timeout_ms?: number }, context: ToolContext) => {
        const executor = new CodeExecutor(context.workspacePath);
        const result = await executor.executeJavaScript({
            language: 'javascript',
            code: args.code,
            timeout_ms: args.timeout_ms,
        });

        // Format result for AI consumption
        let output = '';

        if (result.success) {
            output = `Execution successful (${result.duration_ms}ms)\n`;
            output += `\nOutput:\n${result.stdout || '(no output)'}`;
        } else {
            output = `Execution failed (exit code: ${result.exit_code})\n`;
            output += `\nError:\n${result.stderr}`;

            if (result.error_analysis) {
                output += `\n\n[Self-Correction Hint]\n`;
                output += `Error Type: ${result.error_analysis.errorType}\n`;
                output += `Suggestion: ${result.error_analysis.suggestedFix}\n`;
            }
        }

        return output;
    },
};

/**
 * Install Python packages
 */
export const installPackagesTool: ToolDefinition = {
    name: 'install_packages',
    description:
        'Install Python packages into the sandbox environment. Use this to pre-install dependencies before running code.',
    effects: ['code:execute', 'process:spawn', 'network:outbound'] as ToolEffect[],
    input_schema: {
        type: 'object',
        properties: {
            packages: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of pip packages to install.',
            },
        },
        required: ['packages'],
    },
    handler: async (args: { packages: string[] }, context: ToolContext) => {
        const executor = new CodeExecutor(context.workspacePath);
        const result = await executor.installPythonPackages(args.packages);

        if (result.success) {
            return `Successfully installed packages: ${args.packages.join(', ')}`;
        } else {
            return `Failed to install packages: ${result.error}`;
        }
    },
};

// ============================================================================
// Export
// ============================================================================

export const CODE_EXECUTION_TOOLS: ToolDefinition[] = [
    executePythonTool,
    executeJavaScriptTool,
    installPackagesTool,
];

// Classes are already exported at definition
