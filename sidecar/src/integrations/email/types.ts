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
export interface EmailProvider {
    name: 'gmail' | 'outlook' | 'mock';
    isConfigured(): boolean;
    initialize(config: EmailProviderConfig): Promise<void>;
    authenticate(): Promise<AuthResult>;
    refreshToken(): Promise<void>;
    disconnect(): Promise<void>;
    getMessages(options: GetMessagesOptions): Promise<Email[]>;
    getMessage(messageId: string): Promise<Email>;
    getThread(threadId: string): Promise<EmailThread>;
    sendEmail(email: EmailInput): Promise<Email>;
    replyToEmail(messageId: string, body: string, replyAll?: boolean): Promise<Email>;
    markAsRead(messageId: string, read: boolean): Promise<void>;
    starMessage(messageId: string, starred: boolean): Promise<void>;
    getMessagesSince(timestamp: string): Promise<Email[]>;
}
export interface EmailSummary {
    unreadCount: number;
    importantUnread: Email[];
    actionRequired: Email[];
    recentMessages: Email[];
    totalMessages: number;
}
