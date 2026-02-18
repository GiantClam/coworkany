/**
 * Productivity Tools
 *
 * Calendar, Email, Tasks, Voice - Personal productivity tools
 */

// Re-export from core (backward compatibility)
export * from '../core/calendar';
export * from '../core/email';
export * from '../core/tasks';
export * from '../core/voice';
export * from '../core/system';

import { ToolDefinition } from '../standard';
import {
    calendarCheckTool,
    calendarCreateEventTool,
    calendarUpdateEventTool,
    calendarFindFreeTimeTool,
} from '../core/calendar';
import {
    emailCheckTool,
    emailSendTool,
    emailReplyTool,
    emailGetThreadTool,
} from '../core/email';
import {
    taskCreateTool,
    taskListTool,
    taskUpdateTool,
} from '../core/tasks';
import {
    voiceSpeakTool,
} from '../core/voice';
import {
    systemStatusTool,
} from '../core/system';

export const PRODUCTIVITY_TOOLS: ToolDefinition[] = [
    // Calendar
    calendarCheckTool,
    calendarCreateEventTool,
    calendarUpdateEventTool,
    calendarFindFreeTimeTool,

    // Email
    emailCheckTool,
    emailSendTool,
    emailReplyTool,
    emailGetThreadTool,

    // Tasks
    taskCreateTool,
    taskListTool,
    taskUpdateTool,

    // Voice
    voiceSpeakTool,

    // System
    systemStatusTool,
];
