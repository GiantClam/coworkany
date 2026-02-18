/**
 * Code Quality Report Component
 *
 * Displays code quality analysis results with issues and metrics
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface CodeIssue {
    severity: 'error' | 'warning' | 'info';
    category: string;
    message: string;
    line?: number;
    column?: number;
    suggestion?: string;
}

export interface ComplexityMetrics {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    linesOfCode: number;
    maintainabilityIndex: number;
}

export interface CodeQualityReportProps {
    filePath: string;
    score: number; // 0-100
    issues: CodeIssue[];
    metrics: ComplexityMetrics;
    compact?: boolean;
}

export const CodeQualityReport: React.FC<CodeQualityReportProps> = ({
    filePath,
    score,
    issues,
    metrics,
    compact = false
}) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(!compact);

    // Determine quality level based on score
    const getQualityLevel = () => {
        if (score >= 85) {
            return {
                emoji: '✨',
                label: t('quality.excellent'),
                color: 'text-green-600',
                bgColor: 'bg-green-50',
                borderColor: 'border-green-200'
            };
        } else if (score >= 70) {
            return {
                emoji: '✅',
                label: t('quality.good'),
                color: 'text-blue-600',
                bgColor: 'bg-blue-50',
                borderColor: 'border-blue-200'
            };
        } else if (score >= 60) {
            return {
                emoji: '⚠️',
                label: t('quality.acceptable'),
                color: 'text-yellow-600',
                bgColor: 'bg-yellow-50',
                borderColor: 'border-yellow-200'
            };
        } else {
            return {
                emoji: '❌',
                label: t('quality.needsImprovement'),
                color: 'text-red-600',
                bgColor: 'bg-red-50',
                borderColor: 'border-red-200'
            };
        }
    };

    const qualityLevel = getQualityLevel();

    // Count issues by severity
    const criticalCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const infoCount = issues.filter(i => i.severity === 'info').length;

    // Get issue icon and color
    const getIssueConfig = (severity: string) => {
        switch (severity) {
            case 'error':
                return { icon: '❌', color: 'text-red-600' };
            case 'warning':
                return { icon: '⚠️', color: 'text-yellow-600' };
            default:
                return { icon: 'ℹ️', color: 'text-blue-600' };
        }
    };

    // Compact view - just a summary badge
    if (compact && !isExpanded) {
        return (
            <div
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${qualityLevel.bgColor} ${qualityLevel.borderColor}`}
                onClick={() => setIsExpanded(true)}
            >
                <span className="text-lg">📊</span>
                <div className="flex items-center gap-2">
                    <span className={`font-medium ${qualityLevel.color}`}>
                        {qualityLevel.emoji} {t('quality.codeQuality')}: {qualityLevel.label}
                    </span>
                    <span className="text-sm text-gray-600">({score}/100)</span>
                </div>
                {issues.length > 0 && (
                    <span className="text-xs text-gray-500">
                        {criticalCount > 0 && `${criticalCount} ${t('quality.errors')} `}
                        {warningCount > 0 && `${warningCount} ${t('quality.warnings')}`}
                    </span>
                )}
                <span className="text-gray-400">▼</span>
            </div>
        );
    }

    // Full expanded view
    return (
        <div className={`border rounded-lg ${qualityLevel.borderColor} ${qualityLevel.bgColor}`}>
            {/* Header */}
            <div
                className="flex items-center justify-between p-3 cursor-pointer"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2">
                    <span className="text-lg">📊</span>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className={`font-medium ${qualityLevel.color}`}>
                                {qualityLevel.emoji} {t('quality.codeQuality')}: {qualityLevel.label}
                            </span>
                            <span className="text-sm font-semibold">{score}/100</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{filePath}</p>
                    </div>
                </div>
                {isExpanded ? (
                    <span className="text-gray-400">▲</span>
                ) : (
                    <span className="text-gray-400">▼</span>
                )}
            </div>

            {/* Details - only shown when expanded */}
            {isExpanded && (
                <div className="border-t border-gray-200 p-3 bg-white">
                    {/* Metrics */}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="bg-gray-50 rounded p-2">
                            <p className="text-xs text-gray-500">{t('quality.cyclomaticComplexity')}</p>
                            <p className="text-lg font-semibold text-gray-800">
                                {metrics.cyclomaticComplexity}
                            </p>
                        </div>
                        <div className="bg-gray-50 rounded p-2">
                            <p className="text-xs text-gray-500">{t('quality.cognitiveComplexity')}</p>
                            <p className="text-lg font-semibold text-gray-800">
                                {metrics.cognitiveComplexity}
                            </p>
                        </div>
                        <div className="bg-gray-50 rounded p-2">
                            <p className="text-xs text-gray-500">{t('quality.linesOfCode')}</p>
                            <p className="text-lg font-semibold text-gray-800">
                                {metrics.linesOfCode}
                            </p>
                        </div>
                        <div className="bg-gray-50 rounded p-2">
                            <p className="text-xs text-gray-500">{t('quality.maintainabilityIndex')}</p>
                            <p className="text-lg font-semibold text-gray-800">
                                {metrics.maintainabilityIndex}/100
                            </p>
                        </div>
                    </div>

                    {/* Issues */}
                    {issues.length > 0 ? (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-medium text-gray-700">
                                    {t('quality.issues')} ({issues.length})
                                </p>
                                <div className="flex gap-2 text-xs">
                                    {criticalCount > 0 && (
                                        <span className="text-red-600">
                                            {criticalCount} {t('quality.errors')}
                                        </span>
                                    )}
                                    {warningCount > 0 && (
                                        <span className="text-yellow-600">
                                            {warningCount} {t('quality.warnings')}
                                        </span>
                                    )}
                                    {infoCount > 0 && (
                                        <span className="text-blue-600">
                                            {infoCount} {t('quality.info')}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {issues.map((issue, index) => {
                                    const config = getIssueConfig(issue.severity);

                                    return (
                                        <div
                                            key={index}
                                            className="border border-gray-200 rounded p-2 bg-white"
                                        >
                                            <div className="flex items-start gap-2">
                                                <span className="flex-shrink-0 mt-0.5">{config.icon}</span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm text-gray-800">
                                                        {issue.message}
                                                    </p>
                                                    {(issue.line !== undefined || issue.category) && (
                                                        <div className="flex gap-2 mt-1 text-xs text-gray-500">
                                                            {issue.category && (
                                                                <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                                                                    {issue.category}
                                                                </span>
                                                            )}
                                                            {issue.line !== undefined && (
                                                                <span>
                                                                    {t('quality.line')} {issue.line}
                                                                    {issue.column !== undefined && `:${issue.column}`}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                    {issue.suggestion && (
                                                        <p className="text-xs text-blue-600 mt-1">
                                                            💡 {issue.suggestion}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-4 text-gray-500">
                            <div className="text-3xl mb-2">✅</div>
                            <p className="text-sm">{t('quality.noIssuesFound')}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CodeQualityReport;
