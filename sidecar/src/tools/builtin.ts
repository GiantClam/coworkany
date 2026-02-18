/**
 * Built-in Tool Implementations
 *
 * These tools are bundled with the application and work out-of-the-box
 * without requiring users to install external MCP servers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition, ToolContext } from './standard';
import { voiceSpeakTool } from './core/voice';
import { taskCreateTool, taskListTool, taskUpdateTool } from './core/tasks';
import { systemStatusTool } from './core/system';
import {
    calendarCheckTool,
    calendarCreateEventTool,
    calendarUpdateEventTool,
    calendarFindFreeTimeTool,
} from './core/calendar';
import {
    emailCheckTool,
    emailSendTool,
    emailReplyTool,
    emailGetThreadTool,
} from './core/email';
import { CODE_QUALITY_TOOLS } from './codeQuality';

// ============================================================================
// Memory Tools - Local File-Based Storage
// ============================================================================

interface MemoryEntry {
    key: string;
    value: string;
    category?: string;
    timestamp: string;
}

interface MemoryStore {
    entries: MemoryEntry[];
}

function getMemoryStorePath(workspacePath: string): string {
    const coworkanyDir = path.join(workspacePath, '.coworkany');
    if (!fs.existsSync(coworkanyDir)) {
        fs.mkdirSync(coworkanyDir, { recursive: true });
    }
    return path.join(coworkanyDir, 'memory.json');
}

function loadMemoryStore(workspacePath: string): MemoryStore {
    const storePath = getMemoryStorePath(workspacePath);
    try {
        if (fs.existsSync(storePath)) {
            const content = fs.readFileSync(storePath, 'utf-8');
            return JSON.parse(content) as MemoryStore;
        }
    } catch (error) {
        console.error('[Memory] Failed to load memory store:', error);
    }
    return { entries: [] };
}

function saveMemoryStore(workspacePath: string, store: MemoryStore): void {
    const storePath = getMemoryStorePath(workspacePath);
    try {
        fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
    } catch (error) {
        console.error('[Memory] Failed to save memory store:', error);
    }
}

export const rememberTool: ToolDefinition = {
    name: 'remember',
    description: 'Store a piece of information in long-term memory. The information will persist across sessions.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            key: {
                type: 'string',
                description: 'Optional key to identify this memory for later retrieval.',
            },
            value: {
                type: 'string',
                description: 'The information to remember.',
            },
            category: {
                type: 'string',
                description: 'Optional category to organize memories (e.g., "user_preference", "project_info").',
            },
        },
        required: ['value'],
    },
    handler: async (args: { key?: string; value: string; category?: string }, context: ToolContext) => {
        const store = loadMemoryStore(context.workspacePath);

        const entry: MemoryEntry = {
            key: args.key || `memory_${Date.now()}`,
            value: args.value,
            category: args.category,
            timestamp: new Date().toISOString(),
        };

        // Update existing entry with same key, or add new
        const existingIndex = store.entries.findIndex(e => e.key === entry.key);
        if (existingIndex >= 0) {
            store.entries[existingIndex] = entry;
        } else {
            store.entries.push(entry);
        }

        saveMemoryStore(context.workspacePath, store);

        return {
            success: true,
            key: entry.key,
            message: `Remembered: "${args.value.slice(0, 100)}${args.value.length > 100 ? '...' : ''}"`,
        };
    },
};

export const recallTool: ToolDefinition = {
    name: 'recall',
    description: 'Recall information from long-term memory. Searches by key, category, or content.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search query to find relevant memories. Searches in keys, values, and categories.',
            },
            key: {
                type: 'string',
                description: 'Optional specific key to retrieve.',
            },
            category: {
                type: 'string',
                description: 'Optional category to filter by.',
            },
        },
        required: ['query'],
    },
    handler: async (args: { query: string; key?: string; category?: string }, context: ToolContext) => {
        const store = loadMemoryStore(context.workspacePath);

        let results = store.entries;

        // Filter by key if provided
        if (args.key) {
            results = results.filter(e => e.key === args.key);
        }

        // Filter by category if provided
        if (args.category) {
            results = results.filter(e => e.category === args.category);
        }

        // Search by query in key, value, and category
        if (args.query && !args.key) {
            const queryLower = args.query.toLowerCase();
            results = results.filter(e =>
                e.key.toLowerCase().includes(queryLower) ||
                e.value.toLowerCase().includes(queryLower) ||
                (e.category && e.category.toLowerCase().includes(queryLower))
            );
        }

        if (results.length === 0) {
            return {
                found: false,
                message: `No memories found matching: "${args.query}"`,
                memories: [],
            };
        }

        return {
            found: true,
            count: results.length,
            memories: results.map(e => ({
                key: e.key,
                value: e.value,
                category: e.category,
                timestamp: e.timestamp,
            })),
        };
    },
};

// ============================================================================
// Persistent Planning Tools - File-based planning (Manus-style)
//
// Plans are persisted to .coworkany/task_plan.md so they survive context
// truncation. Findings go to findings.md, session logs to progress.md.
// ============================================================================

/** Ensure the .coworkany planning directory exists and return its path */
function ensurePlanningDir(workspacePath: string): string {
    const dir = path.join(workspacePath, '.coworkany');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/** Read the current task plan from disk (empty string if absent) */
export function readTaskPlan(workspacePath: string): string {
    const planPath = path.join(workspacePath, '.coworkany', 'task_plan.md');
    try {
        if (fs.existsSync(planPath)) {
            return fs.readFileSync(planPath, 'utf-8');
        }
    } catch { /* ignore */ }
    return '';
}

/** Read the first N lines of the task plan (for PreToolUse injection) */
export function readTaskPlanHead(workspacePath: string, lines = 30): string {
    const content = readTaskPlan(workspacePath);
    if (!content) return '';
    return content.split('\n').slice(0, lines).join('\n');
}

/** Count incomplete steps in the current plan */
export function countIncompletePlanSteps(workspacePath: string): { total: number; incomplete: number; steps: string[] } {
    const content = readTaskPlan(workspacePath);
    if (!content) return { total: 0, incomplete: 0, steps: [] };
    // Match lines like: - [ ] Step 1: ... or - [x] Step 2: ...
    const stepLines = content.split('\n').filter(l => /^- \[[ x]\]/.test(l));
    const incomplete = stepLines.filter(l => l.startsWith('- [ ]'));
    return {
        total: stepLines.length,
        incomplete: incomplete.length,
        steps: incomplete.map(l => l.replace(/^- \[ \] /, '').trim()),
    };
}

/** Append a timestamped entry to progress.md */
function appendToProgress(workspacePath: string, entry: string): void {
    const dir = ensurePlanningDir(workspacePath);
    const progressPath = path.join(dir, 'progress.md');
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const line = `\n- [${timestamp}] ${entry}\n`;
    try {
        if (!fs.existsSync(progressPath)) {
            fs.writeFileSync(progressPath, `# Progress Log\n\nSession started at ${timestamp}\n${line}`, 'utf-8');
        } else {
            fs.appendFileSync(progressPath, line, 'utf-8');
        }
    } catch (e) {
        console.error('[Planning] Failed to append to progress.md:', e);
    }
}

/** Append a finding to findings.md */
function appendToFindings(workspacePath: string, finding: string, category?: string): void {
    const dir = ensurePlanningDir(workspacePath);
    const findingsPath = path.join(dir, 'findings.md');
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const catLabel = category ? ` [${category}]` : '';
    const line = `\n### ${timestamp}${catLabel}\n\n${finding}\n`;
    try {
        if (!fs.existsSync(findingsPath)) {
            fs.writeFileSync(findingsPath, `# Findings\n${line}`, 'utf-8');
        } else {
            fs.appendFileSync(findingsPath, line, 'utf-8');
        }
    } catch (e) {
        console.error('[Planning] Failed to append to findings.md:', e);
    }
}

export const thinkTool: ToolDefinition = {
    name: 'think',
    description: 'Perform a structured thinking step. The thought is persisted to .coworkany/progress.md so it survives context truncation. Use this to break down complex problems and reason through solutions step by step.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            thought: {
                type: 'string',
                description: 'The current thought or reasoning step.',
            },
            next_step: {
                type: 'string',
                description: 'Optional: What to consider or do next.',
            },
        },
        required: ['thought'],
    },
    handler: async (args: { thought: string; next_step?: string }, context: ToolContext) => {
        // Persist thinking to progress.md
        if (context?.workspacePath) {
            const summary = args.thought.length > 200
                ? args.thought.slice(0, 200) + '...'
                : args.thought;
            appendToProgress(context.workspacePath, `THINK: ${summary}`);
        }
        return {
            acknowledged: true,
            thought: args.thought,
            next_step: args.next_step || 'Continue reasoning...',
        };
    },
};

