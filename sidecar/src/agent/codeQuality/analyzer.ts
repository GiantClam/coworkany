/**
 * Code Quality Analyzer
 *
 * Analyzes code for quality issues including:
 * - Syntax errors
 * - Complexity metrics
 * - Security vulnerabilities
 * - Code smells
 */

import type {
    CodeQualityReport,
    CodeQualityConfig,
    CodeIssue,
    ComplexityMetrics,
    SecurityIssue,
    DEFAULT_QUALITY_CONFIG,
} from './types';

export class CodeQualityAnalyzer {
    private config: CodeQualityConfig;

    constructor(config?: Partial<CodeQualityConfig>) {
        this.config = {
            maxComplexity: 10,
            maxLinesOfCode: 300,
            enableSecurityChecks: true,
            enableComplexityChecks: true,
            enableStyleChecks: true,
            ignoredRules: [],
            ...config,
        };
    }

    /**
     * Analyze code and return quality report
     */
    async analyze(
        code: string,
        filePath: string,
        language: string
    ): Promise<CodeQualityReport> {
        const issues: CodeIssue[] = [];

        // 1. Check complexity
        if (this.config.enableComplexityChecks) {
            const complexityIssues = this.checkComplexity(code, language);
            issues.push(...complexityIssues);
        }

        // 2. Check security
        if (this.config.enableSecurityChecks) {
            const securityIssues = this.checkSecurity(code, language);
            issues.push(...securityIssues);
        }

        // 3. Check code smells
        const codeSmells = this.checkCodeSmells(code, language);
        issues.push(...codeSmells);

        // 4. Calculate metrics
        const metrics = this.calculateMetrics(code, language);

        // 5. Calculate overall score
        const score = this.calculateScore(issues, metrics);

        return {
            filePath,
            language,
            issues: this.filterIgnoredRules(issues),
            metrics,
            score,
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Check cyclomatic complexity
     */
    private checkComplexity(code: string, language: string): CodeIssue[] {
        const issues: CodeIssue[] = [];

        // Simple heuristic: count decision points
        const complexity = this.estimateCyclomaticComplexity(code, language);

        if (complexity > this.config.maxComplexity) {
            issues.push({
                severity: complexity > this.config.maxComplexity * 2 ? 'error' : 'warning',
                category: 'complexity',
                message: `Cyclomatic complexity is ${complexity}, exceeds maximum of ${this.config.maxComplexity}`,
                rule: 'max-complexity',
                suggestion: 'Consider breaking this function into smaller, more focused functions',
            });
        }

        return issues;
    }

    /**
     * Estimate cyclomatic complexity
     */
    private estimateCyclomaticComplexity(code: string, language: string): number {
        // Count decision points (if, while, for, case, &&, ||, ?, catch)
        const decisionKeywords = [
            /\bif\s*\(/g,
            /\belse\s+if\s*\(/g,
            /\bwhile\s*\(/g,
            /\bfor\s*\(/g,
            /\bcase\s+/g,
            /\bcatch\s*\(/g,
            /\&\&/g,
            /\|\|/g,
            /\?/g,
        ];

        let complexity = 1; // Base complexity

        for (const pattern of decisionKeywords) {
            const matches = code.match(pattern);
            if (matches) {
                complexity += matches.length;
            }
        }

        return complexity;
    }

    /**
     * Check for security vulnerabilities
     */
    private checkSecurity(code: string, language: string): SecurityIssue[] {
        const issues: SecurityIssue[] = [];

        // SQL Injection patterns
        if (this.containsSQLInjectionRisk(code)) {
            issues.push({
                severity: 'error',
                category: 'security',
                message: 'Potential SQL injection vulnerability detected',
                rule: 'no-sql-injection',
                cwe: 'CWE-89',
                suggestion: 'Use parameterized queries or ORM instead of string concatenation',
            });
        }

        // Command Injection patterns
        if (this.containsCommandInjectionRisk(code)) {
            issues.push({
                severity: 'error',
                category: 'security',
                message: 'Potential command injection vulnerability detected',
                rule: 'no-command-injection',
                cwe: 'CWE-78',
                suggestion: 'Sanitize user input before passing to shell commands',
            });
        }

        // XSS patterns
        if (this.containsXSSRisk(code, language)) {
            issues.push({
                severity: 'warning',
                category: 'security',
                message: 'Potential XSS vulnerability detected',
                rule: 'no-xss',
                cwe: 'CWE-79',
                suggestion: 'Sanitize user input before rendering in HTML',
            });
        }

        // Hardcoded credentials
        if (this.containsHardcodedCredentials(code)) {
            issues.push({
                severity: 'error',
                category: 'security',
                message: 'Hardcoded credentials detected',
                rule: 'no-hardcoded-credentials',
                cwe: 'CWE-798',
                suggestion: 'Use environment variables or secure credential storage',
            });
        }

        // Insecure random
        if (this.containsInsecureRandom(code, language)) {
            issues.push({
                severity: 'warning',
                category: 'security',
                message: 'Using insecure random number generator',
                rule: 'no-insecure-random',
                cwe: 'CWE-338',
                suggestion: 'Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive operations',
            });
        }

        return issues;
    }

    /**
     * Check SQL injection risk
     */
    private containsSQLInjectionRisk(code: string): boolean {
        // Pattern: String concatenation with SQL keywords
        const sqlPatterns = [
            /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i,
            /["'`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP).*["'`]\s*\+/i,
            /\+\s*["'`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i,
            /query\s*=\s*["'`].*\$\{/i,
        ];

        return sqlPatterns.some(pattern => pattern.test(code));
    }

    /**
     * Check command injection risk
     */
    private containsCommandInjectionRisk(code: string): boolean {
        // Pattern: exec/spawn with string concatenation
        const cmdPatterns = [
            /exec\s*\(.*\+.*\)/,
            /spawn\s*\(.*\+.*\)/,
            /execSync\s*\(.*\$\{.*\}/,
            /spawnSync\s*\(.*\$\{.*\}/,
        ];

        return cmdPatterns.some(pattern => pattern.test(code));
    }

    /**
     * Check XSS risk
     */
    private containsXSSRisk(code: string, language: string): boolean {
        // Pattern: innerHTML, dangerouslySetInnerHTML with user input
        if (language === 'typescript' || language === 'javascript') {
            const xssPatterns = [
                /innerHTML\s*=\s*(?!["'`])[^;]+/,
                /dangerouslySetInnerHTML\s*=.*\$\{/,
                /document\.write\s*\(/,
            ];

            return xssPatterns.some(pattern => pattern.test(code));
        }

        return false;
    }

    /**
     * Check hardcoded credentials
     */
    private containsHardcodedCredentials(code: string): boolean {
        const credentialPatterns = [
            /password\s*=\s*["'`][^"'`]{3,}["'`]/i,
            /api_key\s*=\s*["'`][^"'`]{10,}["'`]/i,
            /secret\s*=\s*["'`][^"'`]{10,}["'`]/i,
            /token\s*=\s*["'`][^"'`]{10,}["'`]/i,
        ];

        return credentialPatterns.some(pattern => pattern.test(code));
    }

    /**
     * Check insecure random
     */
    private containsInsecureRandom(code: string, language: string): boolean {
        if (language === 'typescript' || language === 'javascript') {
            // Math.random() for security operations
            return /Math\.random\(\)/.test(code) &&
                   (/token|key|secret|password|salt/i.test(code));
        }

        return false;
    }

    /**
     * Check for code smells
     */
    private checkCodeSmells(code: string, language: string): CodeIssue[] {
        const issues: CodeIssue[] = [];

        // Long function
        const lines = code.split('\n').length;
        if (lines > this.config.maxLinesOfCode) {
            issues.push({
                severity: 'warning',
                category: 'maintainability',
                message: `Function has ${lines} lines, exceeds maximum of ${this.config.maxLinesOfCode}`,
                rule: 'max-lines',
                suggestion: 'Consider breaking this function into smaller functions',
            });
        }

        // Deeply nested code
        const maxNesting = this.getMaxNestingLevel(code);
        if (maxNesting > 4) {
            issues.push({
                severity: 'warning',
                category: 'maintainability',
                message: `Code has ${maxNesting} levels of nesting, maximum recommended is 4`,
                rule: 'max-nesting',
                suggestion: 'Consider using early returns or extracting nested logic',
            });
        }

        // Too many parameters
        const maxParams = this.getMaxParameterCount(code, language);
        if (maxParams > 5) {
            issues.push({
                severity: 'info',
                category: 'maintainability',
                message: `Function has ${maxParams} parameters, maximum recommended is 5`,
                rule: 'max-params',
                suggestion: 'Consider using an options object for multiple parameters',
            });
        }

        // Console.log statements (in production code)
        if (/console\.(log|debug|info|warn|error)/.test(code)) {
            issues.push({
                severity: 'info',
                category: 'best-practice',
                message: 'Console statements found in code',
                rule: 'no-console',
                suggestion: 'Use a proper logging library instead of console statements',
            });
        }

        // Empty catch blocks
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(code)) {
            issues.push({
                severity: 'warning',
                category: 'best-practice',
                message: 'Empty catch block detected',
                rule: 'no-empty-catch',
                suggestion: 'Handle errors appropriately or at least log them',
            });
        }

        return issues;
    }

    /**
     * Get maximum nesting level
     */
    private getMaxNestingLevel(code: string): number {
        let maxLevel = 0;
        let currentLevel = 0;

        for (const char of code) {
            if (char === '{') {
                currentLevel++;
                maxLevel = Math.max(maxLevel, currentLevel);
            } else if (char === '}') {
                currentLevel--;
            }
        }

        return maxLevel;
    }

    /**
     * Get maximum parameter count
     */
    private getMaxParameterCount(code: string, language: string): number {
        // Match function declarations
        const functionPatterns = [
            /function\s+\w+\s*\(([^)]*)\)/g,
            /\w+\s*\(([^)]*)\)\s*(?:=>|{)/g,
        ];

        let maxParams = 0;

        for (const pattern of functionPatterns) {
            let match;
            while ((match = pattern.exec(code)) !== null) {
                const params = match[1].split(',').filter(p => p.trim());
                maxParams = Math.max(maxParams, params.length);
            }
        }

        return maxParams;
    }

    /**
     * Calculate complexity metrics
     */
    private calculateMetrics(code: string, language: string): ComplexityMetrics {
        const linesOfCode = code.split('\n').filter(line => line.trim()).length;
        const cyclomaticComplexity = this.estimateCyclomaticComplexity(code, language);

        // Cognitive complexity is similar but weighs nested structures more
        const cognitiveComplexity = Math.floor(cyclomaticComplexity * 1.2);

        // Maintainability Index (simplified version)
        // Formula: max(0, 100 * (171 - 5.2 * ln(Volume) - 0.23 * Complexity - 16.2 * ln(LOC)) / 171)
        const volume = linesOfCode * Math.log(linesOfCode + 1);
        const maintainabilityIndex = Math.max(
            0,
            Math.min(
                100,
                100 - (0.5 * cyclomaticComplexity + 0.2 * linesOfCode + 0.1 * volume)
            )
        );

        return {
            cyclomaticComplexity,
            cognitiveComplexity,
            linesOfCode,
            maintainabilityIndex: Math.round(maintainabilityIndex),
        };
    }

    /**
     * Calculate overall quality score
     */
    private calculateScore(issues: CodeIssue[], metrics: ComplexityMetrics): number {
        let score = 100;

        // Deduct points for issues
        for (const issue of issues) {
            switch (issue.severity) {
                case 'error':
                    score -= 10;
                    break;
                case 'warning':
                    score -= 5;
                    break;
                case 'info':
                    score -= 2;
                    break;
            }
        }

        // Deduct points for poor metrics
        if (metrics.cyclomaticComplexity > 10) {
            score -= (metrics.cyclomaticComplexity - 10) * 2;
        }

        if (metrics.maintainabilityIndex < 65) {
            score -= (65 - metrics.maintainabilityIndex) * 0.5;
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    /**
     * Filter out ignored rules
     */
    private filterIgnoredRules(issues: CodeIssue[]): CodeIssue[] {
        if (!this.config.ignoredRules || this.config.ignoredRules.length === 0) {
            return issues;
        }

        return issues.filter(
            issue => !issue.rule || !this.config.ignoredRules!.includes(issue.rule)
        );
    }

    /**
     * Format report as human-readable text
     */
    formatReport(report: CodeQualityReport): string {
        const lines: string[] = [];

        lines.push(`📊 Code Quality Report: ${report.filePath}`);
        lines.push(`Language: ${report.language}`);
        lines.push(`Overall Score: ${report.score}/100`);
        lines.push('');

        // Metrics
        lines.push('📈 Metrics:');
        lines.push(`  - Cyclomatic Complexity: ${report.metrics.cyclomaticComplexity}`);
        lines.push(`  - Cognitive Complexity: ${report.metrics.cognitiveComplexity}`);
        lines.push(`  - Lines of Code: ${report.metrics.linesOfCode}`);
        lines.push(`  - Maintainability Index: ${report.metrics.maintainabilityIndex}/100`);
        lines.push('');

        // Issues
        if (report.issues.length > 0) {
            const errorCount = report.issues.filter(i => i.severity === 'error').length;
            const warningCount = report.issues.filter(i => i.severity === 'warning').length;
            const infoCount = report.issues.filter(i => i.severity === 'info').length;

            lines.push(`⚠️ Issues Found: ${report.issues.length}`);
            lines.push(`  - Errors: ${errorCount}`);
            lines.push(`  - Warnings: ${warningCount}`);
            lines.push(`  - Info: ${infoCount}`);
            lines.push('');

            // Group by severity
            const errors = report.issues.filter(i => i.severity === 'error');
            const warnings = report.issues.filter(i => i.severity === 'warning');

            if (errors.length > 0) {
                lines.push('❌ Errors:');
                errors.forEach((issue, index) => {
                    lines.push(`  ${index + 1}. [${issue.category}] ${issue.message}`);
                    if (issue.suggestion) {
                        lines.push(`     💡 ${issue.suggestion}`);
                    }
                });
                lines.push('');
            }

            if (warnings.length > 0) {
                lines.push('⚠️ Warnings:');
                warnings.slice(0, 5).forEach((issue, index) => {
                    lines.push(`  ${index + 1}. [${issue.category}] ${issue.message}`);
                    if (issue.suggestion) {
                        lines.push(`     💡 ${issue.suggestion}`);
                    }
                });
                if (warnings.length > 5) {
                    lines.push(`  ...and ${warnings.length - 5} more warnings`);
                }
            }
        } else {
            lines.push('✅ No issues found!');
        }

        return lines.join('\n');
    }
}

// Singleton instance
let instance: CodeQualityAnalyzer | null = null;

export function getCodeQualityAnalyzer(config?: Partial<CodeQualityConfig>): CodeQualityAnalyzer {
    if (!instance) {
        instance = new CodeQualityAnalyzer(config);
    }
    return instance;
}
