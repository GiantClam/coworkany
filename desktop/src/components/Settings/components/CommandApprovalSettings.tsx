import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PolicyConfig } from '../../../types';
import styles from '../SettingsView.module.css';

interface CommandApprovalSettingsProps {
    policyConfig: PolicyConfig;
    saved: boolean;
    saving: boolean;
    onSave: (config: PolicyConfig) => Promise<void>;
}

function normalizeCommands(commands: string[]): string[] {
    return Array.from(new Set(commands.map((command) => command.trim().toLowerCase()).filter(Boolean))).sort();
}

export function CommandApprovalSettings({
    policyConfig,
    saved,
    saving,
    onSave,
}: CommandApprovalSettingsProps) {
    const { t } = useTranslation();
    const commands = useMemo(
        () => normalizeCommands(policyConfig.allowlists?.commands ?? []),
        [policyConfig.allowlists?.commands]
    );

    const removeCommand = async (command: string) => {
        const nextCommands = commands.filter((entry) => entry !== command);
        await onSave({
            ...policyConfig,
            allowlists: {
                ...policyConfig.allowlists,
                commands: nextCommands,
            },
        });
    };

    const clearAll = async () => {
        await onSave({
            ...policyConfig,
            allowlists: {
                ...policyConfig.allowlists,
                commands: [],
            },
        });
    };

    return (
        <div className={styles.section} data-testid="command-approval-settings">
            <div className={styles.sectionHeader}>
                <div>
                    <h3>Command approvals</h3>
                    <p>
                        Review and remove commands that were permanently approved through the host execution policy.
                    </p>
                </div>
                <div className={styles.inlineMeta}>
                    <span className={styles.scopeBadge}>{commands.length} permanent</span>
                    {saved && <span className={styles.activeBadge}>{t('settings.saved')}</span>}
                </div>
            </div>

            <div className={styles.infoBox}>
                `Allow once` applies only to the current request. `Allow this session` resets after app restart.
                Only commands listed here are permanently trusted across restarts. Removing an item forces a new approval prompt the next time the same command is requested.
            </div>

            {commands.length === 0 ? (
                <div className={styles.emptyState}>
                    No persistent command approvals yet.
                </div>
            ) : (
                <div className={styles.commandApprovalList}>
                    {commands.map((command) => (
                        <div key={command} className={styles.commandApprovalItem} data-command={command}>
                            <div>
                                <div className={styles.commandApprovalName}>{command}</div>
                                <div className={styles.commandApprovalMeta}>Persistent allowlist entry</div>
                            </div>
                            <button
                                type="button"
                                data-testid="command-approval-remove"
                                aria-label={`Remove ${command} from persistent approvals`}
                                className={styles.ghostButton}
                                disabled={saving}
                                onClick={() => void removeCommand(command)}
                            >
                                {saving ? 'Saving...' : 'Remove'}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {commands.length > 0 && (
                <div className={styles.inlineActions}>
                    <button
                        type="button"
                        data-testid="command-approval-clear"
                        className={styles.ghostButton}
                        disabled={saving}
                        onClick={() => void clearAll()}
                    >
                        {saving ? 'Saving...' : 'Clear allowlist'}
                    </button>
                </div>
            )}
        </div>
    );
}

export default CommandApprovalSettings;
