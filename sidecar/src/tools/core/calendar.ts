/**
 * Core Calendar Tools
 *
 * Provides calendar management capabilities (Check, Create Event, Update, Find Free Time).
 * Integrates with Google Calendar API and task system.
 * Part of the OpenClaw-compatible tool architecture.
 */

import { ToolDefinition, ToolContext } from '../standard';
import { getCalendarManager } from '../../integrations/calendar/calendarManager';

/**
 * calendar_check - Get upcoming calendar events
 */
export const calendarCheckTool: ToolDefinition = {
    name: 'calendar_check',
    description: 'Get upcoming calendar events. Useful for checking schedule, finding free time, and avoiding conflicts. Returns events with conflict detection.',
    effects: ['network:outbound', 'state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            time_range: {
                type: 'string',
                enum: ['today', 'tomorrow', 'this_week', 'next_week', 'custom'],
                description: 'Time range to query (default: today)',
            },
            start_time: {
                type: 'string',
                description: 'Custom start time (ISO 8601) - required if time_range is custom',
            },
            end_time: {
                type: 'string',
                description: 'Custom end time (ISO 8601) - required if time_range is custom',
            },
            calendar_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional specific calendar IDs to query',
            },
        },
    },
    handler: async (args: any, context: ToolContext) => {
        try {
            const manager = getCalendarManager(context.workspacePath);

            // Check if calendar is configured
            if (!manager.isConfigured()) {
                return {
                    success: false,
                    error: 'Calendar not configured',
                    message: 'Calendar integration requires Google API credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
                };
            }

            // Calculate time range
            const { timeMin, timeMax } = calculateTimeRange(
                args.time_range || 'today',
                args.start_time,
                args.end_time
            );

            const events = await manager.getEvents({
                timeMin,
                timeMax,
                calendarIds: args.calendar_ids,
            });

            // Detect conflicts
            const conflicts = detectConflicts(events);

            return {
                success: true,
                count: events.length,
                time_range: args.time_range || 'today',
                events: events.map(formatEventForDisplay),
                conflicts: conflicts.map(c => ({
                    event1: formatEventForDisplay(c.event1),
                    event2: formatEventForDisplay(c.event2),
                })),
            };
        } catch (error) {
            return {
                success: false,
                error: String(error),
                message: 'Failed to fetch calendar events.',
            };
        }
    },
};

/**
 * calendar_create_event - Create a new calendar event
 */
