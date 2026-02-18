import type { IpcCommand, IpcResponse, TaskEvent } from '../protocol';
import {
    handleRecordAgentDelegation,
    handleRegisterAgentIdentity,
    handleReportMcpGatewayDecision,
    handleReportRuntimeSecurityAlert,
    type HandlerContext,
    type HandlerResult,
    type AgentIdentityRegistry,
} from './identity_security';
import { handleReloadTools } from './tools';
import { handleGetTasks } from './core_skills';
import { SkillStore } from '../storage';
import type { ToolDefinition } from '../tools/standard';

export type CommandDispatchResult = HandlerResult<IpcResponse> | null;

export type CommandRouterDeps = {
    registry: AgentIdentityRegistry;
    skillStore: SkillStore;
    contextFor: (taskId?: string) => HandlerContext;
    enhancedBrowserTools?: ToolDefinition[];
    selfLearningTools?: ToolDefinition[];
    databaseTools?: ToolDefinition[];
    generatedRuntimeTools?: ToolDefinition[];
};

export function dispatchCommand(command: IpcCommand, deps: CommandRouterDeps): CommandDispatchResult {
    const payload = command.payload as Record<string, unknown> | undefined;
    const taskId = payload && 'taskId' in payload ? String(payload.taskId) : undefined;
    const ctx = deps.contextFor(taskId);

    switch (command.type) {
        case 'register_agent_identity':
            return handleRegisterAgentIdentity(command, ctx, deps.registry);
        case 'record_agent_delegation':
            return handleRecordAgentDelegation(command, ctx, deps.registry);
        case 'report_mcp_gateway_decision':
            return handleReportMcpGatewayDecision(command, ctx);
        case 'report_runtime_security_alert':
            return handleReportRuntimeSecurityAlert(command, ctx);
        case 'reload_tools':
            return handleReloadTools(command, ctx, {
                skillStore: deps.skillStore,
                enhancedBrowserTools: deps.enhancedBrowserTools,
                selfLearningTools: deps.selfLearningTools,
                databaseTools: deps.databaseTools,
                generatedRuntimeTools: deps.generatedRuntimeTools,
            });
        case 'get_tasks':
            return handleGetTasks(command as any, ctx);
        default:
            return null;
    }
}
