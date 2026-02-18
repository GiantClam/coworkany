/**
 * Intent Analyzer
 *
 * Analyzes user messages to determine intent and extract relevant context
 */

import type { Intent, IntentType, IntentContext } from './types';

/**
 * Keywords for each intent type
 */
const INTENT_KEYWORDS: Record<IntentType, string[]> = {
    // Programming Intents
    bug_fix: [
        'fix', 'bug', 'issue', 'problem', 'broken', 'not working',
        'error', 'crash', 'fail', 'incorrect', 'wrong'
    ],
    feature_add: [
        'add', 'create', 'new', 'feature', 'implement', 'build',
        'make', 'develop', 'introduce'
    ],
    refactor: [
        'refactor', 'clean', 'improve', 'reorganize', 'restructure',
        'simplify', 'optimize code', 'rewrite'
    ],
    test: [
        'test', 'testing', 'spec', 'coverage', 'unit test', 'integration test',
        'e2e', 'tdd', 'jest', 'pytest', 'cargo test'
    ],
    deploy: [
        'deploy', 'deployment', 'production', 'release', 'publish',
        'ship', 'launch', 'rollout'
    ],
    design: [
        'design', 'ui', 'ux', 'interface', 'layout', 'mockup',
        'wireframe', 'prototype', 'brainstorm', 'plan'
    ],
    debug: [
        'debug', 'debugging', 'troubleshoot', 'diagnose', 'investigate',
        'trace', 'breakpoint'
    ],
    review: [
        'review', 'code review', 'pr review', 'pull request',
        'feedback', 'comment on'
    ],
    documentation: [
        'document', 'docs', 'readme', 'comment', 'explain',
        'api docs', 'docstring'
    ],
    performance: [
        'performance', 'optimize', 'speed up', 'slow', 'faster',
        'bottleneck', 'profiling', 'benchmark'
    ],
    security: [
        'security', 'vulnerability', 'secure', 'auth', 'authentication',
        'authorization', 'xss', 'sql injection', 'csrf'
    ],
    setup: [
        'setup', 'install', 'configure', 'initialize', 'init',
        'bootstrap', 'scaffold'
    ],
    git: [
        'git', 'commit', 'push', 'pull', 'merge', 'branch',
        'rebase', 'cherry-pick', 'stash'
    ],
    shell: [
        'run', 'execute', 'command', 'shell', 'bash', 'script',
        'npm', 'cargo', 'python'
    ],
    explore: [
        'show', 'list', 'find', 'search', 'explore', 'what is',
        'how does', 'where is', 'explain code'
    ],
    // Universal Assistant Intents
    personal_management: [
        'calendar', 'schedule', 'meeting', 'appointment', 'event',
        'task', 'todo', 'reminder', 'due date', 'deadline',
        'check my calendar', 'what\'s on my schedule', 'free time',
        'create task', 'mark as done', 'set reminder'
    ],
    information_lookup: [
        'weather', 'temperature', 'forecast', 'news', 'headline',
        'what\'s the weather', 'check weather', 'latest news',
        'search for', 'look up', 'find information', 'tell me about',
        'get news', 'current events'
    ],
    research: [
        'research', 'investigate topic', 'deep dive', 'learn about',
        'gather information', 'study', 'analyze', 'compare',
        'summarize', 'find sources', 'compile information'
    ],
    automation: [
        'automate', 'browser', 'web automation', 'fill form',
        'click button', 'navigate to', 'post to', 'publish',
        'social media', 'tweet', 'facebook post', 'workflow'
    ],
    knowledge_management: [
        'save note', 'remember', 'take note', 'write down',
        'store', 'vault', 'knowledge base', 'organize',
        'categorize', 'tag', 'search notes', 'recall'
    ],
    communication: [
        'email', 'send email', 'reply', 'draft', 'compose',
        'check email', 'inbox', 'message', 'slack',
        'notification', 'alert', 'communicate'
    ],
    planning: [
        'plan my day', 'daily routine', 'morning routine',
        'prepare for meeting', 'meeting prep', 'agenda',
        'weekly plan', 'organize my week', 'schedule work',
        'time block', 'prioritize'
    ],
    unknown: []
};

/**
 * Intent Analyzer
 */
export class IntentAnalyzer {
    /**
     * Analyze user message to determine intent
     */
    analyze(context: IntentContext): Intent {
        const message = context.currentMessage.toLowerCase();

        // Extract keywords and entities
        const keywords = this.extractKeywords(message);
        const entities = this.extractEntities(message, context);

        // Detect context
        const hasCode = this.hasCodeBlock(context.currentMessage);
        const hasError = this.hasErrorReference(message, context);
        const hasFile = this.hasFileReference(message);
        const recentErrors = context.recentErrors.length > 0;

        // Score each intent type
        const scores = this.scoreIntents(message, keywords, {
            hasCode,
            hasError,
            hasFile,
            recentErrors
        });

        // Get top intent
        const topIntent = this.getTopIntent(scores);

        return {
            type: topIntent.type,
            confidence: topIntent.score,
            keywords,
            entities,
            context: {
                hasCode,
                hasError,
                hasFile,
                recentErrors
            }
        };
    }

