/**
 * Skill Recommender
 *
 * Recommends skills based on analyzed intent and context
 */

import type {
    Intent,
    IntentType,
    IntentContext,
    SkillRecommendation,
    SkillMetadata
} from './types';

/**
 * Skill metadata database
 * Maps skills to their triggers and intents
 */
const SKILL_DATABASE: SkillMetadata[] = [
    // Debugging & Problem Solving
    {
        name: 'systematic-debugging',
        triggers: ['debug', 'error', 'bug', 'issue', 'broken', 'failing'],
        intents: ['bug_fix', 'debug'],
        description: 'Systematic approach to debugging issues',
        priority: 10
    },
    {
        name: 'verification-before-completion',
        triggers: ['verify', 'check', 'validate', 'ensure'],
        intents: ['bug_fix', 'test'],
        description: 'Verify work before marking complete',
        priority: 8
    },

    // Development Workflows
    {
        name: 'test-driven-development',
        triggers: ['test', 'tdd', 'unit test', 'testing', 'spec'],
        intents: ['test', 'feature_add'],
        description: 'Test-driven development workflow',
        priority: 9
    },
    {
        name: 'brainstorming',
        triggers: ['design', 'plan', 'brainstorm', 'architecture', 'approach'],
        intents: ['design', 'feature_add'],
        description: 'Brainstorm ideas and designs',
        priority: 10
    },
    {
        name: 'planning-with-files',
        triggers: ['plan', 'roadmap', 'strategy', 'outline'],
        intents: ['design', 'feature_add', 'refactor'],
        description: 'Create detailed plans with file organization',
        priority: 7
    },
    {
        name: 'writing-plans',
        triggers: ['write plan', 'create plan', 'plan document'],
        intents: ['design'],
        description: 'Write detailed implementation plans',
        priority: 6
    },
    {
        name: 'executing-plans',
        triggers: ['execute', 'implement', 'follow plan'],
        intents: ['feature_add', 'refactor'],
        description: 'Execute implementation plans',
        priority: 7
    },

    // Code Quality
    {
        name: 'code-simplifier',
        triggers: ['simplify', 'clean', 'readable', 'maintainable'],
        intents: ['refactor'],
        description: 'Simplify and clean up code',
        priority: 6
    },
    {
        name: 'security-guidance',
        triggers: ['security', 'secure', 'vulnerability', 'auth'],
        intents: ['security'],
        description: 'Security best practices and guidance',
        priority: 9
    },

    // Git & Version Control
    {
        name: 'finishing-a-development-branch',
        triggers: ['finish', 'complete', 'done', 'merge', 'pr'],
        intents: ['git', 'review'],
        description: 'Complete and merge development branch',
        priority: 7
    },
    {
        name: 'requesting-code-review',
        triggers: ['request review', 'pr review', 'code review'],
        intents: ['review'],
        description: 'Request code review',
        priority: 8
    },
    {
        name: 'receiving-code-review',
        triggers: ['address review', 'review feedback', 'review comments'],
        intents: ['review', 'refactor'],
        description: 'Address code review feedback',
        priority: 8
    },
    {
        name: 'using-git-worktrees',
        triggers: ['worktree', 'parallel work', 'multiple branches'],
        intents: ['git'],
        description: 'Use git worktrees for parallel work',
        priority: 5
    },

    // Frontend Development
    {
        name: 'frontend-design',
        triggers: ['ui', 'frontend', 'component', 'react', 'interface'],
        intents: ['design', 'feature_add'],
        description: 'Frontend design and component development',
        priority: 8
    },
    {
        name: 'pencil-interface-design',
        triggers: ['mockup', 'wireframe', 'design'],
        intents: ['design'],
        description: 'Create UI mockups and wireframes',
        priority: 6
    },

    // Tool Development
    {
        name: 'mcp-builder',
        triggers: ['mcp', 'server', 'tool', 'integration'],
        intents: ['setup', 'feature_add'],
        description: 'Build MCP servers and tools',
        priority: 7
    },
    {
        name: 'skill-creator',
        triggers: ['skill', 'create skill', 'new skill'],
        intents: ['feature_add', 'setup'],
        description: 'Create new skills',
        priority: 6
    },

    // Shell & Execution
    {
        name: 'shell-execution',
        triggers: ['run', 'execute', 'command', 'shell', 'script'],
        intents: ['shell'],
        description: 'Execute shell commands',
        priority: 9
    },

    // Document Processing
    {
        name: 'pdf',
        triggers: ['pdf', 'document'],
        intents: ['feature_add'],
        description: 'PDF processing',
        priority: 5
    },
    {
        name: 'docx',
        triggers: ['docx', 'word', 'document'],
        intents: ['feature_add'],
        description: 'Word document processing',
        priority: 5
    },
    {
        name: 'pptx',
        triggers: ['pptx', 'powerpoint', 'presentation'],
        intents: ['feature_add'],
        description: 'PowerPoint processing',
        priority: 5
    },
    {
        name: 'xlsx',
        triggers: ['xlsx', 'excel', 'spreadsheet'],
        intents: ['feature_add'],
        description: 'Excel spreadsheet processing',
        priority: 5
    },

    // Advanced Workflows
    {
        name: 'subagent-driven-development',
        triggers: ['complex', 'large', 'multi-step', 'subagent'],
        intents: ['feature_add', 'refactor'],
        description: 'Use subagents for complex tasks',
        priority: 6
    },
    {
        name: 'dispatching-parallel-agents',
        triggers: ['parallel', 'concurrent', 'multiple'],
        intents: ['feature_add'],
        description: 'Dispatch parallel agents',
        priority: 5
    },

    // Universal Assistant Skills
    {
        name: 'daily-assistant',
        triggers: ['morning routine', 'daily plan', 'start my day', 'what\'s today', 'my schedule'],
        intents: ['personal_management', 'planning', 'information_lookup'],
        description: 'Complete morning routine: calendar, email, news, weather, tasks',
        priority: 9
    },
    {
        name: 'research-assistant',
        triggers: ['research', 'learn about', 'deep dive', 'gather information', 'study'],
        intents: ['research', 'knowledge_management'],
        description: 'Deep research with web search, synthesis, and vault storage',
        priority: 8
    },
    {
        name: 'meeting-prep',
        triggers: ['prepare meeting', 'meeting prep', 'next meeting', 'meeting notes'],
        intents: ['planning', 'personal_management', 'knowledge_management'],
        description: 'Prepare for meetings: find context, create notes, set agenda',
        priority: 9
    },
    {
        name: 'email-automation',
        triggers: ['check email', 'read email', 'important email', 'inbox', 'reply email'],
        intents: ['communication', 'personal_management'],
        description: 'Automated email management: read, filter, summarize, reply',
        priority: 8
    },
    {
        name: 'web-automation',
        triggers: ['post to', 'fill form', 'browser', 'automate web', 'social media'],
        intents: ['automation', 'communication'],
        description: 'Browser automation for posting, forms, and web tasks',
        priority: 7
    },
    {
        name: 'knowledge-keeper',
        triggers: ['save note', 'remember', 'take note', 'store', 'organize notes'],
        intents: ['knowledge_management'],
        description: 'Save and organize knowledge: notes, learnings, references',
        priority: 7
    },
    {
        name: 'travel-planner',
        triggers: ['plan trip', 'travel', 'vacation', 'itinerary', 'book flight'],
        intents: ['planning', 'research'],
        description: 'Plan travel: research destinations, create itinerary, book flights',
        priority: 6
    },
    {
        name: 'weather-briefing',
        triggers: ['weather', 'forecast', 'temperature', 'rain', 'what\'s the weather'],
        intents: ['information_lookup'],
        description: 'Get weather forecasts and briefings',
        priority: 8
    }
];

