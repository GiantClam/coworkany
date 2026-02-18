/**
 * Skill Recommendation Types
 *
 * Types for intent analysis and skill recommendation system
 */

/**
 * Intent types categorizing user requests
 */
export type IntentType =
    // Programming Intents
    | 'bug_fix'           // Fixing bugs or errors
    | 'feature_add'       // Adding new features
    | 'refactor'          // Code refactoring or improvement
    | 'test'              // Writing or running tests
    | 'deploy'            // Deployment operations
    | 'design'            // UI/UX design or planning
    | 'debug'             // Debugging issues
    | 'review'            // Code review
    | 'documentation'     // Writing documentation
    | 'performance'       // Performance optimization
    | 'security'          // Security improvements
    | 'setup'             // Project setup or configuration
    | 'git'               // Git operations
    | 'shell'             // Shell command execution
    | 'explore'           // Code exploration
    // Universal Assistant Intents
    | 'personal_management'   // Calendar, tasks, reminders management
    | 'information_lookup'    // Weather, news, quick facts lookup
    | 'research'              // Deep research and information gathering
    | 'automation'            // Web automation, workflows, browser tasks
    | 'knowledge_management'  // Notes, vault, learning, knowledge organization
    | 'communication'         // Email, messaging, social media
    | 'planning'              // Daily planning, meeting prep, scheduling
    | 'unknown';              // Cannot determine intent

/**
 * Analyzed user intent
 */
export interface Intent {
    type: IntentType;
    confidence: number;      // 0-1, confidence in this classification
    keywords: string[];      // Extracted keywords that led to this classification
    entities: string[];      // Specific entities (file names, function names, etc.)
    context: {
        hasCode: boolean;    // Does the message contain code?
        hasError: boolean;   // Does the message reference an error?
        hasFile: boolean;    // Does the message reference a file?
        recentErrors: boolean; // Were there recent errors in the session?
    };
}

/**
 * Skill recommendation
 */
export interface SkillRecommendation {
    skillName: string;       // Name of the skill (matches skill directory name)
    confidence: number;      // 0-1, confidence this skill is appropriate
    reason: string;          // Human-readable explanation
    autoLoad: boolean;       // Whether to auto-load without asking (confidence > 0.9)
    priority: number;        // Priority for ordering (higher = more important)
}

/**
 * Intent analysis context
 */
export interface IntentContext {
    currentMessage: string;
    recentMessages: string[];    // Last 5 messages
    recentErrors: string[];      // Recent error messages
    activeSkills: string[];      // Currently loaded skills
    workspaceType?: string;      // 'react', 'rust', 'node', etc.
}

/**
 * Skill metadata for matching
 */
export interface SkillMetadata {
    name: string;
    triggers: string[];          // Trigger keywords
    intents: IntentType[];       // What intents this skill handles
    description: string;
    priority: number;            // Base priority (1-10)
}
