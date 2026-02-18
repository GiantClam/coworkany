/**
 * CoworkAny - Calendar Integration Types
 *
 * Type definitions for calendar provider interface and related types
 */

import type { CalendarEvent, CalendarSummary } from '../../agent/jarvis/types';

// ============================================================================
// Provider Configuration
// ============================================================================

export interface CalendarProviderConfig {
    provider: 'google' | 'outlook' | 'mock';
    credentials: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    };
    tokens?: {
        accessToken: string;
        refreshToken: string;
        expiresAt: string;
    };
    enabledCalendars?: string[]; // Calendar IDs to sync
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface CalendarProvider {
    name: 'google' | 'outlook' | 'mock';

    // Connection management
    isConfigured(): boolean;
    initialize(config: CalendarProviderConfig): Promise<void>;
    authenticate(): Promise<AuthResult>;
    refreshToken(): Promise<void>;
    disconnect(): Promise<void>;

    // Calendar operations
    listCalendars(): Promise<Calendar[]>;
    getEvents(options: GetEventsOptions): Promise<CalendarEvent[]>;
    createEvent(event: CalendarEventInput): Promise<CalendarEvent>;
    updateEvent(eventId: string, updates: Partial<CalendarEventInput>): Promise<CalendarEvent>;
    deleteEvent(eventId: string): Promise<void>;

    // Sync operations
    getEventsSince(timestamp: string): Promise<CalendarEvent[]>;
    watchCalendar?(calendarId: string): Promise<WatchResponse>;
}

// ============================================================================
// Operation Options
// ============================================================================

export interface GetEventsOptions {
    calendarIds?: string[];
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    query?: string;
}

export interface CalendarEventInput {
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    location?: string;
    attendees?: string[];
    reminders?: number[]; // Minutes before event
}

// ============================================================================
// Authentication
// ============================================================================

export interface AuthResult {
    authUrl?: string;
    requiresUserAction: boolean;
    accountId?: string;
    error?: string;
}

export interface TokenResult {
    accessToken: string;
    refreshToken?: string;
    expiresAt: string;
}

// ============================================================================
// Calendar Entity
// ============================================================================

export interface Calendar {
    id: string;
    name: string;
    description?: string;
    primary: boolean;
    timeZone?: string;
    backgroundColor?: string;
}

// ============================================================================
// Watch/Webhook
// ============================================================================

export interface WatchResponse {
    id: string;
    resourceId: string;
    resourceUri: string;
    expiration: string;
}

// ============================================================================
// Service Configuration
// ============================================================================

export interface CalendarServiceConfig {
    cacheConfig: {
        ttl: number; // Time to live in milliseconds
        maxSize: number; // Maximum number of cached items
        diskCachePath?: string; // Path for disk cache
    };
}

// ============================================================================
// Cache Data
// ============================================================================

export interface CachedData<T = any> {
    data: T;
    timestamp: number;
}

export interface CachedCalendarData {
    events: CalendarEvent[];
    timestamp: number;
}

// ============================================================================
// Account Management
// ============================================================================

export interface CalendarAccount {
    id: string;
    provider: 'google' | 'outlook' | 'mock';
    email: string;
    displayName: string;
    connected: boolean;
    lastSync?: string;
    enabledCalendars: string[];
}

// Re-export from jarvis types for convenience
export type { CalendarEvent, CalendarSummary };
