/**
 * Verification Status Component
 *
 * Displays the status of automatic verification for tool executions
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

export interface VerificationStatusProps {
    status: 'passed' | 'failed' | 'skipped' | 'unknown';
    message: string;
    score: number; // 0-1
    evidence?: string[];
    suggestions?: string[];
    compact?: boolean; // If true, show minimal UI
}

export const VerificationStatus: React.FC<VerificationStatusProps> = ({
    status,
    message,
    score,
    evidence = [],
    suggestions = [],
    compact = false
}) => {
    const { t } = useTranslation();

    // Determine icon and color based on status
    const getStatusConfig = () => {
        switch (status) {
            case 'passed':
                return {
                    icon: '✅',
                    color: 'text-green-600',
                    bgColor: 'bg-green-50',
                    borderColor: 'border-green-200',
                    label: t('verification.passed')
                };
            case 'failed':
                return {
                    icon: '❌',
                    color: 'text-red-600',
                    bgColor: 'bg-red-50',
                    borderColor: 'border-red-200',
                    label: t('verification.failed')
                };
            case 'skipped':
                return {
                    icon: 'ℹ️',
                    color: 'text-gray-600',
                    bgColor: 'bg-gray-50',
                    borderColor: 'border-gray-200',
                    label: t('verification.skipped')
                };
            default:
                return {
                    icon: '⚠️',
                    color: 'text-yellow-600',
                    bgColor: 'bg-yellow-50',
                    borderColor: 'border-yellow-200',
                    label: t('verification.unknown')
                };
        }
    };

    const config = getStatusConfig();
    const confidence = Math.round(score * 100);

    // Compact view - just an inline badge
    if (compact) {
        return (
            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${config.bgColor} ${config.color}`}>
                <span>{config.icon}</span>
                <span>{config.label}</span>
                {confidence > 0 && <span className="opacity-70">({confidence}%)</span>}
            </div>
        );
    }

    // Full view - detailed card
    return (
        <div className={`border rounded-lg p-3 ${config.bgColor} ${config.borderColor}`}>
            {/* Header */}
            <div className="flex items-start gap-2">
                <span className="text-lg flex-shrink-0">{config.icon}</span>
                <div className="flex-1">
                    <div className="flex items-center justify-between">
                        <span className={`font-medium ${config.color}`}>
                            {config.label}
                        </span>
                        <span className="text-xs text-gray-500">
                            {t('verification.confidence')}: {confidence}%
                        </span>
                    </div>
                    <p className="text-sm text-gray-700 mt-1">{message}</p>
                </div>
            </div>

            {/* Evidence */}
            {evidence.length > 0 && (
                <div className="mt-3 pl-7">
                    <p className="text-xs font-medium text-gray-600 mb-1">{t('verification.evidence')}:</p>
                    <ul className="space-y-1">
                        {evidence.map((item, index) => (
                            <li key={index} className="text-xs text-gray-600 flex items-start">
                                <span className="mr-1.5">•</span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Suggestions */}
            {suggestions.length > 0 && (
                <div className="mt-3 pl-7">
                    <p className="text-xs font-medium text-gray-600 mb-1">{t('verification.suggestions')}:</p>
                    <ul className="space-y-1">
                        {suggestions.map((item, index) => (
                            <li key={index} className="text-xs text-blue-600 flex items-start">
                                <span className="mr-1.5">💡</span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default VerificationStatus;