export const planStepTool: ToolDefinition = {
    name: 'plan_step',
    description: 'Record or update a step in the execution plan. The plan is PERSISTED to .coworkany/task_plan.md on disk. Use this to document your planned approach before executing. Call again with the same step_number and status="completed" to mark steps done.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            step_number: {
                type: 'integer',
                description: 'The step number in the plan (1, 2, 3, ...).',
            },
            description: {
                type: 'string',
                description: 'Description of what this step will accomplish.',
            },
            status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'skipped'],
                description: 'Current status of this step. Use "completed" to mark a step done.',
            },
            goal: {
                type: 'string',
                description: 'Optional: The overall task goal. Include on the first plan_step call to set the plan header.',
            },
            error: {
                type: 'string',
                description: 'Optional: Error encountered during this step. Will be logged for future reference.',
            },
        },
        required: ['step_number', 'description'],
    },
    handler: async (args: {
        step_number: number;
        description: string;
        status?: string;
        goal?: string;
        error?: string;
    }, context: ToolContext) => {
        const status = args.status || 'pending';
        const checkbox = (status === 'completed' || status === 'skipped') ? '[x]' : '[ ]';
        const statusLabel = status !== 'pending' ? ` (${status})` : '';

        // Persist to disk if workspace is available
        if (context?.workspacePath) {
            const dir = ensurePlanningDir(context.workspacePath);
            const planPath = path.join(dir, 'task_plan.md');

            try {
                let planContent = '';
                if (fs.existsSync(planPath)) {
                    planContent = fs.readFileSync(planPath, 'utf-8');
                }

                // First call — initialize the plan file
                if (!planContent || planContent.trim() === '') {
                    const goalLine = args.goal ? `\n**Goal**: ${args.goal}\n` : '';
                    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
                    planContent = `# Task Plan\n\nCreated: ${timestamp}${goalLine}\n## Steps\n\n`;
                } else if (args.goal && !planContent.includes('**Goal**')) {
                    // Add goal if provided later
                    planContent = planContent.replace('## Steps', `**Goal**: ${args.goal}\n\n## Steps`);
                }

                // Check if this step already exists (update it)
                const stepRegex = new RegExp(`^- \\[[ x]\\] Step ${args.step_number}:.*$`, 'm');
                const newLine = `- ${checkbox} Step ${args.step_number}: ${args.description}${statusLabel}`;

                if (stepRegex.test(planContent)) {
                    // Update existing step
                    planContent = planContent.replace(stepRegex, newLine);
                } else {
                    // Append new step (ensure it's in order)
                    const stepsSection = planContent.indexOf('## Steps');
                    if (stepsSection >= 0) {
                        // Find the right insertion point (after existing steps)
                        const afterSteps = planContent.slice(stepsSection);
                        const lines = afterSteps.split('\n');
                        let insertIdx = stepsSection;
                        for (let i = 1; i < lines.length; i++) {
                            if (lines[i].startsWith('- [')) {
                                insertIdx = stepsSection + lines.slice(0, i + 1).join('\n').length;
                            } else if (lines[i].startsWith('##') && i > 1) {
                                break;
                            }
                        }
                        planContent = planContent.slice(0, insertIdx) + '\n' + newLine + planContent.slice(insertIdx);
                    } else {
                        planContent += '\n' + newLine;
                    }
                }

                // Log errors to a dedicated section
                if (args.error) {
                    if (!planContent.includes('## Errors')) {
                        planContent += '\n\n## Errors\n\n| Step | Error | Timestamp |\n|------|-------|-----------|\n';
                    }
                    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
                    planContent += `| ${args.step_number} | ${args.error.replace(/\|/g, '\\|').slice(0, 100)} | ${ts} |\n`;
                }

                fs.writeFileSync(planPath, planContent, 'utf-8');

                // Also ensure findings.md and progress.md exist
                const findingsPath = path.join(dir, 'findings.md');
                const progressPath = path.join(dir, 'progress.md');
                if (!fs.existsSync(findingsPath)) {
                    fs.writeFileSync(findingsPath, '# Findings\n\nResearch discoveries and knowledge accumulated during task execution.\n', 'utf-8');
                }
                if (!fs.existsSync(progressPath)) {
                    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
                    fs.writeFileSync(progressPath, `# Progress Log\n\nSession started at ${ts}\n`, 'utf-8');
                }

                // Log to progress.md
                appendToProgress(context.workspacePath, `PLAN Step ${args.step_number} [${status}]: ${args.description}`);

                // Return the current full plan so the LLM knows disk state
                const currentPlan = fs.readFileSync(planPath, 'utf-8');
                return {
                    acknowledged: true,
                    persisted: true,
                    step: args.step_number,
                    description: args.description,
                    status,
                    planFile: '.coworkany/task_plan.md',
                    currentPlan: currentPlan.length > 1500 ? currentPlan.slice(0, 1500) + '\n...[truncated]' : currentPlan,
                };
            } catch (e) {
                console.error('[Planning] Failed to persist plan:', e);
            }
        }

        // Fallback if no workspace
        return {
            acknowledged: true,
            persisted: false,
            step: args.step_number,
            description: args.description,
            status,
        };
    },
};