    /**
     * Extract keywords from message
     */
    private extractKeywords(message: string): string[] {
        const words = message.toLowerCase()
            .split(/\s+/)
            .map(w => w.replace(/[^a-z0-9-]/g, ''))
            .filter(w => w.length > 2);

        return [...new Set(words)];
    }

    /**
     * Extract entities (file names, function names, etc.)
     */
    private extractEntities(message: string, context: IntentContext): string[] {
        const entities: string[] = [];

        // File paths (e.g., src/main.ts)
        const filePaths = message.match(/[\w-]+\/[\w-/.]+\.\w+/g) || [];
        entities.push(...filePaths);

        // File names (e.g., main.ts)
        const fileNames = message.match(/[\w-]+\.(ts|js|tsx|jsx|rs|py|md|json|yaml|toml)/gi) || [];
        entities.push(...fileNames);

        // Function names (camelCase or snake_case)
        const functionNames = message.match(/\b[a-z_][a-zA-Z0-9_]*\(/g) || [];
        entities.push(...functionNames.map(f => f.slice(0, -1)));

        return [...new Set(entities)];
    }

    /**
     * Check if message contains code block
     */
    private hasCodeBlock(message: string): boolean {
        return message.includes('```') ||
            message.includes('`') ||
            /[{}\[\]();]/.test(message);
    }

    /**
     * Check if message references an error
     */
    private hasErrorReference(message: string, context: IntentContext): boolean {
        const errorKeywords = ['error', 'exception', 'fail', 'crash', 'broken'];
        const hasKeyword = errorKeywords.some(k => message.includes(k));
        const hasRecentError = context.recentErrors.length > 0;

        return hasKeyword || hasRecentError;
    }

    /**
     * Check if message references a file
     */
    private hasFileReference(message: string): boolean {
        return /\w+\.(ts|js|tsx|jsx|rs|py|md|json|yaml|toml)/i.test(message) ||
            /src\/|lib\/|test\/|app\//i.test(message);
    }

    /**
     * Score each intent type based on keyword matching
     */
    private scoreIntents(
        message: string,
        keywords: string[],
        context: { hasCode: boolean; hasError: boolean; hasFile: boolean; recentErrors: boolean }
    ): Map<IntentType, number> {
        const scores = new Map<IntentType, number>();

        // Score based on keyword matching
        for (const [intentType, intentKeywords] of Object.entries(INTENT_KEYWORDS)) {
            if (intentType === 'unknown') continue;

            let score = 0;

            // Check if any intent keywords appear in the message
            for (const keyword of intentKeywords) {
                if (message.includes(keyword)) {
                    score += 1;

                    // Boost for exact phrase match
                    if (keyword.includes(' ') && message.includes(keyword)) {
                        score += 0.5;
                    }
                }
            }

            // Normalize by keyword count
            score = score / Math.max(intentKeywords.length, 1);

            scores.set(intentType as IntentType, score);
        }

        // Apply context-based adjustments
        this.applyContextBoosts(scores, context);

        return scores;
    }

    /**
     * Apply context-based score adjustments
     */
    private applyContextBoosts(
        scores: Map<IntentType, number>,
        context: { hasCode: boolean; hasError: boolean; hasFile: boolean; recentErrors: boolean }
    ): void {
        // Boost bug_fix if error is mentioned
        if (context.hasError || context.recentErrors) {
            scores.set('bug_fix', (scores.get('bug_fix') || 0) + 0.3);
            scores.set('debug', (scores.get('debug') || 0) + 0.2);
        }

        // Boost refactor if code is present
        if (context.hasCode) {
            scores.set('refactor', (scores.get('refactor') || 0) + 0.1);
        }

        // Boost test if testing tools are mentioned
        if (context.hasFile) {
            scores.set('explore', (scores.get('explore') || 0) + 0.1);
        }
    }

    /**
     * Get the top-scoring intent
     */
    private getTopIntent(scores: Map<IntentType, number>): { type: IntentType; score: number } {
        let topType: IntentType = 'unknown';
        let topScore = 0;

        for (const [type, score] of scores.entries()) {
            if (score > topScore) {
                topScore = score;
                topType = type;
            }
        }

        // If no clear intent, return unknown
        if (topScore < 0.1) {
            return { type: 'unknown', score: 0 };
        }

        return { type: topType, score: Math.min(topScore, 1.0) };
    }
}

/**
 * Singleton instance
 */
let analyzer: IntentAnalyzer | null = null;

export function getIntentAnalyzer(): IntentAnalyzer {
    if (!analyzer) {
        analyzer = new IntentAnalyzer();
    }
    return analyzer;
}
