/**
 * Gmail Provider
 *
 * Integrates with Gmail API using OAuth 2.0 authentication.
 */

import { google } from 'googleapis';
import type {
    EmailProvider,
    EmailProviderConfig,
    AuthResult,
    GetMessagesOptions,
    Email,
    EmailInput,
    EmailThread,
} from './types';

export class GmailProvider implements EmailProvider {
    name: 'gmail' = 'gmail';
    private oauth2Client: any;
    private gmail: any;
    private config: EmailProviderConfig | null = null;

    isConfigured(): boolean {
        return this.config !== null && this.oauth2Client !== undefined;
    }

    async initialize(config: EmailProviderConfig): Promise<void> {
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

        this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    }

    async authenticate(): Promise<AuthResult> {
        if (!this.oauth2Client) {
            throw new Error('OAuth client not initialized');
        }

        const authUrl = this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/gmail.send',
                'https://www.googleapis.com/auth/gmail.modify',
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

    async getMessages(options: GetMessagesOptions): Promise<Email[]> {
        if (!this.gmail) {
            throw new Error('Gmail API not initialized');
        }

        // Build Gmail query string
        const query = this.buildGmailQuery(options);

        // List message IDs
        const listResponse = await this.gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: options.maxResults || 100,
            labelIds: ['INBOX'],
        });

        if (!listResponse.data.messages) {
            return [];
        }

        // Batch fetch full messages
        const messages = await Promise.all(
            listResponse.data.messages.map((msg: any) =>
                this.gmail.users.messages.get({
                    userId: 'me',
                    id: msg.id,
                    format: 'full',
                })
            )
        );

        return messages.map(msg => this.mapGmailMessage(msg.data));
    }

    async getMessage(messageId: string): Promise<Email> {
        if (!this.gmail) {
            throw new Error('Gmail API not initialized');
        }

        const response = await this.gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
        });

        return this.mapGmailMessage(response.data);
    }

    async getThread(threadId: string): Promise<EmailThread> {
        if (!this.gmail) {
            throw new Error('Gmail API not initialized');
        }

        const response = await this.gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'full',
        });

        const messages = response.data.messages.map((msg: any) => this.mapGmailMessage(msg));
        const participants = new Set<string>();

        messages.forEach((m: any) => {
            participants.add(m.from);
            m.to.forEach((to: any) => participants.add(to));
        });

        return {
            id: threadId,
            subject: messages[0].subject,
            messages,
            messageCount: messages.length,
            participants: Array.from(participants),
            lastMessageTime: messages[messages.length - 1].timestamp,
        };
    }

    async sendEmail(email: EmailInput): Promise<Email> {
        if (!this.gmail) {
            throw new Error('Gmail API not initialized');
        }

        // Create RFC 2822 formatted email
        const message = this.createRFC2822Message(email);

        // Base64url encode the message
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const response = await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });

        // Fetch the sent message details
        return await this.getMessage(response.data.id);
    }

    async replyToEmail(messageId: string, body: string, replyAll?: boolean): Promise<Email> {
        if (!this.gmail) {
            throw new Error('Gmail API not initialized');
        }

        // Get the original message
        const original = await this.getMessage(messageId);

        // Build reply
        const replyEmail: EmailInput = {
            to: [original.from],
            cc: replyAll ? (original.cc || []) : [],
            subject: original.subject.startsWith('Re: ')
                ? original.subject
                : `Re: ${original.subject}`,
            body,
        };

        // Create RFC 2822 formatted reply with threading headers
        const message = this.createRFC2822Message(replyEmail, {
            threadId: original.threadId,
            inReplyTo: original.id,
        });

        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const response = await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
                threadId: original.threadId,
            },
        });

        return await this.getMessage(response.data.id);
    }

    async markAsRead(messageId: string, read: boolean): Promise<void> {
        if (!this.gmail) {
            throw new Error('Gmail API not initialized');
        }

        if (read) {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    removeLabelIds: ['UNREAD'],
                },
            });
        } else {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    addLabelIds: ['UNREAD'],
                },
            });
        }
    }

    async starMessage(messageId: string, starred: boolean): Promise<void> {
        if (!this.gmail) {
            throw new Error('Gmail API not initialized');
        }

        if (starred) {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    addLabelIds: ['STARRED'],
                },
            });
        } else {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    removeLabelIds: ['STARRED'],
                },
            });
        }
    }

    async getMessagesSince(timestamp: string): Promise<Email[]> {
        const date = new Date(timestamp).toISOString().split('T')[0].replace(/-/g, '/');
        return this.getMessages({
            query: `after:${date}`,
        });
    }

    /**
     * Build Gmail query string from options
     */
    private buildGmailQuery(options: GetMessagesOptions): string {
        const parts: string[] = [];

        if (options.unreadOnly) {
            parts.push('is:unread');
        }

        if (options.important) {
            parts.push('is:important');
        }

        if (options.query) {
            parts.push(options.query);
        }

        if (options.since) {
            const date = new Date(options.since).toISOString().split('T')[0].replace(/-/g, '/');
            parts.push(`after:${date}`);
        }

        return parts.join(' ');
    }

    /**
     * Map Gmail message format to Email format
     */
    private mapGmailMessage(msg: any): Email {
        const headers = msg.payload.headers;
        const getHeader = (name: string) => {
            const header = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
            return header?.value || '';
        };

        // Extract body
        let body = '';
        if (msg.payload.body.data) {
            body = Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
        } else if (msg.payload.parts) {
            // Multi-part message, find text/plain part
            const textPart = msg.payload.parts.find((p: any) => p.mimeType === 'text/plain');
            if (textPart && textPart.body.data) {
                body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
            }
        }

        // Parse recipients
        const parseRecipients = (header: string): string[] => {
            if (!header) return [];
            return header.split(',').map(e => e.trim());
        };

        return {
            id: msg.id,
            threadId: msg.threadId,
            from: getHeader('From'),
            to: parseRecipients(getHeader('To')),
            cc: parseRecipients(getHeader('Cc')),
            subject: getHeader('Subject') || '(No subject)',
            body,
            timestamp: new Date(parseInt(msg.internalDate)).toISOString(),
            read: !msg.labelIds?.includes('UNREAD'),
            starred: msg.labelIds?.includes('STARRED'),
            important: msg.labelIds?.includes('IMPORTANT'),
            labels: msg.labelIds || [],
        };
    }

    /**
     * Create RFC 2822 formatted email message
     */
    private createRFC2822Message(
        email: EmailInput,
        threadingHeaders?: { threadId: string; inReplyTo: string }
    ): string {
        const lines: string[] = [];

        lines.push(`To: ${email.to.join(', ')}`);
        if (email.cc && email.cc.length > 0) {
            lines.push(`Cc: ${email.cc.join(', ')}`);
        }
        if (email.bcc && email.bcc.length > 0) {
            lines.push(`Bcc: ${email.bcc.join(', ')}`);
        }
        lines.push(`Subject: ${email.subject}`);

        if (threadingHeaders) {
            lines.push(`In-Reply-To: <${threadingHeaders.inReplyTo}>`);
            lines.push(`References: <${threadingHeaders.inReplyTo}>`);
        }

        lines.push('Content-Type: text/plain; charset="UTF-8"');
        lines.push('MIME-Version: 1.0');
        lines.push('');
        lines.push(email.body);

        return lines.join('\r\n');
    }
}