/**
 * Skill Recommender
 */
export class SkillRecommender {
    /**
     * Recommend skills based on intent
     */
    recommend(intent: Intent, context: IntentContext): SkillRecommendation[] {
        const recommendations: SkillRecommendation[] = [];

        // Skip if already using a skill for this intent
        const hasRelevantSkill = context.activeSkills.some(skill =>
            this.isSkillRelevantForIntent(skill, intent.type)
        );

        if (hasRelevantSkill && intent.confidence < 0.95) {
            return []; // Don't recommend if already using relevant skill
        }

        // Score each skill
        for (const skill of SKILL_DATABASE) {
            const score = this.scoreSkill(skill, intent, context);

            if (score > 0.3) { // Only recommend if score is above threshold
                const recommendation: SkillRecommendation = {
                    skillName: skill.name,
                    confidence: score,
                    reason: this.generateReason(skill, intent, score),
                    autoLoad: score >= 0.9 && !context.activeSkills.includes(skill.name),
                    priority: skill.priority
                };

                recommendations.push(recommendation);
            }
        }

        // Sort by confidence * priority
        recommendations.sort((a, b) => {
            const scoreA = a.confidence * a.priority;
            const scoreB = b.confidence * b.priority;
            return scoreB - scoreA;
        });

        // Return top 3 recommendations
        return recommendations.slice(0, 3);
    }

