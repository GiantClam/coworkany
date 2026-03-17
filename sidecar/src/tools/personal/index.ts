/**
 * Personal Tools
 *
 * Weather, News, Reminders, Notes - Personal assistant tools
 */

import { ToolDefinition } from '../standard';

export * from './weather';
export * from './news';
export * from './reminder';
export * from './notes';
export * from './scheduleTask';

import { checkWeatherTool } from './weather';
import { getNewsTool } from './news';
import { setReminderTool } from './reminder';
import { quickNoteTool } from './notes';
import { createScheduleTaskTool, type ScheduleTaskToolHandlers } from './scheduleTask';

export const PERSONAL_TOOLS: ToolDefinition[] = [
    checkWeatherTool,
    getNewsTool,
    setReminderTool,
    quickNoteTool,
];

export function createPersonalTools(handlers: ScheduleTaskToolHandlers): ToolDefinition[] {
    return [
        ...PERSONAL_TOOLS,
        createScheduleTaskTool(handlers),
    ];
}
