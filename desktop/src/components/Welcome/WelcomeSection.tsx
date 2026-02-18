/**
 * WelcomeSection Component
 *
 * Modern welcome screen with quick action cards
 * Designed for enterprise users with efficiency in mind
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import './WelcomeSection.css';

interface WelcomeSectionProps {
    onNewTask: () => void;
    onOpenProject: () => void;
    onTaskList: () => void;
}


export const WelcomeSection: React.FC<WelcomeSectionProps> = () => {
    const { t } = useTranslation();

    return (
        <div className="welcome-section">
            <div className="welcome-content">
                <h1 className="welcome-headline">{t('chat.howCanIHelp')}</h1>
                <p className="welcome-hint">{t('chat.startTaskHint')}</p>
            </div>
        </div>
    );
};

export default WelcomeSection;
