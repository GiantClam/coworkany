import { ClaudeSkillManifest, ToolpackManifest } from '../protocol';
import builtinSkillsData from './builtinSkills.json';

// Extend Protocol manifest to include storage-specific fields.
interface BuiltinSkillManifest extends ClaudeSkillManifest {
    directory: string;
    /** Embedded SKILL.md content for builtins (no filesystem dependency). */
    content: string;
    /** Trigger phrases for auto-activation. */
    triggers?: string[];
}

/**
 * Built-in Agent Skills (Claude Plugins)
 * These are strictly enforced as enabled and read-only.
 */
const BUILTIN_SKILL_ROWS = builtinSkillsData as BuiltinSkillManifest[];

export const BUILTIN_SKILLS: BuiltinSkillManifest[] = BUILTIN_SKILL_ROWS.map((skill) => ({ ...skill }));

/**
 * Built-in MCP Toolpacks
 * These are strictly enforced as enabled and read-only.
 *
 * All toolpacks now use 'internal' runtime - no external MCP installation required.
 * Users get a complete out-of-box experience.
 */
export const BUILTIN_TOOLPACKS: ToolpackManifest[] = [
    {
        id: 'builtin-github',
        name: 'github',
        version: '1.0.0',
        description: 'GitHub operations (PR, Issue, Repo). Requires GITHUB_TOKEN env var for write operations.',
        tools: ['create_issue', 'create_pr', 'list_repos'],
        runtime: 'internal',
        tags: ['builtin', 'scm'],
        effects: ['network:outbound'],
    },
    {
        id: 'builtin-filesystem',
        name: 'filesystem',
        version: '1.0.0',
        description: 'File system operations (Restricted to workspace).',
        tools: ['view_file', 'write_to_file', 'replace_file_content', 'list_dir'],
        runtime: 'internal',
        tags: ['builtin', 'core'],
        effects: ['filesystem:read', 'filesystem:write'],
    },
    {
        id: 'builtin-context7',
        name: 'context7',
        version: '1.0.0',
        description: 'Documentation search and retrieval.',
        tools: ['search_docs', 'get_doc_page'],
        runtime: 'internal',
        tags: ['builtin', 'rag'],
        effects: ['network:outbound'],
    },
    {
        id: 'builtin-memory',
        name: 'memory',
        version: '1.0.0',
        description: 'Persistent memory for the agent. Stores data in .coworkany/memory.json.',
        tools: ['remember', 'recall'],
        runtime: 'internal',
        tags: ['builtin', 'memory'],
        effects: [],
    },
    {
        id: 'builtin-sequential-thinking',
        name: 'sequential-thinking',
        version: '2.0.0',
        description: 'Structured reasoning, sequential plan execution, and persistent findings.',
        tools: ['think', 'plan_step', 'log_finding'],
        runtime: 'internal',
        tags: ['builtin', 'reasoning'],
        effects: [],
    },
    {
        id: 'builtin-firecrawl',
        name: 'firecrawl',
        version: '1.0.0',
        description: 'Web scraping and crawling capabilities.',
        tools: ['crawl_url', 'extract_content'],
        runtime: 'internal',
        tags: ['builtin', 'web'],
        effects: ['network:outbound'],
    },
    {
        id: 'builtin-websearch',
        name: 'websearch',
        version: '1.0.0',
        description: 'Web search with multi-provider support (SearXNG, Tavily, Brave). Configure in llm-config.json.',
        tools: ['search_web'],
        runtime: 'internal',
        tags: ['builtin', 'web', 'search'],
        effects: ['network:outbound'],
    },
];
