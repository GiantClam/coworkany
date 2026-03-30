/**
 * CoworkAny - Jarvis System Types
 *
 * 贾维斯级个人助理的核心类型定义
 */

// ============================================================================
// Voice Interface Types
// ============================================================================

export interface VoiceConfig {
    enabled: boolean;
    wakeWord: string;
    language: string;
    voice: string;  // TTS voice
    speechRate: number;
    volume: number;
}

export interface SpeechRecognitionResult {
    text: string;
    confidence: number;
    isFinal: boolean;
    alternatives?: Array<{ text: string; confidence: number }>;
}

// ============================================================================
// NLU (Natural Language Understanding) Types
// ============================================================================

export type IntentType =
    | 'task_create'
    | 'task_query'
    | 'task_update'
    | 'reminder_set'
    | 'calendar_check'
    | 'email_check'
    | 'learn_new'
    | 'execute_command'
    | 'question_answer'
    | 'chitchat';

export interface Intent {
    type: IntentType;
    confidence: number;
    entities: Entity[];
    slots: Record<string, any>;
}

export interface Entity {
    type: string;  // 'date', 'time', 'person', 'task', 'priority' etc.
    value: string;
    raw: string;
    confidence: number;
    position: [number, number];  // start, end indices
}

export interface Context {
    conversationHistory: Message[];
    currentTask?: string;
    currentFocus?: string;
    referencedEntities: Map<string, any>;  // "that file" -> actual file
    userPreferences: Record<string, any>;
}

export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    metadata?: Record<string, any>;
}

// ============================================================================
// Multimodal Output Types
// ============================================================================

export type OutputMode = 'text' | 'voice' | 'visual' | 'mixed';

export interface MultimodalResponse {
    mode: OutputMode;
    text?: string;
    speech?: {
        text: string;
        audioUrl?: string;
    };
    visual?: VisualElement[];
    actions?: Action[];
}

export interface VisualElement {
    type: 'chart' | 'table' | 'image' | 'card' | 'list';
    data: any;
    title?: string;
    description?: string;
}

export interface Action {
    id: string;
    label: string;
    command: string;
    icon?: string;
    destructive?: boolean;
}

// ============================================================================
// Calendar Integration Types
// ============================================================================

export interface CalendarEvent {
    id: string;
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    location?: string;
    attendees?: string[];
    reminders?: number[];  // minutes before
    recurring?: RecurrenceRule;
    status: 'confirmed' | 'tentative' | 'cancelled';
}

export interface RecurrenceRule {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number;
    count?: number;
    until?: string;
}

export interface CalendarSummary {
    today: CalendarEvent[];
    thisWeek: CalendarEvent[];
    upcoming: CalendarEvent[];
    conflicts: Array<{
        event1: CalendarEvent;
        event2: CalendarEvent;
    }>;
}

// ============================================================================
// Email Integration Types
// ============================================================================

export interface Email {
    id: string;
    from: string;
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    htmlBody?: string;
    timestamp: string;
    read: boolean;
    important: boolean;
    labels: string[];
    attachments?: EmailAttachment[];
}

export interface EmailAttachment {
    name: string;
    mimeType: string;
    size: number;
    url?: string;
}

export interface EmailSummary {
    unreadCount: number;
    importantUnread: Email[];
    recentImportant: Email[];
    actionRequired: Email[];  // emails mentioning deadlines, requests
}

// ============================================================================
// Contextual Awareness Types
// ============================================================================

export interface EnvironmentContext {
    currentTime: Date;
    location?: {
        city: string;
        country: string;
        timezone: string;
    };
    userActivity: 'working' | 'meeting' | 'break' | 'commuting' | 'offline';
    activeApplication?: string;
    recentFiles?: string[];
    systemStats: {
        cpuUsage: number;
        memoryUsage: number;
        diskUsage: number;
    };
}

export interface UserPreferences {
    workingHours: { start: string; end: string };
    preferredLanguage: string;
    notificationPreferences: {
        email: boolean;
        voice: boolean;
        visual: boolean;
    };
    privacySettings: {
        shareLocation: boolean;
        shareActivity: boolean;
        learnFromBehavior: boolean;
    };
}

// ============================================================================
// Proactive Behavior Types
// ============================================================================

export interface ProactiveSuggestion {
    id: string;
    type: 'reminder' | 'suggestion' | 'warning' | 'info';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    title: string;
    message: string;
    reasoning: string[];
    timestamp: string;
    expiresAt?: string;
    actions?: Action[];
    dismissed: boolean;
}

export interface UserHabit {
    pattern: string;  // e.g., "checks email at 9am"
    frequency: number;  // times per day/week
    lastOccurrence: string;
    confidence: number;
}
