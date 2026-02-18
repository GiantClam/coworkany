/**
 * Session Memory Store
 * Persistent storage for session context and learnings
 *
 * Based on everything-claude-code memory persistence:
 * - Save session state on end
 * - Load previous session context on start
 * - Extract and store learned patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface SessionMemory {
    sessionId: string;
    workspacePath: string;
    startedAt: string;
    endedAt?: string;
    messages: SessionMessage[];
    learnings: string[];
    patterns: SessionPattern[];
    metadata: {
        title?: string;
        taskCount: number;
        errorCount: number;
        successCount: number;
    };
}

export interface SessionMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    toolCalls?: string[];
}

export interface SessionPattern {
    pattern: string;
    description: string;
    confidence: number; // 0-1
    occurrences: number;
    firstSeen: string;
    lastSeen: string;
}

export class SessionMemoryStore {
    private memoryDir: string;
    private currentSession: SessionMemory | null = null;

    constructor(workspacePath: string) {
        this.memoryDir = path.join(workspacePath, '.coworkany', 'memory', 'sessions');
        this.ensureMemoryDir();
    }

    /**
     * Ensure memory directory exists
     */
    private ensureMemoryDir(): void {
        if (!fs.existsSync(this.memoryDir)) {
            fs.mkdirSync(this.memoryDir, { recursive: true });
        }
    }

    /**
     * Start a new session
     */
    startSession(title?: string): string {
        const sessionId = randomUUID();

        this.currentSession = {
            sessionId,
            workspacePath: path.dirname(path.dirname(path.dirname(this.memoryDir))),
            startedAt: new Date().toISOString(),
            messages: [],
            learnings: [],
            patterns: [],
            metadata: {
                title,
                taskCount: 0,
                errorCount: 0,
                successCount: 0,
            },
        };

        console.error(`[SessionMemory] Started session: ${sessionId}`);
        return sessionId;
    }

    /**
     * Add a message to current session
     */
    addMessage(role: 'user' | 'assistant' | 'system', content: string, toolCalls?: string[]): void {
        if (!this.currentSession) {
            console.error('[SessionMemory] No active session');
            return;
        }

        this.currentSession.messages.push({
            role,
            content,
            timestamp: new Date().toISOString(),
            toolCalls,
        });
    }

    /**
     * Add a learning to current session
     */
    addLearning(learning: string): void {
        if (!this.currentSession) {
            console.error('[SessionMemory] No active session');
            return;
        }

        if (!this.currentSession.learnings.includes(learning)) {
            this.currentSession.learnings.push(learning);
        }
    }

    /**
     * Extract patterns from session messages
     */
    private extractPatterns(): SessionPattern[] {
        if (!this.currentSession) return [];

        const patterns: Map<string, SessionPattern> = new Map();
        const now = new Date().toISOString();

        // Simple keyword extraction from user messages
        const userMessages = this.currentSession.messages.filter(m => m.role === 'user');

        for (const msg of userMessages) {
            const keywords = this.extractKeywords(msg.content);

            for (const keyword of keywords) {
                const existing = patterns.get(keyword);
                if (existing) {
                    existing.occurrences++;
                    existing.lastSeen = msg.timestamp;
                    existing.confidence = Math.min(1, existing.confidence + 0.1);
                } else {
                    patterns.set(keyword, {
                        pattern: keyword,
                        description: `User frequently mentions: ${keyword}`,
                        confidence: 0.3,
                        occurrences: 1,
                        firstSeen: msg.timestamp,
                        lastSeen: msg.timestamp,
                    });
                }
            }
        }

        // Filter patterns with confidence > 0.5
        return Array.from(patterns.values()).filter(p => p.confidence > 0.5);
    }

    /**
     * Extract keywords from text
     */
    private extractKeywords(text: string): string[] {
        // Simple keyword extraction
        const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);

        const words = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3 && !commonWords.has(w));

        // Count frequency
        const frequency: Map<string, number> = new Map();
        for (const word of words) {
            frequency.set(word, (frequency.get(word) || 0) + 1);
        }

        // Return words that appear more than once
        return Array.from(frequency.entries())
            .filter(([_, count]) => count > 1)
            .map(([word]) => word);
    }

    /**
     * End current session and save to disk
     */
    endSession(): void {
        if (!this.currentSession) {
            console.error('[SessionMemory] No active session to end');
            return;
        }

        this.currentSession.endedAt = new Date().toISOString();
        this.currentSession.patterns = this.extractPatterns();

        // Save to disk
        const fileName = `${this.currentSession.sessionId}.json`;
        const filePath = path.join(this.memoryDir, fileName);

        try {
            fs.writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2));
            console.error(`[SessionMemory] Saved session: ${this.currentSession.sessionId}`);
        } catch (error) {
            console.error('[SessionMemory] Failed to save session:', error);
        }

        this.currentSession = null;
    }

    /**
     * Load the most recent session
     */
    loadLastSession(): SessionMemory | null {
        try {
            const files = fs.readdirSync(this.memoryDir).filter(f => f.endsWith('.json'));

            if (files.length === 0) {
                return null;
            }

            // Sort by modification time (most recent first)
            const sorted = files
                .map(f => ({
                    name: f,
                    path: path.join(this.memoryDir, f),
                    mtime: fs.statSync(path.join(this.memoryDir, f)).mtime,
                }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            const latestFile = sorted[0].path;
            const content = fs.readFileSync(latestFile, 'utf-8');
            const session = JSON.parse(content) as SessionMemory;

            console.error(`[SessionMemory] Loaded last session: ${session.sessionId}`);
            return session;
        } catch (error) {
            console.error('[SessionMemory] Failed to load last session:', error);
            return null;
        }
    }

    /**
     * Get session context summary for AI prompt
     */
    getContextSummary(lastSession: SessionMemory | null): string {
        if (!lastSession) {
            return '';
        }

        const parts: string[] = [];

        // Add learnings
        if (lastSession.learnings.length > 0) {
            parts.push('## Previous Session Learnings\n');
            lastSession.learnings.forEach(l => parts.push(`- ${l}`));
            parts.push('');
        }

        // Add patterns
        if (lastSession.patterns.length > 0) {
            parts.push('## Recognized Patterns\n');
            lastSession.patterns
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 5)
                .forEach(p => parts.push(`- ${p.description} (confidence: ${(p.confidence * 100).toFixed(0)}%)`));
            parts.push('');
        }

        // Add recent context
        const recentMessages = lastSession.messages.slice(-5);
        if (recentMessages.length > 0) {
            parts.push('## Recent Context\n');
            recentMessages.forEach(m => {
                const role = m.role === 'user' ? 'User' : 'Assistant';
                const preview = m.content.slice(0, 100) + (m.content.length > 100 ? '...' : '');
                parts.push(`- ${role}: ${preview}`);
            });
        }

        return parts.join('\n');
    }

    /**
     * Clean up old sessions (keep last N)
     */
    cleanupOldSessions(keepLast = 10): void {
        try {
            const files = fs.readdirSync(this.memoryDir).filter(f => f.endsWith('.json'));

            if (files.length <= keepLast) {
                return;
            }

            // Sort by modification time
            const sorted = files
                .map(f => ({
                    name: f,
                    path: path.join(this.memoryDir, f),
                    mtime: fs.statSync(path.join(this.memoryDir, f)).mtime,
                }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            // Delete old files
            const toDelete = sorted.slice(keepLast);
            toDelete.forEach(file => {
                fs.unlinkSync(file.path);
                console.error(`[SessionMemory] Deleted old session: ${file.name}`);
            });
        } catch (error) {
            console.error('[SessionMemory] Failed to cleanup old sessions:', error);
        }
    }
}