    /**
     * Score a skill for the given intent
     */
    private scoreSkill(skill: SkillMetadata, intent: Intent, context: IntentContext): number {
        let score = 0;

        // 1. Intent match (40% weight)
        if (skill.intents.includes(intent.type)) {
            score += 0.4 * intent.confidence;
        }

        // 2. Keyword/trigger match (30% weight)
        const triggerScore = this.calculateTriggerScore(skill.triggers, intent.keywords, context.currentMessage);
        score += 0.3 * triggerScore;

        // 3. Context boost (30% weight)
        const contextScore = this.calculateContextScore(skill, intent, context);
        score += 0.3 * contextScore;

        return Math.min(score, 1.0);
    }

    /**
     * Calculate trigger keyword match score
     */
    private calculateTriggerScore(triggers: string[], keywords: string[], message: string): number {
        const messageLower = message.toLowerCase();
        let matches = 0;

        for (const trigger of triggers) {
            // Exact phrase match
            if (messageLower.includes(trigger.toLowerCase())) {
                matches += 2;
                continue;
            }

            // Keyword match
            const triggerWords = trigger.toLowerCase().split(' ');
            if (triggerWords.every(word => keywords.includes(word))) {
                matches += 1;
            }
        }

        return Math.min(matches / Math.max(triggers.length, 1), 1.0);
    }

    /**
     * Calculate context-based score
     */
    private calculateContextScore(skill: SkillMetadata, intent: Intent, context: IntentContext): number {
        let score = 0;

        // Boost for error context
        if (intent.context.hasError || intent.context.recentErrors) {
            if (skill.name === 'systematic-debugging') score += 0.5;
            if (skill.name === 'verification-before-completion') score += 0.3;
        }

        // Boost for design context
        if (intent.context.hasCode && intent.type === 'design') {
            if (skill.name === 'brainstorming') score += 0.4;
            if (skill.name === 'planning-with-files') score += 0.3;
        }

        // Boost for test context
        if (intent.keywords.some(k => ['test', 'spec', 'coverage'].includes(k))) {
            if (skill.name === 'test-driven-development') score += 0.5;
        }

        // Boost for refactor context
        if (intent.type === 'refactor' && intent.context.hasCode) {
            if (skill.name === 'code-simplifier') score += 0.3;
        }

        return Math.min(score, 1.0);
    }

    /**
     * Check if a skill is relevant for an intent
     */
    private isSkillRelevantForIntent(skillName: string, intentType: IntentType): boolean {
        const skill = SKILL_DATABASE.find(s => s.name === skillName);
        if (!skill) return false;

        return skill.intents.includes(intentType);
    }

    /**
     * Generate human-readable reason for recommendation
     */
    private generateReason(skill: SkillMetadata, intent: Intent, score: number): string {
        const intentTypeText = intent.type.replace('_', ' ');

        if (score >= 0.9) {
            return `Strong match for ${intentTypeText} task`;
        } else if (score >= 0.7) {
            return `Good match for ${intentTypeText} task`;
        } else if (score >= 0.5) {
            return `May help with ${intentTypeText} task`;
        } else {
            return `Could be useful for ${intentTypeText}`;
        }
    }

    /**
     * Get skill metadata by name
     */
    getSkillMetadata(skillName: string): SkillMetadata | undefined {
        return SKILL_DATABASE.find(s => s.name === skillName);
    }

    /**
     * Get all available skills
     */
    getAllSkills(): SkillMetadata[] {
        return [...SKILL_DATABASE];
    }
}

/**
 * Singleton instance
 */
let recommender: SkillRecommender | null = null;

export function getSkillRecommender(): SkillRecommender {
    if (!recommender) {
        recommender = new SkillRecommender();
    }
    return recommender;
}