export const calendarCreateEventTool: ToolDefinition = {
    name: 'calendar_create_event',
    description: 'Create a new calendar event or meeting. Can automatically find free time slots if requested. Optionally creates a linked task.',
    effects: ['network:outbound', 'state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Event title' },
            description: { type: 'string', description: 'Event description' },
            start_time: { type: 'string', description: 'Start time (ISO 8601)' },
            end_time: { type: 'string', description: 'End time (ISO 8601)' },
            location: { type: 'string', description: 'Meeting location or video link' },
            attendees: {
                type: 'array',
                items: { type: 'string' },
                description: 'Email addresses of attendees',
            },
            reminders: {
                type: 'array',
                items: { type: 'number' },
                description: 'Reminder times in minutes before event (e.g., [10, 30])',
            },
            find_free_slot: {
                type: 'boolean',
                description: 'If true and time conflicts, find next available slot (default: false)',
            },
            create_task: {
                type: 'boolean',
                description: 'Also create a linked task for this event (default: false)',
            },
        },
        required: ['title', 'start_time', 'end_time'],
    },
    handler: async (args: any, context: ToolContext) => {
        try {
            const manager = getCalendarManager(context.workspacePath);

            // Check if calendar is configured
            if (!manager.isConfigured()) {
                return {
                    success: false,
                    error: 'Calendar not configured',
                    message: 'Calendar integration requires Google API credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
                };
            }

            // Check for conflicts if find_free_slot is enabled
            let finalStartTime = args.start_time;
            let finalEndTime = args.end_time;

            if (args.find_free_slot) {
                const conflictCheck = await manager.getEvents({
                    timeMin: args.start_time,
                    timeMax: args.end_time,
                });

                if (conflictCheck.length > 0) {
                    // Find next free slot
                    const duration = new Date(args.end_time).getTime() - new Date(args.start_time).getTime();
                    const freeSlot = await manager.findFreeTime({
                        durationMinutes: duration / (60 * 1000),
                        timeMin: args.start_time,
                        timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                    });

                    if (freeSlot) {
                        finalStartTime = freeSlot.start;
                        finalEndTime = freeSlot.end;
                    }
                }
            }

            const event = await manager.createEvent({
                title: args.title,
                description: args.description,
                startTime: finalStartTime,
                endTime: finalEndTime,
                location: args.location,
                attendees: args.attendees || [],
                reminders: args.reminders || [10],
            });

            // Create linked task if requested
            let task = null;
            if (args.create_task) {
                const { taskCreateTool } = await import('./tasks');
                const taskResult = await taskCreateTool.handler(
                    {
                        title: `Prepare for: ${args.title}`,
                        description: `Related to calendar event: ${args.title}`,
                        priority: 'medium',
                        tags: ['calendar', 'event'],
                    },
                    context
                );

                if (taskResult.success) {
                    task = taskResult.task;
                    // Link task to event
                    const { createProactiveTaskManager } = await import('../../agent/jarvis/proactiveTaskManager');
                    const path = await import('path');
                    const storagePath = path.default.join(context.workspacePath, '.coworkany', 'jarvis');
                    const taskManager = createProactiveTaskManager(storagePath);
                    taskManager.updateTask(task.id, {
                        relatedCalendarEvent: event.id,
                    });
                }
            }

            return {
                success: true,
                event: formatEventForDisplay(event),
                message: `Event "${event.title}" created for ${new Date(event.startTime).toLocaleString()}`,
                task: task,
                time_adjusted: finalStartTime !== args.start_time,
            };
        } catch (error) {
            return {
                success: false,
                error: String(error),
                message: 'Failed to create calendar event.',
            };
        }
    },
};

/**
 * calendar_update_event - Update an existing calendar event
 */
export const calendarUpdateEventTool: ToolDefinition = {
    name: 'calendar_update_event',
    description: 'Update an existing calendar event (reschedule, change details, add attendees).',
    effects: ['network:outbound', 'state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            event_id: { type: 'string', description: 'Event ID to update' },
            title: { type: 'string', description: 'New title' },
            start_time: { type: 'string', description: 'New start time (ISO 8601)' },
            end_time: { type: 'string', description: 'New end time (ISO 8601)' },
            location: { type: 'string', description: 'New location' },
            attendees: {
                type: 'array',
                items: { type: 'string' },
                description: 'Updated attendee list',
            },
        },
        required: ['event_id'],
    },
    handler: async (args: any, context: ToolContext) => {
        try {
            const manager = getCalendarManager(context.workspacePath);

            // Check if calendar is configured
            if (!manager.isConfigured()) {
                return {
                    success: false,
                    error: 'Calendar not configured',
                    message: 'Calendar integration requires Google API credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
                };
            }

            const updates: any = {};
            if (args.title) updates.title = args.title;
            if (args.start_time) updates.startTime = args.start_time;
            if (args.end_time) updates.endTime = args.end_time;
            if (args.location) updates.location = args.location;
            if (args.attendees) updates.attendees = args.attendees;

            const event = await manager.updateEvent(args.event_id, updates);

            return {
                success: true,
                event: formatEventForDisplay(event),
                message: `Event "${event.title}" updated successfully.`,
            };
        } catch (error) {
            return {
                success: false,
                error: String(error),
                message: `Failed to update event ${args.event_id}.`,
            };
        }
    },
};

/**
 * calendar_find_free_time - Find available time slots
 */
