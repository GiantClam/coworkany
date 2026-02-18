/**
 * Task Event Store (Backward Compatibility Export)
 *
 * This file re-exports the modularized store from taskEvents/
 * to maintain backward compatibility with existing imports.
 */

export {
    useTaskEventStore,
    useActiveSession,
    useSidecarConnected,
    hydrateSessions,
} from './taskEvents';

export type {
    TaskStatus,
    TaskEvent,
    PlanStep,
    ToolCall,
    Effect,
    Patch,
    ChatMessage,
    AuditEvent,
    IpcResponse,
    TaskSession,
} from './taskEvents';
