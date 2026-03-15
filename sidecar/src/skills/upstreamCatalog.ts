export interface SkillUpstreamSpec {
    name: string;
    repo: string;
    repoPath: string;
    ref: string;
}

const UPSTREAM_SKILLS: SkillUpstreamSpec[] = [
    { name: 'docx', repo: 'anthropics/skills', repoPath: 'skills/docx', ref: 'main' },
    { name: 'frontend-design', repo: 'anthropics/skills', repoPath: 'skills/frontend-design', ref: 'main' },
    { name: 'mcp-builder', repo: 'anthropics/skills', repoPath: 'skills/mcp-builder', ref: 'main' },
    { name: 'pdf', repo: 'anthropics/skills', repoPath: 'skills/pdf', ref: 'main' },
    { name: 'pptx', repo: 'anthropics/skills', repoPath: 'skills/pptx', ref: 'main' },
    { name: 'skill-creator', repo: 'anthropics/skills', repoPath: 'skills/skill-creator', ref: 'main' },
    { name: 'theme-factory', repo: 'anthropics/skills', repoPath: 'skills/theme-factory', ref: 'main' },
    { name: 'webapp-testing', repo: 'anthropics/skills', repoPath: 'skills/webapp-testing', ref: 'main' },
    { name: 'xlsx', repo: 'anthropics/skills', repoPath: 'skills/xlsx', ref: 'main' },
    { name: 'agent-sdk-dev', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/agent-sdk-dev', ref: 'main' },
    { name: 'code-review', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/code-review', ref: 'main' },
    { name: 'code-simplifier', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/code-simplifier', ref: 'main' },
    { name: 'feature-dev', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/feature-dev', ref: 'main' },
    { name: 'plugin-dev', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/plugin-dev', ref: 'main' },
    { name: 'pr-review-toolkit', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/pr-review-toolkit', ref: 'main' },
    { name: 'pyright-lsp', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/pyright-lsp', ref: 'main' },
    { name: 'rust-analyzer-lsp', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/rust-analyzer-lsp', ref: 'main' },
    { name: 'security-guidance', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/security-guidance', ref: 'main' },
    { name: 'typescript-lsp', repo: 'anthropics/claude-plugins-official', repoPath: 'plugins/typescript-lsp', ref: 'main' },
    { name: 'brainstorming', repo: 'obra/superpowers', repoPath: 'skills/brainstorming', ref: 'main' },
    { name: 'dispatching-parallel-agents', repo: 'obra/superpowers', repoPath: 'skills/dispatching-parallel-agents', ref: 'main' },
    { name: 'executing-plans', repo: 'obra/superpowers', repoPath: 'skills/executing-plans', ref: 'main' },
    { name: 'finishing-a-development-branch', repo: 'obra/superpowers', repoPath: 'skills/finishing-a-development-branch', ref: 'main' },
    { name: 'receiving-code-review', repo: 'obra/superpowers', repoPath: 'skills/receiving-code-review', ref: 'main' },
    { name: 'requesting-code-review', repo: 'obra/superpowers', repoPath: 'skills/requesting-code-review', ref: 'main' },
    { name: 'subagent-driven-development', repo: 'obra/superpowers', repoPath: 'skills/subagent-driven-development', ref: 'main' },
    { name: 'systematic-debugging', repo: 'obra/superpowers', repoPath: 'skills/systematic-debugging', ref: 'main' },
    { name: 'test-driven-development', repo: 'obra/superpowers', repoPath: 'skills/test-driven-development', ref: 'main' },
    { name: 'using-git-worktrees', repo: 'obra/superpowers', repoPath: 'skills/using-git-worktrees', ref: 'main' },
    { name: 'using-superpowers', repo: 'obra/superpowers', repoPath: 'skills/using-superpowers', ref: 'main' },
    { name: 'verification-before-completion', repo: 'obra/superpowers', repoPath: 'skills/verification-before-completion', ref: 'main' },
    { name: 'writing-plans', repo: 'obra/superpowers', repoPath: 'skills/writing-plans', ref: 'main' },
    { name: 'writing-skills', repo: 'obra/superpowers', repoPath: 'skills/writing-skills', ref: 'main' },
    { name: 'planning-with-files', repo: 'OthmanAdi/planning-with-files', repoPath: 'skills/planning-with-files', ref: 'master' },
];

const UPSTREAM_SKILL_MAP = new Map(
    UPSTREAM_SKILLS.map((entry) => [entry.name.toLowerCase(), entry])
);

export function resolveSkillUpstream(name: string): SkillUpstreamSpec | null {
    const normalized = name.trim().toLowerCase();
    return UPSTREAM_SKILL_MAP.get(normalized) ?? null;
}

export function buildGitHubSkillSource(spec: SkillUpstreamSpec): string {
    return `github:${spec.repo}/${spec.repoPath}`;
}