export const logFindingTool: ToolDefinition = {
    name: 'log_finding',
    description: 'Persist a research finding or discovery to .coworkany/findings.md. Use this to save important information that should survive context truncation — API responses, research results, key decisions, etc.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            finding: {
                type: 'string',
                description: 'The finding or discovery to record.',
            },
            category: {
                type: 'string',
                description: 'Optional category (e.g., "security", "architecture", "api", "error").',
            },
        },
        required: ['finding'],
    },
    handler: async (args: { finding: string; category?: string }, context: ToolContext) => {
        if (context?.workspacePath) {
            appendToFindings(context.workspacePath, args.finding, args.category);
            return {
                success: true,
                persisted: true,
                file: '.coworkany/findings.md',
                preview: args.finding.slice(0, 100) + (args.finding.length > 100 ? '...' : ''),
            };
        }
        return { success: false, error: 'No workspace path available' };
    },
};

// ============================================================================
// Web Crawl Tools - Fetch and Parse Web Content
// ============================================================================

/**
 * Simple HTML to text converter
 */
function htmlToText(html: string): string {
    // Remove script and style elements
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Convert common elements to text equivalents
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n\n');
    text = text.replace(/<li>/gi, '• ');
    text = text.replace(/<\/li>/gi, '\n');

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");

    // Clean up whitespace
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
    text = text.trim();

    return text;
}

