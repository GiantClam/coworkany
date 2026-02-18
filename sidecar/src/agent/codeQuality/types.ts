/**
 * Code Quality Analysis Types
 *
 * Defines types for code quality analysis results
 */

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCategory =
    | 'syntax'
    | 'type'
    | 'complexity'
    | 'security'
    | 'performance'
    | 'maintainability'
    | 'style'
    | 'best-practice';

export interface CodeIssue {
    severity: IssueSeverity;
    category: IssueCategory;
    message: string;
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
    rule?: string;
    suggestion?: string;
}

export interface ComplexityMetrics {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    linesOfCode: number;
    maintainabilityIndex: number; // 0-100, higher is better
}

export interface SecurityIssue extends CodeIssue {
    category: 'security';
    cwe?: string; // Common Weakness Enumeration ID
    severity: 'error' | 'warning';
}

export interface CodeQualityReport {
    filePath: string;
    language: string;
    issues: CodeIssue[];
    metrics: ComplexityMetrics;
    score: number; // 0-100, higher is better
    timestamp: string;
}

export interface CodeQualityConfig {
    maxComplexity: number;
    maxLinesOfCode: number;
    enableSecurityChecks: boolean;
    enableComplexityChecks: boolean;
    enableStyleChecks: boolean;
    ignoredRules?: string[];
}

export const DEFAULT_QUALITY_CONFIG: CodeQualityConfig = {
    maxComplexity: 10,
    maxLinesOfCode: 300,
    enableSecurityChecks: true,
    enableComplexityChecks: true,
    enableStyleChecks: true,
    ignoredRules: [],
};
