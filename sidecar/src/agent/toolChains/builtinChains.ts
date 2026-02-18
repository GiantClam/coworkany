/**
 * Built-in Tool Chains
 *
 * Predefined tool chains for common workflows
 */

import type { ToolChain } from './types';

/**
 * Fix bug and test workflow
 *
 * 1. Write fixed code
 * 2. Run tests
 * 3. Check code quality
 */
export const FIX_BUG_AND_TEST: ToolChain = {
    id: 'fix-bug-and-test',
    name: 'Fix Bug and Test',
    description: 'Fix a bug, run tests, and check code quality',
    tags: ['bug-fix', 'testing', 'quality'],
    variables: [
        {
            name: 'file_path',
            description: 'Path to the file to fix',
            required: true
        },
        {
            name: 'bug_description',
            description: 'Description of the bug',
            required: true
        }
    ],
    steps: [
        {
            id: 'write-fix',
            name: 'Write Bug Fix',
            tool: 'write_file',
            args: (ctx) => ({
                file_path: ctx.variables.file_path,
                content: ctx.variables.fixed_code || ''
            }),
            saveResult: 'write_result'
        },
        {
            id: 'run-tests',
            name: 'Run Tests',
            tool: 'run_command',
            args: { command: 'npm test' },
            onError: 'stop',
            saveResult: 'test_result'
        },
        {
            id: 'check-quality',
            name: 'Check Code Quality',
            tool: 'check_code_quality',
            args: (ctx) => ({
                file_path: ctx.variables.file_path
            }),
            onError: 'continue',
            saveResult: 'quality_result'
        }
    ]
};

/**
 * Create feature safely
 *
 * 1. Write new code
 * 2. Add tests
 * 3. Run tests
 * 4. Check quality
 * 5. Commit if all pass
 */
export const CREATE_FEATURE_SAFE: ToolChain = {
    id: 'create-feature-safe',
    name: 'Create Feature Safely',
    description: 'Create a new feature with tests and quality checks before committing',
    tags: ['feature', 'testing', 'quality', 'git'],
    variables: [
        {
            name: 'feature_file',
            description: 'Path to the feature file',
            required: true
        },
        {
            name: 'test_file',
            description: 'Path to the test file',
            required: true
        },
        {
            name: 'commit_message',
            description: 'Git commit message',
            required: false,
            default: 'Add new feature'
        }
    ],
    steps: [
        {
            id: 'write-feature',
            name: 'Write Feature Code',
            tool: 'write_file',
            args: (ctx) => ({
                file_path: ctx.variables.feature_file,
                content: ctx.variables.feature_code || ''
            }),
            saveResult: 'feature_written'
        },
        {
            id: 'write-tests',
            name: 'Write Tests',
            tool: 'write_file',
            args: (ctx) => ({
                file_path: ctx.variables.test_file,
                content: ctx.variables.test_code || ''
            }),
            saveResult: 'tests_written'
        },
        {
            id: 'run-tests',
            name: 'Run Tests',
            tool: 'run_command',
            args: { command: 'npm test' },
            onError: 'stop',
            saveResult: 'test_result'
        },
        {
            id: 'check-quality',
            name: 'Check Code Quality',
            tool: 'check_code_quality',
            args: (ctx) => ({
                file_path: ctx.variables.feature_file
            }),
            onError: 'continue',
            saveResult: 'quality_result',
            condition: (ctx) => {
                // Only check quality if tests passed
                const testResult = ctx.results.test_result as any;
                return testResult && testResult.success !== false;
            }
        },
        {
            id: 'git-commit',
            name: 'Commit Changes',
            tool: 'run_command',
            args: (ctx) => ({
                command: `git add ${ctx.variables.feature_file} ${ctx.variables.test_file} && git commit -m "${ctx.variables.commit_message}"`
            }),
            onError: 'continue',
            condition: (ctx) => {
                // Only commit if quality is good enough (>= 70)
                const qualityResult = ctx.results.quality_result as any;
                return qualityResult && qualityResult.score >= 70;
            }
        }
    ]
};

/**
 * Refactor safely
 *
 * 1. Analyze current code
 * 2. Backup current code
 * 3. Refactor
 * 4. Run tests
 * 5. Check quality improvement
 */
