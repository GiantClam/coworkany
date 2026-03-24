import { useMemo } from 'react';
import { toast } from '../../Common/ToastProvider';
import { useDependencyManager } from '../../../hooks/useDependencyManager';
import styles from '../SettingsView.module.css';

export function DependencySetupSection() {
    const {
        dependencies,
        runtimeContext,
        loading,
        error,
        activeAction,
        refresh,
        installSkillhub,
        installOpencli,
        prepareServiceRuntime,
        startDependencyService,
        stopDependencyService,
    } = useDependencyManager();
    const dependencyCards = useMemo(() => dependencies, [dependencies]);

    const handleInstallSkillhub = async () => {
        try {
            await installSkillhub();
            toast.success('Skillhub CLI ready');
        } catch (err) {
            toast.error('Skillhub install failed', err instanceof Error ? err.message : String(err));
        }
    };

    const handleInstallOpencli = async () => {
        try {
            await installOpencli();
            toast.success('OpenCLI ready');
        } catch (err) {
            toast.error('OpenCLI install failed', err instanceof Error ? err.message : String(err));
        }
    };

    const handlePrepareRuntime = async (name: string) => {
        try {
            await prepareServiceRuntime(name);
            toast.success(`${name} runtime prepared`);
        } catch (err) {
            toast.error('Runtime preparation failed', err instanceof Error ? err.message : String(err));
        }
    };

    const handleStartStop = async (name: string, running: boolean) => {
        try {
            if (running) {
                await stopDependencyService(name);
            } else {
                await startDependencyService(name);
            }
        } catch (err) {
            toast.error('Service action failed', err instanceof Error ? err.message : String(err));
        }
    };

    const isCliDependency = (id: string) => id === 'skillhub-cli' || id === 'opencli-cli';

    return (
        <div className={styles.runtimeSection}>
            <div className={styles.runtimeSectionHeader}>
                <div>
                    <h3>Runtime Setup</h3>
                    <p>
                        Prepare bundled services and marketplace dependencies for a fresh Mac install.
                    </p>
                    {runtimeContext && (
                        <p style={{ fontSize: '11px', opacity: 0.7, marginTop: '4px' }}>
                            {runtimeContext.platform}/{runtimeContext.arch} · {runtimeContext.sidecarLaunchMode ?? 'unknown'}
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    className={styles.refreshBtn}
                    onClick={() => void refresh()}
                    disabled={loading}
                >
                    Refresh
                </button>
            </div>

            {error && (
                <div className={styles.errorBanner}>{error}</div>
            )}

            <div className={styles.runtimeDependencyGrid}>
                {dependencyCards.map((dependency) => (
                    <div
                        key={dependency.id}
                        className={styles.runtimeDependencyCard}
                    >
                        <div className={styles.runtimeDependencyCopy}>
                            <div className={styles.runtimeDependencyHeader}>
                                <div className={styles.runtimeDependencyTitleRow}>
                                    <strong>{dependency.name}</strong>
                                </div>
                                <div className={styles.runtimeChipRow}>
                                    {dependency.optional && (
                                        <span className={styles.runtimeChipInfo}>Optional</span>
                                    )}
                                    <span className={dependency.installed ? styles.runtimeChipReady : styles.runtimeChipMuted}>
                                        Installed
                                    </span>
                                    {dependency.bundled && (
                                        <span className={styles.runtimeChipInfo}>Bundled</span>
                                    )}
                                    <span className={dependency.ready ? styles.runtimeChipReady : styles.runtimeChipMuted}>
                                        Runtime Ready
                                    </span>
                                    {typeof dependency.running === 'boolean' && (
                                        <span className={dependency.running ? styles.runtimeChipReady : styles.runtimeChipMuted}>
                                            {dependency.running ? 'Running' : 'Stopped'}
                                        </span>
                                    )}
                                </div>
                            </div>
                            {dependency.description && (
                                <div className={styles.runtimeDependencyDescription}>
                                    {dependency.description}
                                </div>
                            )}
                            {dependency.version && (
                                <div className={styles.runtimeDependencyMeta}>Version: {dependency.version}</div>
                            )}
                            {dependency.path && (
                                <div className={styles.runtimeDependencyMeta}>
                                    {dependency.path}
                                </div>
                            )}
                            {dependency.error && (
                                <div className={styles.runtimeDependencyError}>
                                    {dependency.error}
                                </div>
                            )}
                        </div>

                        <div className={styles.runtimeDependencyActions}>
                            {isCliDependency(dependency.id) ? (
                                <button
                                    type="button"
                                    className={styles.verifyButton}
                                    onClick={() => {
                                        if (dependency.id === 'skillhub-cli') {
                                            void handleInstallSkillhub();
                                        } else {
                                            void handleInstallOpencli();
                                        }
                                    }}
                                    disabled={activeAction === dependency.id}
                                >
                                    {dependency.ready
                                        ? 'Reinstall CLI'
                                        : dependency.id === 'skillhub-cli'
                                            ? 'Install Skillhub CLI'
                                            : 'Install OpenCLI'}
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        className={styles.verifyButton}
                                        onClick={() => void handlePrepareRuntime(dependency.id)}
                                        disabled={activeAction === dependency.id}
                                    >
                                        {dependency.ready ? 'Refresh Runtime' : 'Prepare Runtime'}
                                    </button>
                                    {dependency.ready && (
                                        <button
                                            type="button"
                                            className={styles.optionBtn}
                                            onClick={() => void handleStartStop(dependency.id, Boolean(dependency.running))}
                                        >
                                            {dependency.running ? 'Stop Service' : 'Start Service'}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
