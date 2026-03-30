import type {
    CalendarProvider,
    CalendarProviderConfig,
    GetEventsOptions,
    CalendarEvent,
    CalendarEventInput,
} from './types';
interface CachedData<T> {
    data: T;
    timestamp: number;
}
interface FreeSlot {
    start: string;
    end: string;
}
interface FindFreeSlotsOptions {
    durationMinutes: number;
    timeMin: string;
    timeMax: string;
    workingHoursOnly?: boolean;
}
export class CalendarManager {
    private provider: CalendarProvider | null = null;
    private cache: Map<string, CachedData<any>> = new Map();
    private cacheTTL: number = 5 * 60 * 1000; // 5 minutes
    async initialize(config: CalendarProviderConfig): Promise<void> {
        if (!config.credentials.clientId || !config.credentials.clientSecret) {
            throw new Error(
                'Calendar integration requires Google API credentials. ' +
                'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables. ' +
                'Visit https://console.cloud.google.com to create OAuth 2.0 credentials.'
            );
        }
        const { GoogleCalendarProvider } = await import('./googleCalendarProvider');
        this.provider = new GoogleCalendarProvider();
        await this.provider.initialize(config);
    }
    async getEvents(options: GetEventsOptions): Promise<CalendarEvent[]> {
        if (!this.provider) {
            throw new Error('Calendar provider not initialized');
        }
        const cacheKey = `events:${JSON.stringify(options)}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.data;
        }
        const events = await this.provider.getEvents(options);
        this.cache.set(cacheKey, {
            data: events,
            timestamp: Date.now(),
        });
        return events;
    }
    async createEvent(event: CalendarEventInput): Promise<CalendarEvent> {
        if (!this.provider) {
            throw new Error('Calendar provider not initialized');
        }
        const created = await this.provider.createEvent(event);
        this.cache.clear();
        return created;
    }
    async updateEvent(eventId: string, updates: Partial<CalendarEventInput>): Promise<CalendarEvent> {
        if (!this.provider) {
            throw new Error('Calendar provider not initialized');
        }
        const updated = await this.provider.updateEvent(eventId, updates);
        this.cache.clear();
        return updated;
    }
    async deleteEvent(eventId: string): Promise<void> {
        if (!this.provider) {
            throw new Error('Calendar provider not initialized');
        }
        await this.provider.deleteEvent(eventId);
        this.cache.clear();
    }
    async findFreeSlots(options: FindFreeSlotsOptions): Promise<FreeSlot[]> {
        if (!this.provider) {
            throw new Error('Calendar provider not initialized');
        }
        const events = await this.getEvents({
            timeMin: options.timeMin,
            timeMax: options.timeMax,
        });
        const sortedEvents = events.sort((a, b) =>
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );
        const freeSlots: FreeSlot[] = [];
        const durationMs = options.durationMinutes * 60 * 1000;
        let currentTime = new Date(options.timeMin);
        const endTime = new Date(options.timeMax);
        for (const event of sortedEvents) {
            const eventStart = new Date(event.startTime);
            const eventEnd = new Date(event.endTime);
            if (currentTime < eventStart) {
                const gapDuration = eventStart.getTime() - currentTime.getTime();
                if (gapDuration >= durationMs) {
                    const slotEnd = new Date(currentTime.getTime() + durationMs);
                    if (this.isInWorkingHours(currentTime, slotEnd, options.workingHoursOnly)) {
                        freeSlots.push({
                            start: currentTime.toISOString(),
                            end: slotEnd.toISOString(),
                        });
                    }
                }
            }
            if (eventEnd > currentTime) {
                currentTime = eventEnd;
            }
        }
        if (currentTime < endTime) {
            const remaining = endTime.getTime() - currentTime.getTime();
            if (remaining >= durationMs) {
                const slotEnd = new Date(currentTime.getTime() + durationMs);
                if (this.isInWorkingHours(currentTime, slotEnd, options.workingHoursOnly)) {
                    freeSlots.push({
                        start: currentTime.toISOString(),
                        end: slotEnd.toISOString(),
                    });
                }
            }
        }
        return freeSlots;
    }
    async findFreeTime(options: FindFreeSlotsOptions): Promise<FreeSlot | null> {
        const slots = await this.findFreeSlots(options);
        return slots.length > 0 ? slots[0] : null;
    }
    private isInWorkingHours(start: Date, end: Date, workingHoursOnly?: boolean): boolean {
        if (!workingHoursOnly) {
            return true;
        }
        const workStart = 9;
        const workEnd = 18;
        const startHour = start.getHours();
        const endHour = end.getHours();
        return startHour >= workStart && endHour <= workEnd;
    }
    isConfigured(): boolean {
        return this.provider !== null && this.provider.isConfigured();
    }
    getProviderName(): string {
        return this.provider?.name || 'none';
    }
}
const managers = new Map<string, CalendarManager>();
export function getCalendarManager(workspacePath: string): CalendarManager {
    if (!managers.has(workspacePath)) {
        const manager = new CalendarManager();
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (clientId && clientSecret) {
            manager.initialize({
                provider: 'google',
                credentials: {
                    clientId,
                    clientSecret,
                    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
                },
            }).catch(err => {
                console.warn('[CalendarManager] Failed to initialize Google Calendar:', err.message);
            });
        }
        managers.set(workspacePath, manager);
    }
    return managers.get(workspacePath)!;
}
