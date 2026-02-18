/**
 * Anonymous Telemetry
 *
 * Collects anonymous usage statistics locally.
 * Opt-in only, controlled via configStore.
 * Can be extended to send to a remote endpoint later.
 */

import { getConfig, saveConfig } from './configStore';

export interface TelemetryEvent {
    event: string;
    properties?: Record<string, string | number | boolean>;
    timestamp: string;
}

export interface TelemetryConfig {
    enabled: boolean;
    crashReporting: boolean;
}

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
    enabled: false,
    crashReporting: false,
};

let _config: TelemetryConfig | null = null;

/** Get telemetry configuration */
export async function getTelemetryConfig(): Promise<TelemetryConfig> {
    if (_config) return _config;
    const stored = await getConfig<TelemetryConfig>('telemetry');
    _config = { ...DEFAULT_TELEMETRY_CONFIG, ...stored };
    return _config;
}

/** Save telemetry configuration */
export async function saveTelemetryConfig(config: TelemetryConfig): Promise<void> {
    _config = config;
    await saveConfig('telemetry', config);
}

/** Track an anonymous event (stored locally) */
export async function trackEvent(event: string, properties?: Record<string, string | number | boolean>): Promise<void> {
    const config = await getTelemetryConfig();
    if (!config.enabled) return;

    const entry: TelemetryEvent = {
        event,
        properties,
        timestamp: new Date().toISOString(),
    };

    // Store locally in a rolling buffer (keep last 500 events)
    const events = (await getConfig<TelemetryEvent[]>('telemetryEvents')) || [];
    events.push(entry);
    if (events.length > 500) events.splice(0, events.length - 500);
    await saveConfig('telemetryEvents', events);
}

/** Report a crash/error (stored locally) */
export async function reportCrash(error: Error, context?: string): Promise<void> {
    const config = await getTelemetryConfig();
    if (!config.crashReporting) return;

    const entry = {
        message: error.message,
        stack: error.stack?.slice(0, 1000),
        context,
        timestamp: new Date().toISOString(),
        platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
    };

    const crashes = (await getConfig<typeof entry[]>('crashReports')) || [];
    crashes.push(entry);
    if (crashes.length > 50) crashes.splice(0, crashes.length - 50);
    await saveConfig('crashReports', crashes);
}
