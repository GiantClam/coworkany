
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

    async analyze(
        code: string,
        filePath: string,
        language: string
    ): Promise<CodeQualityReport> {
        const issues: CodeIssue[] = [];

        if (this.config.enableComplexityChecks) {
            const complexityIssues = this.checkComplexity(code, language);
            issues.push(...complexityIssues);
        }

        if (this.config.enableSecurityChecks) {
            const securityIssues = this.checkSecurity(code, language);
            issues.push(...securityIssues);
        }

        const codeSmells = this.checkCodeSmells(code, language);
        issues.push(...codeSmells);

        const metrics = this.calculateMetrics(code, language);

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

    private checkComplexity(code: string, language: string): CodeIssue[] {
        const issues: CodeIssue[] = [];

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

    private estimateCyclomaticComplexity(code: string, language: string): number {
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

    private checkSecurity(code: string, language: string): SecurityIssue[] {
        const issues: SecurityIssue[] = [];

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

    private containsSQLInjectionRisk(code: string): boolean {
        const sqlPatterns = [
            /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i,
            /["'`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP).*["'`]\s*\+/i,
            /\+\s*["'`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i,
            /query\s*=\s*["'`].*\$\{/i,
        ];

        return sqlPatterns.some(pattern => pattern.test(code));
    }

    private containsCommandInjectionRisk(code: string): boolean {
        const cmdPatterns = [
            /exec\s*\(.*\+.*\)/,
            /spawn\s*\(.*\+.*\)/,
            /execSync\s*\(.*\$\{.*\}/,
            /spawnSync\s*\(.*\$\{.*\}/,
        ];

        return cmdPatterns.some(pattern => pattern.test(code));
    }

    private containsXSSRisk(code: string, language: string): boolean {
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

    private containsHardcodedCredentials(code: string): boolean {
        const credentialPatterns = [
            /password\s*=\s*["'`][^"'`]{3,}["'`]/i,
            /api_key\s*=\s*["'`][^"'`]{10,}["'`]/i,
            /secret\s*=\s*["'`][^"'`]{10,}["'`]/i,
            /token\s*=\s*["'`][^"'`]{10,}["'`]/i,
        ];

        return credentialPatterns.some(pattern => pattern.test(code));
    }

    private containsInsecureRandom(code: string, language: string): boolean {
        if (language === 'typescript' || language === 'javascript') {
            return /Math\.random\(\)/.test(code) &&
                   (/token|key|secret|password|salt/i.test(code));
        }

        return false;
    }

    private checkCodeSmells(code: string, language: string): CodeIssue[] {
        const issues: CodeIssue[] = [];

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

        if (/console\.(log|debug|info|warn|error)/.test(code)) {
            issues.push({
                severity: 'info',
                category: 'best-practice',
                message: 'Console statements found in code',
                rule: 'no-console',
                suggestion: 'Use a proper logging library instead of console statements',
            });
        }

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

    private getMaxParameterCount(code: string, language: string): number {
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

    private calculateMetrics(code: string, language: string): ComplexityMetrics {
        const linesOfCode = code.split('\n').filter(line => line.trim()).length;
        const cyclomaticComplexity = this.estimateCyclomaticComplexity(code, language);

        const cognitiveComplexity = Math.floor(cyclomaticComplexity * 1.2);

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

    private calculateScore(issues: CodeIssue[], metrics: ComplexityMetrics): number {
        let score = 100;

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

        if (metrics.cyclomaticComplexity > 10) {
            score -= (metrics.cyclomaticComplexity - 10) * 2;
        }

        if (metrics.maintainabilityIndex < 65) {
            score -= (65 - metrics.maintainabilityIndex) * 0.5;
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    private filterIgnoredRules(issues: CodeIssue[]): CodeIssue[] {
        if (!this.config.ignoredRules || this.config.ignoredRules.length === 0) {
            return issues;
        }

        return issues.filter(
            issue => !issue.rule || !this.config.ignoredRules!.includes(issue.rule)
        );
    }

    formatReport(report: CodeQualityReport): string {
        const lines: string[] = [];

        lines.push(`📊 Code Quality Report: ${report.filePath}`);
        lines.push(`Language: ${report.language}`);
        lines.push(`Overall Score: ${report.score}/100`);
        lines.push('');

        lines.push('📈 Metrics:');
        lines.push(`  - Cyclomatic Complexity: ${report.metrics.cyclomaticComplexity}`);
        lines.push(`  - Cognitive Complexity: ${report.metrics.cognitiveComplexity}`);
        lines.push(`  - Lines of Code: ${report.metrics.linesOfCode}`);
        lines.push(`  - Maintainability Index: ${report.metrics.maintainabilityIndex}/100`);
        lines.push('');

        if (report.issues.length > 0) {
            const errorCount = report.issues.filter(i => i.severity === 'error').length;
            const warningCount = report.issues.filter(i => i.severity === 'warning').length;
            const infoCount = report.issues.filter(i => i.severity === 'info').length;

            lines.push(`⚠️ Issues Found: ${report.issues.length}`);
            lines.push(`  - Errors: ${errorCount}`);
            lines.push(`  - Warnings: ${warningCount}`);
            lines.push(`  - Info: ${infoCount}`);
            lines.push('');

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

let instance: CodeQualityAnalyzer | null = null;

export function getCodeQualityAnalyzer(config?: Partial<CodeQualityConfig>): CodeQualityAnalyzer {
    if (!instance) {
        instance = new CodeQualityAnalyzer(config);
    }
    return instance;
}
