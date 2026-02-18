/**
 * Quality and Verification Data Parser
 *
 * Parses text content to extract verification and quality report data
 */

import type {
    VerificationStatusProps,
    CodeQualityReportProps,
    CodeIssue,
    ComplexityMetrics
} from '../../components';

export interface ParsedContent {
    beforeText?: string;
    verification?: VerificationStatusProps;
    quality?: CodeQualityReportProps;
    afterText?: string;
}

/**
 * Parse verification status from text
 * Looks for patterns like:
 * ✅ Verification: File written successfully
 * Confidence: 100%
 * Evidence: ...
 */
function parseVerificationStatus(text: string): VerificationStatusProps | null {
    // Check for verification markers
    const verificationMatch = text.match(/(✅|❌|⚠️|ℹ️)\s*Verification:\s*(.+?)(?:\n|$)/);
    if (!verificationMatch) return null;

    const icon = verificationMatch[1];
    const message = verificationMatch[2].trim();

    // Determine status from icon
    let status: 'passed' | 'failed' | 'skipped' | 'unknown';
    if (icon === '✅') status = 'passed';
    else if (icon === '❌') status = 'failed';
    else if (icon === 'ℹ️') status = 'skipped';
    else status = 'unknown';

    // Extract confidence
    const confidenceMatch = text.match(/Confidence:\s*(\d+)%/);
    const score = confidenceMatch ? parseInt(confidenceMatch[1]) / 100 : 0.5;

    // Extract evidence
    const evidence: string[] = [];
    const evidenceSection = text.match(/Evidence:\s*\n((?:\s*[•\-]\s*.+\n?)+)/);
    if (evidenceSection) {
        const lines = evidenceSection[1].split('\n').filter(l => l.trim());
        lines.forEach(line => {
            const match = line.match(/[•\-]\s*(.+)/);
            if (match) evidence.push(match[1].trim());
        });
    }

    // Extract suggestions
    const suggestions: string[] = [];
    const suggestionsSection = text.match(/Suggestions:\s*\n((?:\s*[💡\-]\s*.+\n?)+)/);
    if (suggestionsSection) {
        const lines = suggestionsSection[1].split('\n').filter(l => l.trim());
        lines.forEach(line => {
            const match = line.match(/[💡\-]\s*(.+)/);
            if (match) suggestions.push(match[1].trim());
        });
    }

    return {
        status,
        message,
        score,
        evidence: evidence.length > 0 ? evidence : undefined,
        suggestions: suggestions.length > 0 ? suggestions : undefined
    };
}

/**
 * Parse code quality report from text
 * Looks for patterns like:
 * 📊 Code Quality: ✅ Good (82/100)
 * Issues: 2 warning(s)
 */
function parseQualityReport(text: string): CodeQualityReportProps | null {
    // Check for quality marker
    const qualityMatch = text.match(/📊\s*Code Quality:\s*(✨|✅|⚠️|❌)\s*(\w+)\s*\((\d+)\/100\)/);
    if (!qualityMatch) return null;

    const score = parseInt(qualityMatch[3]);

    // Extract file path if present
    const filePathMatch = text.match(/(?:in|for)\s+([^\s:]+\.(?:ts|js|py|rs|go|java|cpp|c))/);
    const filePath = filePathMatch ? filePathMatch[1] : 'code file';

    // Parse issues
    const issues: CodeIssue[] = [];
    const issuesMatch = text.match(/Issues:\s*(.+?)(?:\n|$)/);
    if (issuesMatch) {
        const issuesText = issuesMatch[1];
        const criticalMatch = issuesText.match(/(\d+)\s*critical\s*issue/);
        const warningMatch = issuesText.match(/(\d+)\s*warning/);

        if (criticalMatch) {
            const count = parseInt(criticalMatch[1]);
            for (let i = 0; i < count; i++) {
                issues.push({
                    severity: 'error',
                    category: 'unknown',
                    message: 'Critical issue detected'
                });
            }
        }

        if (warningMatch) {
            const count = parseInt(warningMatch[1]);
            for (let i = 0; i < count; i++) {
                issues.push({
                    severity: 'warning',
                    category: 'unknown',
                    message: 'Warning detected'
                });
            }
        }
    }

    // Default metrics (we don't have detailed data from the text)
    const metrics: ComplexityMetrics = {
        cyclomaticComplexity: 0,
        cognitiveComplexity: 0,
        linesOfCode: 0,
        maintainabilityIndex: score
    };

    return {
        filePath,
        score,
        issues,
        metrics
    };
}

/**
 * Parse text content to extract verification and quality data
 */
export function parseMessageContent(content: string): ParsedContent {
    const result: ParsedContent = {};

    // Try to parse verification
    const verification = parseVerificationStatus(content);
    if (verification) {
        result.verification = verification;

        // Split content at verification section
        const verificationStart = content.indexOf('✅ Verification:') !== -1 ? content.indexOf('✅ Verification:') :
                                  content.indexOf('❌ Verification:') !== -1 ? content.indexOf('❌ Verification:') :
                                  content.indexOf('⚠️ Verification:') !== -1 ? content.indexOf('⚠️ Verification:') :
                                  content.indexOf('ℹ️ Verification:');

        if (verificationStart !== -1) {
            result.beforeText = content.substring(0, verificationStart).trim();

            // Find where verification section ends (usually at next major section or double newline)
            const afterVerification = content.substring(verificationStart);
            const nextSection = afterVerification.search(/\n\n[^\s]/);

            if (nextSection !== -1) {
                result.afterText = afterVerification.substring(nextSection).trim();
            }
        }
    }

    // Try to parse quality report
    const quality = parseQualityReport(content);
    if (quality) {
        result.quality = quality;

        // If we didn't find verification, split at quality section
        if (!verification) {
            const qualityStart = content.indexOf('📊 Code Quality:');
            if (qualityStart !== -1) {
                result.beforeText = content.substring(0, qualityStart).trim();

                const afterQuality = content.substring(qualityStart);
                const nextSection = afterQuality.search(/\n\n[^\s]/);

                if (nextSection !== -1) {
                    result.afterText = afterQuality.substring(nextSection).trim();
                }
            }
        }
    }

    // If no special content, return original text
    if (!verification && !quality) {
        result.beforeText = content;
    }

    return result;
}