export const REFACTOR_SAFE: ToolChain = {
    id: 'refactor-safe',
    name: 'Refactor Safely',
    description: 'Refactor code with automatic quality checks and rollback on failure',
    tags: ['refactor', 'testing', 'quality'],
    variables: [
        {
            name: 'file_path',
            description: 'Path to the file to refactor',
            required: true
        }
    ],
    steps: [
        {
            id: 'analyze-before',
            name: 'Analyze Current Code',
            tool: 'check_code_quality',
            args: (ctx) => ({
                file_path: ctx.variables.file_path
            }),
            saveResult: 'quality_before'
        },
        {
            id: 'backup',
            name: 'Backup Current Code',
            tool: 'run_command',
            args: (ctx) => ({
                command: `cp ${ctx.variables.file_path} ${ctx.variables.file_path}.backup`
            }),
            saveResult: 'backup_result'
        },
        {
            id: 'refactor',
            name: 'Refactor Code',
            tool: 'write_file',
            args: (ctx) => ({
                file_path: ctx.variables.file_path,
                content: ctx.variables.refactored_code || ''
            }),
            saveResult: 'refactor_result'
        },
        {
            id: 'run-tests',
            name: 'Run Tests',
            tool: 'run_command',
            args: { command: 'npm test' },
            onError: 'stop',
            saveResult: 'test_result'
        },
        {
            id: 'analyze-after',
            name: 'Analyze Refactored Code',
            tool: 'check_code_quality',
            args: (ctx) => ({
                file_path: ctx.variables.file_path
            }),
            saveResult: 'quality_after',
            condition: (ctx) => {
                // Only if tests passed
                const testResult = ctx.results.test_result as any;
                return testResult && testResult.success !== false;
            }
        }
    ]
};

/**
 * Deploy safely
 *
 * 1. Run tests
 * 2. Build production
 * 3. Check quality
 * 4. Deploy
 */
export const DEPLOY_SAFE: ToolChain = {
    id: 'deploy-safe',
    name: 'Deploy Safely',
    description: 'Deploy after running tests, building, and checking quality',
    tags: ['deploy', 'testing', 'build', 'quality'],
    variables: [
        {
            name: 'deploy_command',
            description: 'Command to deploy',
            required: false,
            default: 'npm run deploy'
        }
    ],
    steps: [
        {
            id: 'run-tests',
            name: 'Run Tests',
            tool: 'run_command',
            args: { command: 'npm test' },
            onError: 'stop',
            saveResult: 'test_result'
        },
        {
            id: 'build',
            name: 'Build Production',
            tool: 'run_command',
            args: { command: 'npm run build' },
            onError: 'stop',
            saveResult: 'build_result',
            condition: (ctx) => {
                const testResult = ctx.results.test_result as any;
                return testResult && testResult.success !== false;
            }
        },
        {
            id: 'check-quality',
            name: 'Final Quality Check',
            tool: 'batch_check_quality',
            args: { paths: ['src/**/*.ts', 'src/**/*.tsx'] },
            onError: 'continue',
            saveResult: 'quality_result'
        },
        {
            id: 'deploy',
            name: 'Deploy',
            tool: 'run_command',
            args: (ctx) => ({
                command: ctx.variables.deploy_command as string
            }),
            onError: 'stop',
            condition: (ctx) => {
                const buildResult = ctx.results.build_result as any;
                return buildResult && buildResult.success !== false;
            }
        }
    ]
};

/**
 * Quick fix workflow
 *
 * 1. Fix code
 * 2. Run quick check
 */
export const QUICK_FIX: ToolChain = {
    id: 'quick-fix',
    name: 'Quick Fix',
    description: 'Quick bug fix with minimal checks (for urgent fixes)',
    tags: ['bug-fix', 'quick'],
    variables: [
        {
            name: 'file_path',
            description: 'Path to the file to fix',
            required: true
        }
    ],
    steps: [
        {
            id: 'write-fix',
            name: 'Write Quick Fix',
            tool: 'write_file',
            args: (ctx) => ({
                file_path: ctx.variables.file_path,
                content: ctx.variables.fixed_code || ''
            }),
            saveResult: 'write_result'
        },
        {
            id: 'quick-check',
            name: 'Quick Syntax Check',
            tool: 'run_command',
            args: (ctx) => ({
                command: `npx tsc --noEmit ${ctx.variables.file_path}`
            }),
            onError: 'continue',
            saveResult: 'check_result'
        }
    ]
};

/**
 * Morning Routine - Universal Assistant
 *
 * 1. Check calendar for today
 * 2. Check important emails
 * 3. Get latest news
 * 4. Check weather
 * 5. List priority tasks
 */