/**
 * Extract links from HTML
 */
function extractLinks(html: string, baseUrl: string): { href: string; text: string }[] {
    const links: { href: string; text: string }[] = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        let href = match[1];
        const text = match[2].trim();

        // Convert relative URLs to absolute
        if (href.startsWith('/')) {
            const url = new URL(baseUrl);
            href = `${url.protocol}//${url.host}${href}`;
        } else if (!href.startsWith('http')) {
            href = new URL(href, baseUrl).toString();
        }

        if (text && href.startsWith('http')) {
            links.push({ href, text });
        }
    }

    return links;
}

export const crawlUrlTool: ToolDefinition = {
    name: 'crawl_url',
    description: 'Crawl a website and extract its text content. Useful for reading web pages, documentation, and articles.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL to crawl.',
            },
            include_links: {
                type: 'boolean',
                description: 'Whether to include extracted links in the response.',
            },
            max_length: {
                type: 'integer',
                description: 'Maximum content length to return (default: 50000 characters).',
            },
        },
        required: ['url'],
    },
    handler: async (args: { url: string; include_links?: boolean; max_length?: number }) => {
        const { url, include_links = false, max_length = 50000 } = args;

        try {
            console.error(`[WebCrawl] Fetching: ${url}`);

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'CoworkAny-Desktop/1.0 (Web Crawler)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${response.statusText}`,
                    url,
                };
            }

            const contentType = response.headers.get('content-type') || '';
            const html = await response.text();

            // Extract title
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

            // Convert to text
            let content = htmlToText(html);

            // Truncate if too long
            if (content.length > max_length) {
                content = content.slice(0, max_length) + '\n\n[Content truncated...]';
            }

            const result: any = {
                success: true,
                url,
                title,
                content,
                contentLength: content.length,
            };

            if (include_links) {
                result.links = extractLinks(html, url).slice(0, 50); // Limit to 50 links
            }

            console.error(`[WebCrawl] Extracted ${content.length} characters from ${url}`);

            return result;
        } catch (error) {
            console.error(`[WebCrawl] Error fetching ${url}:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                url,
            };
        }
    },
};

export const extractContentTool: ToolDefinition = {
    name: 'extract_content',
    description: 'Extract structured content from a URL. Attempts to extract the main content, removing navigation and other clutter.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL to extract content from.',
            },
            selectors: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional CSS-like selectors to target specific content (e.g., "article", "main", ".content").',
            },
        },
        required: ['url'],
    },
    handler: async (args: { url: string; selectors?: string[] }) => {
        const { url, selectors } = args;

        try {
            console.error(`[ExtractContent] Fetching: ${url}`);

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'CoworkAny-Desktop/1.0 (Content Extractor)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${response.statusText}`,
                    url,
                };
            }

            const html = await response.text();

            // Extract metadata
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

            const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
            const description = descMatch ? descMatch[1].trim() : undefined;

            // Try to extract main content using common patterns
            let mainContent = html;

            // Try common content containers
            const contentPatterns = [
                /<article[^>]*>([\s\S]*?)<\/article>/i,
                /<main[^>]*>([\s\S]*?)<\/main>/i,
                /<div[^>]+class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                /<div[^>]+id="content"[^>]*>([\s\S]*?)<\/div>/i,
                /<div[^>]+class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            ];

            for (const pattern of contentPatterns) {
                const match = html.match(pattern);
                if (match) {
                    mainContent = match[1];
                    break;
                }
            }

            const textContent = htmlToText(mainContent);

            // Extract headings for structure
            const headings: { level: number; text: string }[] = [];
            const headingRegex = /<h([1-6])[^>]*>([^<]+)<\/h\1>/gi;
            let headingMatch;
            while ((headingMatch = headingRegex.exec(mainContent)) !== null) {
                headings.push({
                    level: parseInt(headingMatch[1]),
                    text: headingMatch[2].trim(),
                });
            }

            console.error(`[ExtractContent] Extracted ${textContent.length} characters, ${headings.length} headings`);

            return {
                success: true,
                url,
                title,
                description,
                content: textContent.slice(0, 50000),
                headings: headings.slice(0, 20),
                contentLength: textContent.length,
            };
        } catch (error) {
            console.error(`[ExtractContent] Error:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                url,
            };
        }
    },
};

// ============================================================================
// GitHub Tools - Direct API Access
// ============================================================================

function getGitHubToken(): string | undefined {
    return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

async function githubRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = getGitHubToken();

    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'CoworkAny-Desktop/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers as Record<string, string> || {}),
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`https://api.github.com${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API error: ${response.status} ${errorText}`);
    }

    return response.json();
}