export const calendarFindFreeTimeTool: ToolDefinition = {
    name: 'calendar_find_free_time',
    description: 'Find available time slots in calendar. Useful for scheduling meetings and finding focus time blocks.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            duration_minutes: { type: 'number', description: 'Meeting duration in minutes' },
            time_range: {
                type: 'string',
                enum: ['today', 'tomorrow', 'this_week', 'next_week'],
                description: 'Search range (default: this_week)',
            },
            working_hours_only: {
                type: 'boolean',
                description: 'Only suggest slots during working hours (9am-6pm, default: true)',
            },
            max_results: {
                type: 'number',
                description: 'Maximum number of free slots to return (default: 5)',
            },
        },
        required: ['duration_minutes'],
    },
    handler: async (args: any, context: ToolContext) => {
        try {
            const manager = getCalendarManager(context.workspacePath);

            // Check if calendar is configured
            if (!manager.isConfigured()) {
                return {
                    success: false,
                    error: 'Calendar not configured',
                    message: 'Calendar integration requires Google API credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
                };
            }

            const { timeMin, timeMax } = calculateTimeRange(args.time_range || 'this_week');

            const freeSlots = await manager.findFreeSlots({
                durationMinutes: args.duration_minutes,
                timeMin,
                timeMax,
                workingHoursOnly: args.working_hours_only !== false,
            });

            const maxResults = args.max_results || 5;
            const limitedSlots = freeSlots.slice(0, maxResults);

            return {
                success: true,
                duration_minutes: args.duration_minutes,
                count: limitedSlots.length,
                free_slots: limitedSlots.map(slot => ({
                    start: slot.start,
                    end: slot.end,
                    start_display: new Date(slot.start).toLocaleString(),
                    end_display: new Date(slot.end).toLocaleString(),
                    duration_minutes: args.duration_minutes,
                })),
            };
        } catch (error) {
            return {
                success: false,
                error: String(error),
                message: 'Failed to find free time slots.',
            };
        }
    },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate time range based on preset or custom times
 */
function calculateTimeRange(
    timeRange: string,
    customStart?: string,
    customEnd?: string
): { timeMin: string; timeMax: string } {
    const now = new Date();

    if (timeRange === 'custom') {
        if (!customStart || !customEnd) {
            throw new Error('Custom time range requires start_time and end_time');
        }
        return {
            timeMin: customStart,
            timeMax: customEnd,
        };
    }

    const ranges: Record<string, { timeMin: Date; timeMax: Date }> = {
        today: {
            timeMin: new Date(now.setHours(0, 0, 0, 0)),
            timeMax: new Date(now.setHours(23, 59, 59, 999)),
        },
        tomorrow: {
            timeMin: new Date(now.setDate(now.getDate() + 1)),
            timeMax: new Date(now.setHours(23, 59, 59, 999)),
        },
        this_week: {
            timeMin: now,
            timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        next_week: {
            timeMin: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            timeMax: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
    };

    const range = ranges[timeRange];
    if (!range) {
        throw new Error(`Invalid time range: ${timeRange}`);
    }

    return {
        timeMin: range.timeMin.toISOString(),
        timeMax: range.timeMax.toISOString(),
    };
}

/**
 * Format calendar event for display
 */
function formatEventForDisplay(event: any) {
    return {
        id: event.id,
        title: event.title,
        start_time: event.startTime,
        end_time: event.endTime,
        start_display: new Date(event.startTime).toLocaleString(),
        end_display: new Date(event.endTime).toLocaleString(),
        location: event.location,
        attendees: event.attendees,
        status: event.status,
    };
}

/**
 * Detect scheduling conflicts between events
 */
function detectConflicts(events: any[]): Array<{ event1: any; event2: any }> {
    const conflicts = [];

    for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
            if (eventsOverlap(events[i], events[j])) {
                conflicts.push({
                    event1: events[i],
                    event2: events[j],
                });
            }
        }
    }

    return conflicts;
}

/**
 * Check if two events overlap in time
 */
function eventsOverlap(event1: any, event2: any): boolean {
    const start1 = new Date(event1.startTime).getTime();
    const end1 = new Date(event1.endTime).getTime();
    const start2 = new Date(event2.startTime).getTime();
    const end2 = new Date(event2.endTime).getTime();

    return start1 < end2 && start2 < end1;
}
