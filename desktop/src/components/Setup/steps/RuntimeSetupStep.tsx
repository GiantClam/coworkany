import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDependencyManager, type DependencyStatus } from '../../../hooks/useDependencyManager';
import styles from '../SetupWizard.module.css';

type RuntimeSetupStatus = {
    skillhubReady: boolean;
    ragReady: boolean;
    browserReady: boolean;
};

interface RuntimeSetupStepProps {
    apiKeyConfigured: boolean;
    onStatusChange?: (status: RuntimeSetupStatus) => void;
}

const REQUIRED_DEPENDENCY_IDS = new Set(['skillhub-cli', 'rag-service']);

function toRuntimeStatus(dependencies: DependencyStatus[]): RuntimeSetupStatus {
    return {
        skillhubReady: dependencies.find((item) => item.id === 'skillhub-cli')?.ready ?? false,
        ragReady: dependencies.find((item) => item.id === 'rag-service')?.ready ?? false,
        browserReady: dependencies.find((item) => item.id === 'browser-use-service')?.ready ?? false,
    };
}

export function RuntimeSetupStep({ apiKeyConfigured, onStatusChange }: RuntimeSetupStepProps) {
    const { t } = useTranslation();
    const {
        dependencies,
        runtimeContext,
        error,
        activeAction,
        installSkillhub,
        installOpencli,
        prepareServiceRuntime,
    } = useDependencyManager();
    const [preparingAll, setPreparingAll] = useState(false);
    const [progressMessage, setProgressMessage] = useState<string | null>(null);

    const requiredDependencies = useMemo(
        () => dependencies.filter((dependency) => REQUIRED_DEPENDENCY_IDS.has(dependency.id)),
        [dependencies]
    );
    const optionalDependencies = useMemo(
        () => dependencies.filter((dependency) => !REQUIRED_DEPENDENCY_IDS.has(dependency.id)),
        [dependencies]
    );
    const status = useMemo(() => toRuntimeStatus(dependencies), [dependencies]);

    useEffect(() => {
        onStatusChange?.(status);
    }, [onStatusChange, status]);

    const runDependencyAction = async (dependency: DependencyStatus) => {
        try {
            if (dependency.id === 'skillhub-cli') {
                setProgressMessage(t(
                    'setup.runtimeInstallingSkillhubNotice',
                    'Installing Skillhub CLI. This can take a few minutes and the window should remain responsive.'
                ));
                await installSkillhub();
                return;
            }
            if (dependency.id === 'opencli-cli') {
                setProgressMessage(t(
                    'setup.runtimeInstallingOpencliNotice',
                    'Installing OpenCLI. This can take a few minutes and the window should remain responsive.'
                ));
                await installOpencli();
                return;
            }
            setProgressMessage(
                dependency.id === 'rag-service'
                    ? t(
                        'setup.runtimePreparingRagNotice',
                        'Preparing local RAG runtime. Downloading Python packages may take several minutes.'
                    )
                    : t(
                        'setup.runtimePreparingBrowserNotice',
                        'Preparing browser smart mode runtime. Downloading dependencies may take several minutes.'
                    )
            );
            await prepareServiceRuntime(dependency.id);
        } finally {
            setProgressMessage(null);
        }
    };

    const handlePrepareEssentials = async () => {
        setPreparingAll(true);
        try {
            for (const dependency of requiredDependencies) {
                if (!dependency.ready) {
                    await runDependencyAction(dependency);
                }
            }
        } finally {
            setProgressMessage(null);
            setPreparingAll(false);
        }
    };

    return (
        <div className={styles.stepLayout}>
            <div className={styles.stepIntro}>
                <span className={styles.stepEyebrow}>
                    {t('setup.runtimeStepEyebrow', 'Step 3')}
                </span>
                <h2 className={styles.welcomeTitle}>
                    {t('setup.runtimeTitle', 'Enable core capabilities')}
                </h2>
                <p className={styles.welcomeSubtitle}>
                    {apiKeyConfigured
                        ? t(
                            'setup.runtimeSubtitleConfigured',
                            'Prepare the built-in services that power search, memory, and marketplace flows.'
                        )
                        : t(
                            'setup.runtimeSubtitlePending',
                            'You can prepare the built-in services now and add your model configuration later in Settings.'
                        )}
                </p>
                {runtimeContext && (
                    <p className={styles.welcomeSubtitle}>
                        {runtimeContext.platform}/{runtimeContext.arch} · {runtimeContext.sidecarLaunchMode ?? 'unknown'}
                    </p>
                )}
            </div>

            <div className={styles.runtimeHero}>
                <div className={styles.runtimeHeroCopy}>
                    <strong>{t('setup.runtimeHeroTitle', 'Recommended first-run actions')}</strong>
                    <span>
                        {t(
                            'setup.runtimeHeroText',
                            'Install Skillhub CLI and prepare the local RAG runtime so marketplace installs and memory features work on first use. OpenCLI can be enabled from the optional section.'
                        )}
                    </span>
                </div>
                <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={() => void handlePrepareEssentials()}
                    disabled={preparingAll || requiredDependencies.every((dependency) => dependency.ready)}
                >
                    {preparingAll
                        ? t('setup.runtimePreparingAll', 'Preparing...')
                        : t('setup.runtimePrepareEssentials', 'Prepare essentials')}
                </button>
            </div>

            {error && (
                <div className={`${styles.validationResult} ${styles.validationError}`}>
                    {error}
                </div>
            )}

            {progressMessage && (
                <div className={`${styles.validationResult} ${styles.validationSuccess}`}>
                    {progressMessage}
                </div>
            )}

            <div className={styles.runtimeCardGrid}>
                {requiredDependencies.map((dependency) => (
                    <RuntimeCard
                        key={dependency.id}
                        dependency={dependency}
                        busy={activeAction === dependency.id}
                        onAction={runDependencyAction}
                        actionLabel={dependency.ready
                            ? t('setup.runtimeRefresh', 'Refresh runtime')
                            : dependency.id === 'skillhub-cli'
                                ? t('setup.runtimeInstallSkillhub', 'Install Skillhub CLI')
                                : dependency.id === 'opencli-cli'
                                    ? t('setup.runtimeInstallOpencli', 'Install OpenCLI')
                                : t('setup.runtimePrepare', 'Prepare runtime')}
                    />
                ))}
            </div>

            <div className={styles.optionalBlock}>
                <div className={styles.optionalHeader}>
                    <strong>{t('setup.runtimeOptionalTitle', 'Optional capability')}</strong>
                    <span>
                        {t(
                            'setup.runtimeOptionalText',
                            'Enable browser smart mode only if you need AI browser automation.'
                        )}
                    </span>
                </div>
                <div className={styles.runtimeCardGrid}>
                    {optionalDependencies.map((dependency) => (
                        <RuntimeCard
                            key={dependency.id}
                            dependency={dependency}
                            busy={activeAction === dependency.id}
                            onAction={runDependencyAction}
                            actionLabel={dependency.ready
                                ? t('setup.runtimeRefresh', 'Refresh runtime')
                                : dependency.id === 'opencli-cli'
                                    ? t('setup.runtimeInstallOpencli', 'Install OpenCLI')
                                : t('setup.runtimePrepareOptional', 'Enable capability')}
                            optional
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function RuntimeCard({
    dependency,
    busy,
    onAction,
    actionLabel,
    optional = false,
}: {
    dependency: DependencyStatus;
    busy: boolean;
    onAction: (dependency: DependencyStatus) => Promise<void>;
    actionLabel: string;
    optional?: boolean;
}) {
    return (
        <div className={styles.runtimeCard}>
            <div className={styles.runtimeCardTop}>
                <div>
                    <div className={styles.runtimeCardTitleRow}>
                        <strong>{dependency.name}</strong>
                        {optional && <span className={styles.runtimeBadgeMuted}>Optional</span>}
                    </div>
                    <p>{dependency.description}</p>
                </div>
                <span className={dependency.ready ? styles.runtimeBadgeReady : styles.runtimeBadgePending}>
                    {dependency.ready ? 'Ready' : 'Pending'}
                </span>
            </div>

            <div className={styles.runtimeMetaRow}>
                <span className={dependency.installed ? styles.runtimeBadgeReady : styles.runtimeBadgePending}>
                    {dependency.installed ? 'Installed' : 'Missing'}
                </span>
                {typeof dependency.running === 'boolean' && (
                    <span className={dependency.running ? styles.runtimeBadgeReady : styles.runtimeBadgeMuted}>
                        {dependency.running ? 'Running' : 'Stopped'}
                    </span>
                )}
            </div>

            {dependency.error && (
                <div className={`${styles.validationResult} ${styles.validationError}`}>
                    {dependency.error}
                </div>
            )}

            <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => void onAction(dependency)}
                disabled={busy}
            >
                {busy ? 'Working...' : actionLabel}
            </button>
        </div>
    );
}
