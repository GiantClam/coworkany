export type ProfileRole =
    | 'frontend_engineer'
    | 'backend_engineer'
    | 'fullstack_engineer'
    | 'data_engineer'
    | 'designer'
    | 'product_manager'
    | 'qa_engineer'
    | 'devops_engineer'
    | 'general';

export interface DefaultProfile {
    role: ProfileRole;
    label: string;
    prefill: Record<string, string>;
}

export const DEFAULT_PROFILES: DefaultProfile[] = [
    {
        role: 'frontend_engineer',
        label: '前端工程师',
        prefill: {
            主力语言: 'TypeScript, JavaScript',
            前端: 'React, Next.js, Tailwind CSS',
            包管理器: 'pnpm / npm',
            测试习惯: '组件测试 + E2E',
        },
    },
    {
        role: 'backend_engineer',
        label: '后端工程师',
        prefill: {
            主力语言: 'Go, Java, Python',
            后端: 'Gin, Spring Boot, FastAPI',
            数据库: 'PostgreSQL, Redis, MongoDB',
            测试习惯: '单元测试 + 集成测试',
        },
    },
    {
        role: 'fullstack_engineer',
        label: '全栈工程师',
        prefill: {
            主力语言: 'TypeScript, Python',
            前端: 'React, Next.js',
            后端: 'Node.js, FastAPI',
            数据库: 'PostgreSQL, Redis',
        },
    },
    {
        role: 'data_engineer',
        label: '数据工程师',
        prefill: {
            主力语言: 'Python, SQL',
            数据库: 'PostgreSQL, ClickHouse',
            工具: 'Airflow, dbt, Spark',
        },
    },
    {
        role: 'designer',
        label: '设计师',
        prefill: {
            核心领域: 'UI/UX 设计',
            设计工具: 'Figma, Sketch',
            沟通风格: '详细解释',
        },
    },
    {
        role: 'product_manager',
        label: '产品经理',
        prefill: {
            核心领域: '产品规划与协作',
            工具: 'Notion, Jira, 飞书',
            任务处理偏好: '并行多任务',
        },
    },
    {
        role: 'qa_engineer',
        label: '测试工程师',
        prefill: {
            主力语言: 'Python, JavaScript',
            测试习惯: 'TDD',
            调试模式: '日志优先',
        },
    },
    {
        role: 'devops_engineer',
        label: 'DevOps 工程师',
        prefill: {
            主力语言: 'Bash, Python, Go',
            DevOps: 'Docker, Kubernetes, Terraform',
            调试模式: '日志优先',
        },
    },
    {
        role: 'general',
        label: '通用（非技术岗）',
        prefill: {
            沟通风格: '简洁直接',
            是否需要确认再执行: '总是确认',
            任务处理偏好: '串行专注',
        },
    },
];
