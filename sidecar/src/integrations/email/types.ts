/**
 * Email Integration Types
 *
 * Type definitions for email provider abstraction layer.
 */

// ============================================================================
// Core Email Types
// ============================================================================

export interface Email {
    id: string;
    threadId: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    bodyHtml?: string;
    timestamp: string;
    read: boolean;
    starred?: boolean;
    important?: boolean;
    labels?: string[];
    attachments?: EmailAttachment[];
}

export interface EmailAttachment {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
}

export interface EmailThread {
    id: string;
    subject: string;
    messages: Email[];
    messageCount: number;
    participants: string[];
    lastMessageTime: string;
}

export interface EmailInput {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    bodyHtml?: string;
    attachments?: { path: string; filename?: string }[];
}

// ============================================================================
// Provider Configuration
// ============================================================================

export interface EmailProviderConfig {
    provider: 'gmail' | 'outlook' | 'mock';
    credentials: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    };
    tokens?: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: string;
    };
}

export interface AuthResult {
    authUrl?: string;
    requiresUserAction: boolean;
}

// ============================================================================
// Query Options
// ============================================================================

export interface GetMessagesOptions {
    maxResults?: number;
    since?: string;
    query?: string;
    unreadOnly?: boolean;
    important?: boolean;
    labelIds?: string[];
}

export interface SendEmailOptions extends EmailInput {
    threadId?: string; // For replies
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface EmailProvider {
    name: 'gmail' | 'outlook' | 'mock';

    /**
     * Check if provider is configured and ready
     */
    isConfigured(): boolean;

    /**
     * Initialize provider with configuration
     */
    initialize(config: EmailProviderConfig): Promise<void>;

    /**
     * Start OAuth authentication flow
     */
    authenticate(): Promise<AuthResult>;

    /**
     * Refresh access token
     */
    refreshToken(): Promise<void>;

    /**
     * Disconnect and revoke tokens
     */
    disconnect(): Promise<void>;

    /**
     * Get messages matching criteria
     */
    getMessages(options: GetMessagesOptions): Promise<Email[]>;

    /**
     * Get a specific email by ID
     */
    getMessage(messageId: string): Promise<Email>;

    /**
     * Get email thread
     */
    getThread(threadId: string): Promise<EmailThread>;

    /**
     * Send a new email
     */
    sendEmail(email: EmailInput): Promise<Email>;

    /**
     * Reply to an email
     */
    replyToEmail(messageId: string, body: string, replyAll?: boolean): Promise<Email>;

    /**
     * Mark message as read/unread
     */
    markAsRead(messageId: string, read: boolean): Promise<void>;

    /**
     * Star/unstar message
     */
    starMessage(messageId: string, starred: boolean): Promise<void>;

    /**
     * Get messages since timestamp
     */
    getMessagesSince(timestamp: string): Promise<Email[]>;
}

// ============================================================================
// Email Summary
// ============================================================================

export interface EmailSummary {
    unreadCount: number;
    importantUnread: Email[];
    actionRequired: Email[];
    recentMessages: Email[];
    totalMessages: number;
}