export const MORNING_ROUTINE: ToolChain = {
    id: 'morning-routine',
    name: 'Morning Routine',
    description: 'Complete morning briefing: calendar, email, news, weather, and tasks',
    tags: ['personal', 'daily', 'planning'],
    variables: [
        {
            name: 'location',
            description: 'Your location for weather (e.g., "Beijing")',
            required: false,
            default: 'Beijing'
        }
    ],
    steps: [
        {
            id: 'check-calendar',
            name: 'Check Today\'s Calendar',
            tool: 'calendar_check',
            args: { time_range: 'today' },
            onError: 'continue',
            saveResult: 'calendar_events'
        },
        {
            id: 'check-email',
            name: 'Check Important Emails',
            tool: 'email_check',
            args: { filter: 'important', max_results: 5 },
            onError: 'continue',
            saveResult: 'important_emails'
        },
        {
            id: 'get-news',
            name: 'Get Latest News',
            tool: 'get_news',
            args: { category: 'technology', max_results: 5 },
            onError: 'continue',
            saveResult: 'news'
        },
        {
            id: 'check-weather',
            name: 'Check Weather',
            tool: 'check_weather',
            args: (ctx) => ({
                location: ctx.variables.location,
                forecast_days: 1
            }),
            onError: 'continue',
            saveResult: 'weather'
        },
        {
            id: 'list-tasks',
            name: 'List Priority Tasks',
            tool: 'task_list',
            args: { priority: 'high', status: 'pending' },
            onError: 'continue',
            saveResult: 'tasks'
        }
    ]
};

/**
 * Research Topic - Universal Assistant
 *
 * 1. Search web for topic
 * 2. Crawl top results
 * 3. Synthesize information
 * 4. Save to vault
 */
export const RESEARCH_TOPIC: ToolChain = {
    id: 'research-topic',
    name: 'Research Topic',
    description: 'Deep research: web search, crawl, synthesize, and save to vault',
    tags: ['research', 'knowledge', 'learning'],
    variables: [
        {
            name: 'topic',
            description: 'Topic to research',
            required: true
        },
        {
            name: 'max_sources',
            description: 'Maximum number of sources to crawl',
            required: false,
            default: 5
        }
    ],
    steps: [
        {
            id: 'web-search',
            name: 'Search Web',
            tool: 'web_search',
            args: (ctx) => ({
                query: ctx.variables.topic,
                max_results: ctx.variables.max_sources || 5
            }),
            saveResult: 'search_results'
        },
        {
            id: 'crawl-sources',
            name: 'Crawl Top Sources',
            tool: 'web_crawl',
            args: (ctx) => {
                const results = ctx.results.search_results as any;
                const urls = results?.urls || [];
                return { urls: urls.slice(0, ctx.variables.max_sources as number) };
            },
            onError: 'continue',
            saveResult: 'crawled_content',
            condition: (ctx) => {
                const results = ctx.results.search_results as any;
                return results && results.urls && results.urls.length > 0;
            }
        },
        {
            id: 'synthesize',
            name: 'Synthesize Information',
            tool: 'synthesize_text',
            args: (ctx) => ({
                sources: ctx.results.crawled_content,
                query: ctx.variables.topic
            }),
            onError: 'continue',
            saveResult: 'synthesis'
        },
        {
            id: 'save-to-vault',
            name: 'Save to Vault',
            tool: 'quick_note',
            args: (ctx) => ({
                title: `Research: ${ctx.variables.topic}`,
                content: ctx.results.synthesis || 'No synthesis available',
                tags: ['research', 'web-search'],
                category: 'learnings'
            }),
            onError: 'continue',
            saveResult: 'vault_save'
        }
    ]
};

/**
 * Meeting Prep - Universal Assistant
 *
 * 1. Find next meeting
 * 2. Search for meeting context
 * 3. Create meeting notes
 * 4. Set reminders
 */
