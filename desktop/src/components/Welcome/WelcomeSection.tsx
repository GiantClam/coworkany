/**
 * WelcomeSection Component
 *
 * Landing state for the primary chat surface.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import './WelcomeSection.css';

interface WelcomeSectionProps {
    onNewTask: () => void;
    onOpenProject: () => void;
    onTaskList: () => void;
}

const ArrowIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
    </svg>
);

export const WelcomeSection: React.FC<WelcomeSectionProps> = ({
    onNewTask,
    onTaskList,
}) => {
    const { t } = useTranslation();

    return (
        <div className="welcome-section">
            <div className="welcome-content">
                <div className="welcome-kicker">CoworkAny Desktop</div>
                <h1 className="welcome-headline">{t('chat.howCanIHelp')}</h1>
                <p className="welcome-hint">{t('chat.startTaskHint')}</p>

                <div className="welcome-actions">
                    <button type="button" className="welcome-action-card primary" onClick={onNewTask}>
                        <div className="welcome-action-copy">
                            <span className="welcome-action-title">{t('welcome.newTask')}</span>
                            <span className="welcome-action-desc">{t('welcome.newTaskDesc')}</span>
                        </div>
                        <span className="welcome-action-icon">
                            <ArrowIcon />
                        </span>
                    </button>

                    <button type="button" className="welcome-action-card" onClick={onTaskList}>
                        <div className="welcome-action-copy">
                            <span className="welcome-action-title">{t('welcome.taskList')}</span>
                            <span className="welcome-action-desc">{t('welcome.taskListDesc')}</span>
                        </div>
                        <span className="welcome-action-icon">
                            <ArrowIcon />
                        </span>
                    </button>
                </div>

                <div className="welcome-signal-row" aria-hidden="true">
                    <span className="welcome-signal-pill">Images</span>
                    <span className="welcome-signal-pill">Models</span>
                    <span className="welcome-signal-pill">Workspaces</span>
                </div>
            </div>
        </div>
    );
};

export default WelcomeSection;
