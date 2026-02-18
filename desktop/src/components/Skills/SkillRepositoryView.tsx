/**
 * SkillRepositoryView Component
 *
 * Wraps RepositoryBrowser for skill-specific installation
 */

import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { RepositoryBrowser, type RepositoryItem } from '../Repository/RepositoryBrowser';
import { useRepositoryScan } from '../../hooks/useRepositoryScan';

// ============================================================================
// Types
// ============================================================================

interface SkillRepositoryViewProps {
    onInstallComplete?: () => void;
    installedSkillIds?: Set<string>;
}

interface IpcResult {
    success: boolean;
    payload?: unknown;
}

// ============================================================================
// Component
// ============================================================================

export const SkillRepositoryView: React.FC<SkillRepositoryViewProps> = ({
    onInstallComplete,
    installedSkillIds
}) => {
    const { t } = useTranslation();
    const { skills, loading, error, scan } = useRepositoryScan();

    // Scan on mount
    useEffect(() => {
        void scan();
    }, [scan]);

    const handleInstall = async (selectedItems: RepositoryItem[]) => {
        console.log('[SkillRepositoryView] Installing', selectedItems.length, 'skills');

        const results = await Promise.allSettled(
            selectedItems.map(async (item) => {
                try {
                    // Get current workspace path
                    const workspacePath = await invoke<string>('get_workspace_root');

                    // Install from GitHub
                    await invoke<IpcResult>('install_from_github', {
                        input: {
                            workspacePath,
                            source: item.source,
                            targetType: 'skill',
                        },
                    });

                    console.log('[SkillRepositoryView] Installed:', item.name);
                    return { success: true, name: item.name };
                } catch (err) {
                    console.error('[SkillRepositoryView] Failed to install:', item.name, err);
                    throw new Error(`Failed to install ${item.name}: ${err}`);
                }
            })
        );

        // Count successes and failures
        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        if (failed > 0) {
            const failureMessages = results
                .filter((r) => r.status === 'rejected')
                .map((r) => (r as PromiseRejectedResult).reason)
                .join('\n');

            alert(
                `${t('skills.installWithErrors', { succeeded, failed })}\n\n${failureMessages}`
            );
        } else {
            alert(t('skills.successfullyInstalled', { count: succeeded }));
        }

        // Notify parent to refresh skill list
        if (onInstallComplete) {
            onInstallComplete();
        }
    };

    const handleRefresh = () => {
        void scan(true); // Force refresh
    };

    return (
        <RepositoryBrowser
            items={skills}
            loading={loading}
            error={error}
            onInstall={handleInstall}
            onRefresh={handleRefresh}
            type="skill"
            installedItemIds={installedSkillIds}
        />
    );
};