export const MEETING_PREP: ToolChain = {
    id: 'meeting-prep',
    name: 'Meeting Preparation',
    description: 'Prepare for meetings: find context, create notes, set agenda',
    tags: ['meeting', 'planning', 'productivity'],
    variables: [
        {
            name: 'meeting_id',
            description: 'Optional specific meeting ID (if not provided, uses next meeting)',
            required: false
        }
    ],
    steps: [
        {
            id: 'find-meeting',
            name: 'Find Next Meeting',
            tool: 'calendar_check',
            args: { time_range: 'today' },
            saveResult: 'calendar_events',
            condition: (ctx) => !ctx.variables.meeting_id
        },
        {
            id: 'search-context',
            name: 'Search Meeting Context',
            tool: 'vault_search',
            args: (ctx) => {
                const events = ctx.results.calendar_events as any;
                const meeting = events?.[0] || {};
                return {
                    query: meeting.title || ctx.variables.meeting_id || '',
                    max_results: 5
                };
            },
            onError: 'continue',
            saveResult: 'context_results'
        },
        {
            id: 'create-notes',
            name: 'Create Meeting Notes',
            tool: 'quick_note',
            args: (ctx) => {
                const events = ctx.results.calendar_events as any;
                const meeting = events?.[0] || {};
                const context = ctx.results.context_results as any;

                return {
                    title: `Meeting Notes: ${meeting.title || 'Untitled Meeting'}`,
                    content: `# ${meeting.title || 'Meeting Notes'}\n\n**Date**: ${meeting.start_time || 'TBD'}\n**Attendees**: ${meeting.attendees?.join(', ') || 'N/A'}\n\n## Agenda\n\n- \n\n## Context\n\n${context?.summary || 'No prior context found'}\n\n## Notes\n\n\n\n## Action Items\n\n- `,
                    tags: ['meeting', 'notes'],
                    category: 'projects'
                };
            },
            saveResult: 'notes_created'
        },
        {
            id: 'set-reminder',
            name: 'Set Pre-Meeting Reminder',
            tool: 'set_reminder',
            args: (ctx) => {
                const events = ctx.results.calendar_events as any;
                const meeting = events?.[0] || {};
                const startTime = meeting.start_time || new Date().toISOString();

                // Set reminder 15 minutes before
                const reminderTime = new Date(new Date(startTime).getTime() - 15 * 60 * 1000).toISOString();

                return {
                    message: `Meeting in 15 minutes: ${meeting.title || 'Untitled'}`,
                    time: reminderTime
                };
            },
            onError: 'continue',
            saveResult: 'reminder_set'
        }
    ]
};

/**
 * Weekly Review - Universal Assistant
 *
 * 1. Review week's calendar
 * 2. Review completed tasks
 * 3. Generate summary
 * 4. Save to vault
 */
export const WEEKLY_REVIEW: ToolChain = {
    id: 'weekly-review',
    name: 'Weekly Review',
    description: 'Review calendar and tasks for the week, generate summary',
    tags: ['review', 'planning', 'productivity'],
    variables: [],
    steps: [
        {
            id: 'review-calendar',
            name: 'Review Week\'s Calendar',
            tool: 'calendar_check',
            args: { time_range: 'this_week' },
            onError: 'continue',
            saveResult: 'week_events'
        },
        {
            id: 'review-tasks',
            name: 'Review Completed Tasks',
            tool: 'task_list',
            args: { status: 'completed' },
            onError: 'continue',
            saveResult: 'completed_tasks'
        },
        {
            id: 'review-pending',
            name: 'Review Pending Tasks',
            tool: 'task_list',
            args: { status: 'pending', priority: 'high' },
            onError: 'continue',
            saveResult: 'pending_tasks'
        },
        {
            id: 'generate-summary',
            name: 'Generate Weekly Summary',
            tool: 'quick_note',
            args: (ctx) => {
                const events = ctx.results.week_events as any;
                const completed = ctx.results.completed_tasks as any;
                const pending = ctx.results.pending_tasks as any;

                const eventCount = events?.length || 0;
                const completedCount = completed?.length || 0;
                const pendingCount = pending?.length || 0;

                return {
                    title: `Weekly Review - ${new Date().toISOString().split('T')[0]}`,
                    content: `# Weekly Review\n\n## This Week's Highlights\n\n**Meetings**: ${eventCount} meetings attended\n**Tasks Completed**: ${completedCount}\n**Tasks Pending**: ${pendingCount}\n\n## Key Events\n\n${events?.slice(0, 5).map((e: any) => `- ${e.title} (${e.start_time})`).join('\n') || 'No events'}\n\n## Completed Tasks\n\n${completed?.slice(0, 10).map((t: any) => `- ✅ ${t.title}`).join('\n') || 'No completed tasks'}\n\n## Next Week's Focus\n\n${pending?.slice(0, 5).map((t: any) => `- ${t.title}`).join('\n') || 'No pending high-priority tasks'}\n\n## Reflections\n\n\n\n## Action Items for Next Week\n\n- `,
                    tags: ['weekly-review', 'planning'],
                    category: 'projects'
                };
            },
            saveResult: 'summary_saved'
        }
    ]
};

/**
 * All built-in chains
 */
export const BUILTIN_CHAINS: ToolChain[] = [
    // Programming Chains
    FIX_BUG_AND_TEST,
    CREATE_FEATURE_SAFE,
    REFACTOR_SAFE,
    DEPLOY_SAFE,
    QUICK_FIX,
    // Universal Assistant Chains
    MORNING_ROUTINE,
    RESEARCH_TOPIC,
    MEETING_PREP,
    WEEKLY_REVIEW
];
