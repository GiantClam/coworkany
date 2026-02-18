/**
 * MCP Server Configuration Templates
 * Based on everything-claude-code mcp-configs
 *
 * Pre-configured templates for common MCP servers:
 * - GitHub
 * - Supabase
 * - Vercel
 * - Railway
 * - Filesystem
 */

export interface McpServerTemplate {
    id: string;
    name: string;
    description: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    category: 'development' | 'deployment' | 'database' | 'filesystem' | 'other';
    requiresApiKey: boolean;
    envVarName?: string;
    setupInstructions?: string;
}

export const MCP_TEMPLATES: McpServerTemplate[] = [
    // Development Tools
    {
        id: 'github',
        name: 'GitHub',
        description: 'Access GitHub repositories, issues, pull requests, and more',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: '',
        },
        category: 'development',
        requiresApiKey: true,
        envVarName: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        setupInstructions: [
            '1. 访问 https://github.com/settings/tokens',
            '2. 创建新的 Personal Access Token',
            '3. 选择权限: repo, read:user',
            '4. 复制 token 并填入环境变量',
        ].join('\n'),
    },
    {
        id: 'filesystem',
        name: 'Filesystem',
        description: 'Access and manipulate files on your local filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/directory'],
        category: 'filesystem',
        requiresApiKey: false,
        setupInstructions: [
            '1. 修改 args 中的路径为你想要访问的目录',
            '2. 可以指定多个允许的目录路径',
            '例如: ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\Projects", "D:\\\\Documents"]',
        ].join('\n'),
    },

    // Database Services
    {
        id: 'supabase',
        name: 'Supabase',
        description: 'Interact with Supabase databases and services',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-supabase'],
        env: {
            SUPABASE_URL: '',
            SUPABASE_ANON_KEY: '',
        },
        category: 'database',
        requiresApiKey: true,
        envVarName: 'SUPABASE_ANON_KEY',
        setupInstructions: [
            '1. 访问你的 Supabase 项目设置',
            '2. 在 API 设置中找到:',
            '   - Project URL (SUPABASE_URL)',
            '   - anon public key (SUPABASE_ANON_KEY)',
            '3. 填入对应的环境变量',
        ].join('\n'),
    },
    {
        id: 'postgres',
        name: 'PostgreSQL',
        description: 'Connect to PostgreSQL databases',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres'],
        env: {
            POSTGRES_CONNECTION_STRING: '',
        },
        category: 'database',
        requiresApiKey: true,
        envVarName: 'POSTGRES_CONNECTION_STRING',
        setupInstructions: [
            '1. 准备你的 PostgreSQL 连接字符串',
            '2. 格式: postgresql://user:password@host:port/database',
            '3. 填入 POSTGRES_CONNECTION_STRING 环境变量',
        ].join('\n'),
    },

    // Deployment Platforms
    {
        id: 'vercel',
        name: 'Vercel',
        description: 'Deploy and manage Vercel projects',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-vercel'],
        env: {
            VERCEL_API_TOKEN: '',
        },
        category: 'deployment',
        requiresApiKey: true,
        envVarName: 'VERCEL_API_TOKEN',
        setupInstructions: [
            '1. 访问 https://vercel.com/account/tokens',
            '2. 创建新的 API Token',
            '3. 复制 token 并填入 VERCEL_API_TOKEN',
        ].join('\n'),
    },
    {
        id: 'railway',
        name: 'Railway',
        description: 'Manage Railway deployments and services',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-railway'],
        env: {
            RAILWAY_API_TOKEN: '',
        },
        category: 'deployment',
        requiresApiKey: true,
        envVarName: 'RAILWAY_API_TOKEN',
        setupInstructions: [
            '1. 访问 Railway 设置页面',
            '2. 生成新的 API Token',
            '3. 填入 RAILWAY_API_TOKEN 环境变量',
        ].join('\n'),
    },

    // Other Services
    {
        id: 'slack',
        name: 'Slack',
        description: 'Send messages and interact with Slack workspaces',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-slack'],
        env: {
            SLACK_BOT_TOKEN: '',
            SLACK_TEAM_ID: '',
        },
        category: 'other',
        requiresApiKey: true,
        envVarName: 'SLACK_BOT_TOKEN',
        setupInstructions: [
            '1. 创建 Slack App: https://api.slack.com/apps',
            '2. 安装 App 到你的 workspace',
            '3. 获取 Bot User OAuth Token',
            '4. 获取 Team ID (在 workspace 设置中)',
            '5. 填入对应环境变量',
        ].join('\n'),
    },
    {
        id: 'brave-search',
        name: 'Brave Search',
        description: 'Search the web using Brave Search API',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: {
            BRAVE_API_KEY: '',
        },
        category: 'other',
        requiresApiKey: true,
        envVarName: 'BRAVE_API_KEY',
        setupInstructions: [
            '1. 访问 https://brave.com/search/api/',
            '2. 注册并获取 API Key',
            '3. 填入 BRAVE_API_KEY 环境变量',
        ].join('\n'),
    },
    {
        id: 'puppeteer',
        name: 'Puppeteer',
        description: 'Browser automation and web scraping',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-puppeteer'],
        category: 'development',
        requiresApiKey: false,
        setupInstructions: 'Puppeteer 无需配置，可以直接使用进行浏览器自动化。',
    },
    {
        id: 'pencil',
        name: 'Pencil',
        description: 'Design interfaces using Pencil Project',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-pencil'],
        category: 'other',
        requiresApiKey: false,
        setupInstructions: '1. Ensure Pencil Project is installed and running.\n2. The MCP server runs automatically inside Pencil.',
    },
];

/**
 * Get template by ID
 */
export function getTemplate(id: string): McpServerTemplate | undefined {
    return MCP_TEMPLATES.find(t => t.id === id);
}

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: McpServerTemplate['category']): McpServerTemplate[] {
    return MCP_TEMPLATES.filter(t => t.category === category);
}

/**
 * Convert template to MCP server configuration
 */
export function templateToMcpConfig(template: McpServerTemplate, envValues?: Record<string, string>) {
    const env = { ...template.env };

    // Fill in environment variables if provided
    if (envValues) {
        Object.keys(env).forEach(key => {
            if (envValues[key]) {
                env[key] = envValues[key];
            }
        });
    }

    return {
        command: template.command,
        args: template.args || [],
        env: Object.keys(env).length > 0 ? env : undefined,
    };
}

/**
 * Check if template is ready to use (all required env vars are set)
 */
export function isTemplateReady(template: McpServerTemplate, envValues: Record<string, string>): boolean {
    if (!template.requiresApiKey) {
        return true;
    }

    if (!template.env) {
        return true;
    }

    // Check if all required environment variables are provided
    return Object.keys(template.env).every(key => {
        return envValues[key] && envValues[key].trim().length > 0;
    });
}
