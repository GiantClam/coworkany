/**
 * Proactive Module
 *
 * Enables OpenClaw-style proactive behavior:
 * - Heartbeat engine for scheduled and event-driven tasks
 * - Background monitoring and automation
 * - Self-initiated actions without user prompting
 */

export {
    HeartbeatEngine,
    createHeartbeatEngine,
    TriggerPresets,
} from './heartbeat';

export type {
    Trigger,
    TriggerType,
    TriggerConfig,
    TriggerAction,
    TriggerEvent,
    CronConfig,
    FileWatchConfig,
    WebhookConfig,
    ConditionConfig,
    IntervalConfig,
    HeartbeatEvent,
    HeartbeatEventType,
    HeartbeatEventCallback,
    ProactiveTaskExecutor,
} from './heartbeat';
