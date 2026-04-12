import { Agent } from '@mastra/core/agent';
import { memoryConfig } from '../memory/config';
import { listMcpToolsSafe } from '../mcp/clients';
import { deleteFilesTool, sendEmailTool } from '../tools/approval-tools';
import { bashTool, bashApprovalTool } from '../tools/bash';
import { enterpriseTools } from '../tools/enterprise';
import { guardrailInputProcessors, guardrailOutputProcessors } from '../guardrails/processors';
import { runtimeScorers } from '../scorers/runtime';
import { getWorkspaceForRequestContext } from '../workspace/runtime';
import { resolveRuntimeModelConfig } from '../model/runtimeModel';
const DEFAULT_MODEL = resolveRuntimeModelConfig();
export const coworker = new Agent({
    id: 'coworker',
    name: 'CoworkAny Assistant',
    description: 'Enterprise-grade digital coworker for personal and team tasks.',
    instructions: [
        '你是企业员工的个人 AI 助手。',
        '核心原则: 先规划后执行；低风险自动执行；高风险必须请求审批。',
        '执行策略: CLI-First，优先使用 bash / bash_approval。',
        '安全策略: 禁止危险命令；删除、发邮件、安装软件等操作必须审批。',
        '遇到关机/重启/系统控制类请求时，不要只给说明，必须触发工具执行链路（run_command/bash_approval）以进入审批流程。',
    ].join('\n'),
    model: DEFAULT_MODEL,
    memory: memoryConfig,
    tools: async () => {
        const mcpTools = await listMcpToolsSafe();
        return {
            bash: bashTool,
            bash_approval: bashApprovalTool,
            delete_files: deleteFilesTool,
            send_email: sendEmailTool,
            ...enterpriseTools,
            ...mcpTools,
        };
    },
    workspace: async ({ requestContext }) => {
        return await getWorkspaceForRequestContext(requestContext);
    },
    defaultOptions: {
        requireToolApproval: false,
        autoResumeSuspendedTools: false,
        toolCallConcurrency: 1,
        maxSteps: 16,
        inputProcessors: guardrailInputProcessors,
        outputProcessors: guardrailOutputProcessors,
        scorers: runtimeScorers,
    },
});