export const createIssueTool: ToolDefinition = {
    name: 'create_issue',
    description: 'Create a new issue in a GitHub repository. Requires GITHUB_TOKEN environment variable to be set.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            owner: {
                type: 'string',
                description: 'Repository owner (username or organization).',
            },
            repo: {
                type: 'string',
                description: 'Repository name.',
            },
            title: {
                type: 'string',
                description: 'Issue title.',
            },
            body: {
                type: 'string',
                description: 'Issue body/description.',
            },
            labels: {
                type: 'array',
                items: { type: 'string' },
                description: 'Labels to add to the issue.',
            },
        },
        required: ['owner', 'repo', 'title'],
    },
    handler: async (args: { owner: string; repo: string; title: string; body?: string; labels?: string[] }) => {
        const token = getGitHubToken();
        if (!token) {
            return {
                success: false,
                error: 'GitHub token not configured. Set GITHUB_TOKEN or GH_TOKEN environment variable.',
            };
        }

        try {
            console.error(`[GitHub] Creating issue in ${args.owner}/${args.repo}`);

            const data = await githubRequest(`/repos/${args.owner}/${args.repo}/issues`, {
                method: 'POST',
                body: JSON.stringify({
                    title: args.title,
                    body: args.body,
                    labels: args.labels,
                }),
            });

            return {
                success: true,
                issue_number: data.number,
                url: data.html_url,
                title: data.title,
                state: data.state,
            };
        } catch (error) {
            console.error(`[GitHub] Error creating issue:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

export const createPrTool: ToolDefinition = {
    name: 'create_pr',
    description: 'Create a new pull request in a GitHub repository. Requires GITHUB_TOKEN environment variable to be set.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            owner: {
                type: 'string',
                description: 'Repository owner (username or organization).',
            },
            repo: {
                type: 'string',
                description: 'Repository name.',
            },
            title: {
                type: 'string',
                description: 'Pull request title.',
            },
            head: {
                type: 'string',
                description: 'The name of the branch where your changes are implemented.',
            },
            base: {
                type: 'string',
                description: 'The name of the branch you want the changes pulled into (usually main or master).',
            },
            body: {
                type: 'string',
                description: 'Pull request body/description.',
            },
            draft: {
                type: 'boolean',
                description: 'Whether to create a draft pull request.',
            },
        },
        required: ['owner', 'repo', 'title', 'head', 'base'],
    },
    handler: async (args: { owner: string; repo: string; title: string; head: string; base: string; body?: string; draft?: boolean }) => {
        const token = getGitHubToken();
        if (!token) {
            return {
                success: false,
                error: 'GitHub token not configured. Set GITHUB_TOKEN or GH_TOKEN environment variable.',
            };
        }

        try {
            console.error(`[GitHub] Creating PR in ${args.owner}/${args.repo}: ${args.head} -> ${args.base}`);

            const data = await githubRequest(`/repos/${args.owner}/${args.repo}/pulls`, {
                method: 'POST',
                body: JSON.stringify({
                    title: args.title,
                    head: args.head,
                    base: args.base,
                    body: args.body,
                    draft: args.draft,
                }),
            });

            return {
                success: true,
                pr_number: data.number,
                url: data.html_url,
                title: data.title,
                state: data.state,
                draft: data.draft,
            };
        } catch (error) {
            console.error(`[GitHub] Error creating PR:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

export const listReposTool: ToolDefinition = {
    name: 'list_repos',
    description: 'List repositories for a user or organization. Requires GITHUB_TOKEN for private repos.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            username: {
                type: 'string',
                description: 'GitHub username or organization name. If omitted, lists authenticated user\'s repos.',
            },
            type: {
                type: 'string',
                enum: ['all', 'owner', 'public', 'private', 'member'],
                description: 'Type of repositories to list.',
            },
            sort: {
                type: 'string',
                enum: ['created', 'updated', 'pushed', 'full_name'],
                description: 'Sort order for repositories.',
            },
            per_page: {
                type: 'integer',
                description: 'Number of repositories per page (max 100).',
            },
        },
    },
    handler: async (args: { username?: string; type?: string; sort?: string; per_page?: number }) => {
        try {
            const params = new URLSearchParams();
            if (args.type) params.set('type', args.type);
            if (args.sort) params.set('sort', args.sort);
            params.set('per_page', String(args.per_page || 30));

            let endpoint: string;
            if (args.username) {
                endpoint = `/users/${args.username}/repos?${params}`;
            } else {
                const token = getGitHubToken();
                if (!token) {
                    return {
                        success: false,
                        error: 'GitHub token required when no username is provided. Set GITHUB_TOKEN environment variable.',
                    };
                }
                endpoint = `/user/repos?${params}`;
            }

            console.error(`[GitHub] Listing repos: ${endpoint}`);

            const data = await githubRequest(endpoint);

            return {
                success: true,
                count: data.length,
                repositories: data.map((repo: any) => ({
                    name: repo.name,
                    full_name: repo.full_name,
                    description: repo.description,
                    url: repo.html_url,
                    private: repo.private,
                    language: repo.language,
                    stars: repo.stargazers_count,
                    forks: repo.forks_count,
                    updated_at: repo.updated_at,
                })),
            };
        } catch (error) {
            console.error(`[GitHub] Error listing repos:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

// ============================================================================
// Documentation Tools - Web-Based Doc Search
// ============================================================================

export const searchDocsTool: ToolDefinition = {
    name: 'search_docs',
    description: 'Search documentation for programming libraries and frameworks. Uses web search to find relevant documentation pages.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search query for documentation.',
            },
            library: {
                type: 'string',
                description: 'Specific library/framework to search (e.g., "react", "python", "rust").',
            },
        },
        required: ['query'],
    },
    handler: async (args: { query: string; library?: string }) => {
        const { query, library } = args;

        // Build search query with library context
        let searchQuery = query;
        if (library) {
            searchQuery = `${library} documentation ${query}`;
        } else {
            searchQuery = `documentation ${query}`;
        }

        try {
            // Use DuckDuckGo HTML search (no API key required)
            const encodedQuery = encodeURIComponent(searchQuery);
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

            console.error(`[SearchDocs] Searching: ${searchQuery}`);

            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'CoworkAny-Desktop/1.0 (Documentation Search)',
                },
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: `Search failed: ${response.status}`,
                };
            }

            const html = await response.text();

            // Extract search results
            const results: { title: string; url: string; snippet: string }[] = [];
            const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*)/gi;

            let match;
            while ((match = resultRegex.exec(html)) !== null && results.length < 10) {
                const url = match[1];
                const title = match[2].trim();
                const snippet = match[3].trim();

                // Filter for documentation-related URLs
                if (url.includes('doc') || url.includes('api') || url.includes('reference') ||
                    url.includes('guide') || url.includes('tutorial') || url.includes('manual') ||
                    url.includes('.io') || url.includes('github.com') || url.includes('readthedocs')) {
                    results.push({ title, url, snippet });
                }
            }

            // If no doc-specific results, return all results
            if (results.length === 0) {
                const allResultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]*)/gi;
                while ((match = allResultRegex.exec(html)) !== null && results.length < 10) {
                    results.push({
                        url: match[1],
                        title: match[2].trim(),
                        snippet: match[3].trim(),
                    });
                }
            }

            console.error(`[SearchDocs] Found ${results.length} results`);

            return {
                success: true,
                query: searchQuery,
                library,
                count: results.length,
                results,
            };
        } catch (error) {
            console.error(`[SearchDocs] Error:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

export const getDocPageTool: ToolDefinition = {
    name: 'get_doc_page',
    description: 'Retrieve the full content of a documentation page. Extracts and formats the main documentation content.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL of the documentation page to retrieve.',
            },
        },
        required: ['url'],
    },
    handler: async (args: { url: string }) => {
        // Delegate to crawl_url with documentation-specific handling
        return crawlUrlTool.handler({ url: args.url, include_links: true, max_length: 80000 }, { workspacePath: '', taskId: '' });
    },
};

// ============================================================================
// Memory Vault Tools (RAG-enabled)
// ============================================================================

export const saveToVaultTool: ToolDefinition = {
    name: 'save_to_vault',
    description: 'Save information to the long-term memory vault. This creates a searchable markdown document that persists across sessions and can be found via semantic search.',
    effects: ['state:remember', 'filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'A descriptive title for this memory.',
            },
            content: {
                type: 'string',
                description: 'The information to save. Can be markdown formatted.',
            },
            category: {
                type: 'string',
                enum: ['learnings', 'preferences', 'projects'],
                description: 'Category for organization. learnings=insights/facts, preferences=user preferences, projects=project-specific info.',
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tags for better searchability.',
            },
        },
        required: ['title', 'content'],
    },
    handler: async (args: { title: string; content: string; category?: string; tags?: string[] }, context: ToolContext) => {
        try {
            // Dynamic import to avoid circular dependencies
            const { getVaultManager } = await import('../memory');
            const vault = getVaultManager();

            const category = (args.category || 'learnings') as 'learnings' | 'preferences' | 'projects';
            const relativePath = await vault.saveMemory(args.title, args.content, {
                category,
                tags: args.tags,
            });

            return {
                success: true,
                path: relativePath,
                title: args.title,
                category,
                message: `Saved to memory vault: ${relativePath}`,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};

export const searchVaultTool: ToolDefinition = {
    name: 'search_vault',
    description: 'Search the memory vault using semantic search. Finds relevant memories based on meaning, not just keywords.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search query to find relevant memories.',
            },
            top_k: {
                type: 'number',
                description: 'Number of results to return (default: 5, max: 10).',
            },
            category: {
                type: 'string',
                description: 'Optional category filter.',
            },
        },
        required: ['query'],
    },
    handler: async (args: { query: string; top_k?: number; category?: string }) => {
        try {
            // Dynamic import to avoid circular dependencies
            const { getRagBridge } = await import('../memory');
            const bridge = getRagBridge();

            const isAvailable = await bridge.isAvailable();
            if (!isAvailable) {
                return {
                    success: false,
                    error: 'Memory vault service is not available. Make sure the RAG service is running.',
                    results: [],
                };
            }

            const response = await bridge.search({
                query: args.query,
                topK: Math.min(args.top_k || 5, 10),
                filterCategory: args.category,
                includeContent: true,
            });

            return {
                success: true,
                query: args.query,
                totalIndexed: response.totalIndexed,
                results: response.results.map(r => ({
                    title: r.title,
                    path: r.path,
                    category: r.category,
                    score: r.score,
                    snippet: r.content?.slice(0, 200) + (r.content && r.content.length > 200 ? '...' : ''),
                })),
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                results: [],
            };
        }
    },
};
// OS Integration Tools
// ============================================================================

