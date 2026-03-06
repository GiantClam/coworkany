import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauri';

export interface StartupMeasurementConfig {
    enabled: boolean;
    profile: 'baseline' | 'optimized';
    runLabel: string;
}

let configPromise: Promise<StartupMeasurementConfig> | null = null;
let cachedConfig: StartupMeasurementConfig | null = null;

const defaultConfig: StartupMeasurementConfig = {
    enabled: false,
    profile: 'optimized',
    runLabel: '',
};

export async function getStartupMeasurementConfig(): Promise<StartupMeasurementConfig> {
    if (cachedConfig) {
        return cachedConfig;
    }
    if (!isTauri()) {
        cachedConfig = defaultConfig;
        return cachedConfig;
    }
    if (!configPromise) {
        configPromise = invoke<StartupMeasurementConfig>('get_startup_measurement_config')
            .then((config) => ({
                enabled: Boolean(config?.enabled),
                profile: config?.profile === 'baseline' ? 'baseline' : 'optimized',
                runLabel: String(config?.runLabel ?? ''),
            }) as StartupMeasurementConfig)
            .catch(() => defaultConfig as StartupMeasurementConfig);
    }
    const resolved = await configPromise;
    cachedConfig = resolved;
    return resolved;
}

export async function recordStartupMetric(
    mark: string,
    frontendElapsedMs?: number,
    perfNowMs?: number,
    windowLabel?: string
): Promise<void> {
    if (!isTauri()) {
        return;
    }
    try {
        const config = await getStartupMeasurementConfig();
        if (!config.enabled) {
            return;
        }
        await invoke('record_startup_metric', {
            input: {
                mark,
                frontendElapsedMs,
                perfNowMs,
                windowLabel,
            },
        });
    } catch {
        // non-critical
    }
}
