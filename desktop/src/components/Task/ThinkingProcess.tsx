
import React from 'react';
import { useTranslation } from 'react-i18next';

interface Step {
    id: string;
    description: string;
    status: 'pending' | 'processing' | 'done' | 'error';
    details?: string;
}

interface ThinkingProcessProps {
    steps: Step[];
    currentStepId?: string;
}

export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({ steps }) => {
    const { t } = useTranslation();
    return (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-sm shadow-lg max-w-md">
            <h3 className="text-gray-300 font-bold mb-3 flex items-center gap-2">
                <span className="animate-pulse">🧠</span> {t('chat.thinkingProcess')}
            </h3>

            <div className="space-y-3 relative">
                {/* Vertical line connector */}
                <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-gray-800 -z-10"></div>

                {steps.map((step, idx) => (
                    <div key={step.id} className="flex gap-3 relative">
                        <div className={`
                            w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2 
                            ${step.status === 'done' ? 'bg-green-900 border-green-600 text-green-400' :
                                step.status === 'processing' ? 'bg-blue-900 border-blue-500 text-blue-300 animate-pulse' :
                                    step.status === 'error' ? 'bg-red-900 border-red-600 text-red-400' :
                                        'bg-gray-800 border-gray-600 text-gray-500'}
                        `}>
                            {step.status === 'done' ? '✓' :
                                step.status === 'error' ? '!' :
                                    (idx + 1)}
                        </div>

                        <div className="flex-1">
                            <div className={`
                                ${step.status === 'done' ? 'text-gray-400' :
                                    step.status === 'processing' ? 'text-white font-bold' :
                                        step.status === 'error' ? 'text-red-400' :
                                            'text-gray-500'}
                            `}>
                                {step.description}
                            </div>
                            {step.details && (
                                <div className="mt-1 text-xs text-gray-600 bg-gray-950/50 p-2 rounded">
                                    {step.details}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