export const openInBrowserTool: ToolDefinition = {
    name: 'open_in_browser',
    description: 'Open a URL in the user\'s default web browser. Use this when the user explicitly asks to "open" a page or when you want to show them something in their browser.',
    effects: ['process:spawn', 'ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL to open.',
            },
        },
        required: ['url'],
    },
    handler: async (args: { url: string }) => {
        const { url } = args;
        let command = '';
        let commandArgs: string[] = [];

        switch (process.platform) {
            case 'win32':
                command = 'explorer'; // Windows 'start' is a shell builtin, 'explorer' is safer for spawning
                commandArgs = [url];
                break;
            case 'darwin':
                command = 'open';
                commandArgs = [url];
                break;
            default: // linux, freebsd, openbsd, sunos, aix
                command = 'xdg-open';
                commandArgs = [url];
                break;
        }

        try {
            console.error(`[OpenBrowser] Opening: ${url} with ${command}`);

            // Use child_process.spawn for fire-and-forget
            const { spawn } = await import('child_process');
            const child = spawn(command, commandArgs, {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();

            return {
                success: true,
                message: `Opened ${url} in default browser`,
                url
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                url
            };
        }
    },
};

// ============================================================================
// Browser Automation Tools (Re-export)
// ============================================================================

export { BROWSER_TOOLS } from './browser';

// ============================================================================
// Export Organized Tool Modules (New Structure)
// ============================================================================

export * from './personal';
export * from './productivity';
export * from './web';
export * from './files';
export * from './coding';
export * from './memory';

// ============================================================================
// Export All Builtin Tools
// ============================================================================

export const BUILTIN_TOOLS: ToolDefinition[] = [
    // Core Skills (Unified Capability Model)
    voiceSpeakTool,
    taskCreateTool,
    taskListTool,
    taskUpdateTool,
    systemStatusTool,

    // Calendar Integration
    calendarCheckTool,
    calendarCreateEventTool,
    calendarUpdateEventTool,
    calendarFindFreeTimeTool,

    // Email Integration
    emailCheckTool,
    emailSendTool,
    emailReplyTool,
    emailGetThreadTool,

    // Code Quality
    ...CODE_QUALITY_TOOLS,

    // ... existing tools will be added below ...
    // Memory (local)
    rememberTool,
    recallTool,
    // Memory Vault (RAG)
    saveToVaultTool,
    searchVaultTool,
    // Sequential Thinking + Persistent Planning
    thinkTool,
    planStepTool,
    logFindingTool,
    // Web Crawl
    crawlUrlTool,
    extractContentTool,
    // GitHub
    createIssueTool,
    createPrTool,
    listReposTool,
    // Documentation
    searchDocsTool,
    getDocPageTool,
    // OS Integration
    openInBrowserTool,
];
