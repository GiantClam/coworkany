/**
 * Email Manager
 *
 * Provider abstraction layer for email operations.
 * Handles caching, provider initialization, and common email operations.
 */

import type {
    EmailProvider,
    EmailProviderConfig,
    GetMessagesOptions,
    Email,
    EmailInput,
    EmailThread,
    EmailSummary,
} from './types';

interface CachedData<T> {
    data: T;
    timestamp: number;
}

export class EmailManager {
    private provider: EmailProvider | null = null;
    private cache: Map<string, CachedData<any>> = new Map();
    private cacheTTL: number = 2 * 60 * 1000; // 2 minutes (emails change more frequently)

    /**
     * Initialize email manager with a provider
     */
    async initialize(config: EmailProviderConfig): Promise<void> {
        // Validate credentials
        if (!config.credentials.clientId || !config.credentials.clientSecret) {
            throw new Error(
                'Email integration requires Google API credentials. ' +
                'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables. ' +
                'Visit https://console.cloud.google.com to create OAuth 2.0 credentials.'
            );
        }

        // Load Gmail provider
        const { GmailProvider } = await import('./gmailProvider');
        this.provider = new GmailProvider();

        await this.provider.initialize(config);
    }

    /**
     * Get messages with caching
     */
    async getMessages(options: GetMessagesOptions): Promise<Email[]> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }

        // Generate cache key
        const cacheKey = `messages:${JSON.stringify(options)}`;

        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.data;
        }

        // Fetch from provider
        const messages = await this.provider.getMessages(options);

        // Update cache
        this.cache.set(cacheKey, {
            data: messages,
            timestamp: Date.now(),
        });

        return messages;
    }

    /**
     * Get a specific message
     */
    async getMessage(messageId: string): Promise<Email> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }

        return await this.provider.getMessage(messageId);
    }

    /**
     * Get email thread
     */
    async getThread(threadId: string): Promise<EmailThread> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }

        return await this.provider.getThread(threadId);
    }

    /**
     * Send a new email
     */
    async sendEmail(email: EmailInput): Promise<Email> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }

        const sent = await this.provider.sendEmail(email);

        // Invalidate cache
        this.cache.clear();

        return sent;
    }

    /**
     * Reply to an email
     */
    async replyToEmail(messageId: string, body: string, replyAll?: boolean): Promise<Email> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }

        const reply = await this.provider.replyToEmail(messageId, body, replyAll);

        // Invalidate cache
        this.cache.clear();

        return reply;
    }

    /**
     * Mark message as read/unread
     */
    async markAsRead(messageId: string, read: boolean): Promise<void> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }

        await this.provider.markAsRead(messageId, read);

        // Invalidate cache
        this.cache.clear();
    }

    /**
     * Star/unstar message
     */
    async starMessage(messageId: string, starred: boolean): Promise<void> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }

        await this.provider.starMessage(messageId, starred);

        // Invalidate cache
        this.cache.clear();
    }

    /**
     * Filter important emails using heuristics
     */
    filterImportant(emails: Email[]): Email[] {
        return emails
            .filter(email => {
                if (email.important) return true;
                if (email.starred) return true;
                if (this.isVIPSender(email.from)) return true;
                if (this.containsUrgentKeywords(email.subject)) return true;
                return false;
            })
            .sort((a, b) =>
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
    }

    /**
     * Filter emails that require action
     */
    filterActionRequired(emails: Email[]): Email[] {
        const actionKeywords = [
            'urgent', 'asap', 'deadline', 'due', 'action required',
            'please respond', 'need your', 'waiting for',
            'review', 'approve', 'sign', 'confirm', 'required',
            'immediate', 'priority', 'critical',
        ];

        return emails.filter(email => {
            const text = `${email.subject} ${email.body}`.toLowerCase();
            return actionKeywords.some(keyword => text.includes(keyword));
        });
    }

    /**
     * Get email summary
     */
    async getSummary(): Promise<EmailSummary> {
        const unread = await this.getMessages({ unreadOnly: true, maxResults: 100 });
        const important = this.filterImportant(unread);
        const actionRequired = this.filterActionRequired(unread);

        return {
            unreadCount: unread.length,
            importantUnread: important.slice(0, 5),
            actionRequired: actionRequired.slice(0, 5),
            recentMessages: unread.slice(0, 10),
            totalMessages: unread.length,
        };
    }

    /**
     * Check if sender is VIP
     */
    private isVIPSender(email: string): boolean {
        const vipDomains = ['company.com', 'important.org'];
        const domain = email.split('@')[1];
        return vipDomains.includes(domain);
    }

    /**
     * Check if subject contains urgent keywords
     */
    private containsUrgentKeywords(subject: string): boolean {
        const urgentKeywords = ['urgent', 'asap', 'important', 'critical', '🔴', '⚠️'];
        const subjectLower = subject.toLowerCase();
        return urgentKeywords.some(keyword => subjectLower.includes(keyword));
    }

    /**
     * Check if provider is configured
     */
    isConfigured(): boolean {
        return this.provider !== null && this.provider.isConfigured();
    }

    /**
     * Get provider name
     */
    getProviderName(): string {
        return this.provider?.name || 'none';
    }
}

// Singleton instance per workspace
const managers = new Map<string, EmailManager>();

/**
 * Get or create email manager for workspace
 */
export function getEmailManager(workspacePath: string): EmailManager {
    if (!managers.has(workspacePath)) {
        const manager = new EmailManager();

        // Auto-initialize only if credentials are provided
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

        if (clientId && clientSecret) {
            manager.initialize({
                provider: 'gmail',
                credentials: {
                    clientId,
                    clientSecret,
                    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
                },
            }).catch(err => {
                console.warn('[EmailManager] Failed to initialize Gmail:', err.message);
            });
        }

        managers.set(workspacePath, manager);
    }

    return managers.get(workspacePath)!;
}
