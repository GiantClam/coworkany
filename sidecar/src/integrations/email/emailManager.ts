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
    async initialize(config: EmailProviderConfig): Promise<void> {
        if (!config.credentials.clientId || !config.credentials.clientSecret) {
            throw new Error(
                'Email integration requires Google API credentials. ' +
                'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables. ' +
                'Visit https://console.cloud.google.com to create OAuth 2.0 credentials.'
            );
        }
        const { GmailProvider } = await import('./gmailProvider');
        this.provider = new GmailProvider();
        await this.provider.initialize(config);
    }
    async getMessages(options: GetMessagesOptions): Promise<Email[]> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }
        const cacheKey = `messages:${JSON.stringify(options)}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.data;
        }
        const messages = await this.provider.getMessages(options);
        this.cache.set(cacheKey, {
            data: messages,
            timestamp: Date.now(),
        });
        return messages;
    }
    async getMessage(messageId: string): Promise<Email> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }
        return await this.provider.getMessage(messageId);
    }
    async getThread(threadId: string): Promise<EmailThread> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }
        return await this.provider.getThread(threadId);
    }
    async sendEmail(email: EmailInput): Promise<Email> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }
        const sent = await this.provider.sendEmail(email);
        this.cache.clear();
        return sent;
    }
    async replyToEmail(messageId: string, body: string, replyAll?: boolean): Promise<Email> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }
        const reply = await this.provider.replyToEmail(messageId, body, replyAll);
        this.cache.clear();
        return reply;
    }
    async markAsRead(messageId: string, read: boolean): Promise<void> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }
        await this.provider.markAsRead(messageId, read);
        this.cache.clear();
    }
    async starMessage(messageId: string, starred: boolean): Promise<void> {
        if (!this.provider) {
            throw new Error('Email provider not initialized');
        }
        await this.provider.starMessage(messageId, starred);
        this.cache.clear();
    }
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
    private isVIPSender(email: string): boolean {
        const vipDomains = ['company.com', 'important.org'];
        const domain = email.split('@')[1];
        return vipDomains.includes(domain);
    }
    private containsUrgentKeywords(subject: string): boolean {
        const urgentKeywords = ['urgent', 'asap', 'important', 'critical', '🔴', '⚠️'];
        const subjectLower = subject.toLowerCase();
        return urgentKeywords.some(keyword => subjectLower.includes(keyword));
    }
    isConfigured(): boolean {
        return this.provider !== null && this.provider.isConfigured();
    }
    getProviderName(): string {
        return this.provider?.name || 'none';
    }
}
const managers = new Map<string, EmailManager>();
export function getEmailManager(workspacePath: string): EmailManager {
    if (!managers.has(workspacePath)) {
        const manager = new EmailManager();
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
