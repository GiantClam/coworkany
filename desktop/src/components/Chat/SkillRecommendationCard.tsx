/**
 * Skill Recommendation Card
 *
 * Displays skill recommendations in a visual card format with action buttons
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillRecommendation } from '../../types';

interface SkillRecommendationCardProps {
    recommendations: SkillRecommendation[];
    autoLoaded?: SkillRecommendation | null;
    onLoadSkill?: (skillName: string) => void;
    onDismiss?: () => void;
}

export const SkillRecommendationCard: React.FC<SkillRecommendationCardProps> = ({
    recommendations,
    autoLoaded,
    onLoadSkill,
    onDismiss,
}) => {
    const { t } = useTranslation();
    if (!recommendations || recommendations.length === 0) {
        return null;
    }

    return (
        <div className="skill-recommendation-card bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
            {autoLoaded && (
                <div className="mb-3 pb-3 border-b border-blue-200 dark:border-blue-800">
                    <div className="flex items-start gap-2">
                        <span className="text-lg">✅</span>
                        <div className="flex-1">
                            <div className="font-semibold text-blue-900 dark:text-blue-100">
                                {t('chat.autoLoaded', { name: autoLoaded.skillName })}
                            </div>
                            <div className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                                {autoLoaded.reason}
                            </div>
                            <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                {t('chat.confidence', { percent: (autoLoaded.confidence * 100).toFixed(0) })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-start gap-2 mb-3">
                <span className="text-lg">📚</span>
                <h4 className="font-semibold text-blue-900 dark:text-blue-100">
                    {t('chat.recommendedSkills')}
                </h4>
            </div>

            <div className="space-y-3">
                {recommendations.slice(0, 3).map((rec) => (
                    <div
                        key={rec.skillName}
                        className="bg-white dark:bg-gray-800 rounded-md p-3 border border-blue-100 dark:border-blue-900"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 dark:text-gray-100">
                                    {rec.skillName}
                                </div>
                                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    {rec.reason}
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                    <div className="text-xs text-gray-500 dark:text-gray-500">
                                        {t('chat.match', { percent: (rec.confidence * 100).toFixed(0) })}
                                    </div>
                                    <div className="h-1.5 flex-1 max-w-24 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 rounded-full"
                                            style={{ width: `${rec.confidence * 100}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                            {onLoadSkill && (
                                <button
                                    onClick={() => onLoadSkill(rec.skillName)}
                                    className="px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded transition-colors whitespace-nowrap"
                                >
                                    Load
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {recommendations.length > 3 && (
                <div className="text-sm text-blue-600 dark:text-blue-400 mt-3 text-center">
                    {t('chat.moreSuggestions', { count: recommendations.length - 3 })}
                </div>
            )}

            {onDismiss && (
                <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
                    <button
                        onClick={onDismiss}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
                    >
                        Dismiss
                    </button>
                </div>
            )}
        </div>
    );
};
