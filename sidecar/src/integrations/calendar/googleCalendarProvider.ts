/**
 * Google Calendar Provider
 *
 * Integrates with Google Calendar API v3 using OAuth 2.0 authentication.
 */

import { google } from 'googleapis';
import type {
    CalendarProvider,
    CalendarProviderConfig,
    AuthResult,
    Calendar,
    GetEventsOptions,
    CalendarEvent,
    CalendarEventInput,
} from './types';

export class GoogleCalendarProvider implements CalendarProvider {
    name: 'google' = 'google';
    private oauth2Client: any;
    private calendar: any;
    private config: CalendarProviderConfig | null = null;

    isConfigured(): boolean {
        return this.config !== null && this.oauth2Client !== undefined;
    }

    async initialize(config: CalendarProviderConfig): Promise<void> {
        this.config = config;

        this.oauth2Client = new google.auth.OAuth2(
            config.credentials.clientId,
            config.credentials.clientSecret,
            config.credentials.redirectUri
        );

        if (config.tokens) {
            this.oauth2Client.setCredentials({
                access_token: config.tokens.accessToken,
                refresh_token: config.tokens.refreshToken,
            });
        }

        this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    }

    async authenticate(): Promise<AuthResult> {
        if (!this.oauth2Client) {
            throw new Error('OAuth client not initialized');
        }

        const authUrl = this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/calendar.readonly',
                'https://www.googleapis.com/auth/calendar.events',
            ],
            prompt: 'consent', // Force consent to get refresh token
        });

        return {
            authUrl,
            requiresUserAction: true,
        };
    }

    async refreshToken(): Promise<void> {
        if (!this.oauth2Client) {
            throw new Error('OAuth client not initialized');
        }

        const { credentials } = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(credentials);
    }

    async disconnect(): Promise<void> {
        if (this.oauth2Client) {
            this.oauth2Client.revokeCredentials();
        }
    }

    async listCalendars(): Promise<Calendar[]> {
        if (!this.calendar) {
            throw new Error('Calendar API not initialized');
        }

        const response = await this.calendar.calendarList.list();

        return response.data.items.map((cal: any) => ({
            id: cal.id,
            name: cal.summary,
            description: cal.description,
            primary: cal.primary || false,
            timeZone: cal.timeZone,
            backgroundColor: cal.backgroundColor,
        }));
    }

    async getEvents(options: GetEventsOptions): Promise<CalendarEvent[]> {
        if (!this.calendar) {
            throw new Error('Calendar API not initialized');
        }

        const calendarIds = options.calendarIds || ['primary'];
        const allEvents: CalendarEvent[] = [];

        for (const calendarId of calendarIds) {
            try {
                const response = await this.calendar.events.list({
                    calendarId,
                    timeMin: options.timeMin || new Date().toISOString(),
                    timeMax: options.timeMax,
                    maxResults: options.maxResults || 250,
                    singleEvents: true,
                    orderBy: 'startTime',
                    q: options.query,
                });

                const events = this.mapGoogleEvents(response.data.items || []);
                allEvents.push(...events);
            } catch (error) {
                console.warn(`[GoogleCalendar] Failed to fetch events from ${calendarId}:`, error);
            }
        }

        return allEvents;
    }

    async createEvent(event: CalendarEventInput): Promise<CalendarEvent> {
        if (!this.calendar) {
            throw new Error('Calendar API not initialized');
        }

        const googleEvent: any = {
            summary: event.title,
            description: event.description,
            start: {
                dateTime: event.startTime,
                timeZone: 'America/Los_Angeles',
            },
            end: {
                dateTime: event.endTime,
                timeZone: 'America/Los_Angeles',
            },
            location: event.location,
            attendees: event.attendees?.map(email => ({ email })),
            reminders: {
                useDefault: false,
                overrides: event.reminders?.map(minutes => ({
                    method: 'popup',
                    minutes,
                })) || [{ method: 'popup', minutes: 10 }],
            },
        };

        const response = await this.calendar.events.insert({
            calendarId: 'primary',
            resource: googleEvent,
            sendUpdates: 'all', // Send invites to attendees
        });

        return this.mapGoogleEvent(response.data);
    }

    async updateEvent(eventId: string, updates: Partial<CalendarEventInput>): Promise<CalendarEvent> {
        if (!this.calendar) {
            throw new Error('Calendar API not initialized');
        }

        // First get the existing event
        const existing = await this.calendar.events.get({
            calendarId: 'primary',
            eventId,
        });

        // Apply updates
        const updated: any = { ...existing.data };

        if (updates.title) updated.summary = updates.title;
        if (updates.description) updated.description = updates.description;
        if (updates.startTime) {
            updated.start = {
                dateTime: updates.startTime,
                timeZone: updated.start.timeZone,
            };
        }
        if (updates.endTime) {
            updated.end = {
                dateTime: updates.endTime,
                timeZone: updated.end.timeZone,
            };
        }
        if (updates.location) updated.location = updates.location;
        if (updates.attendees) {
            updated.attendees = updates.attendees.map(email => ({ email }));
        }

        const response = await this.calendar.events.update({
            calendarId: 'primary',
            eventId,
            resource: updated,
            sendUpdates: 'all',
        });

        return this.mapGoogleEvent(response.data);
    }

    async deleteEvent(eventId: string): Promise<void> {
        if (!this.calendar) {
            throw new Error('Calendar API not initialized');
        }

        await this.calendar.events.delete({
            calendarId: 'primary',
            eventId,
            sendUpdates: 'all',
        });
    }

    async getEventsSince(timestamp: string): Promise<CalendarEvent[]> {
        return this.getEvents({
            timeMin: timestamp,
        });
    }

    /**
     * Map Google Calendar event format to our CalendarEvent format
     */
    private mapGoogleEvent(item: any): CalendarEvent {
        return {
            id: item.id,
            title: item.summary || '(No title)',
            description: item.description,
            startTime: item.start.dateTime || item.start.date,
            endTime: item.end.dateTime || item.end.date,
            location: item.location,
            attendees: item.attendees?.map((a: any) => a.email) || [],
            reminders: item.reminders?.overrides?.map((r: any) => r.minutes) || [],
            status: item.status === 'confirmed' ? 'confirmed' : 'tentative',
        };
    }

    /**
     * Map multiple Google Calendar events
     */
    private mapGoogleEvents(items: any[]): CalendarEvent[] {
        return items.map(item => this.mapGoogleEvent(item));
    }
}
