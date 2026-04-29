export type ToolEffect =
    | 'filesystem:read'
    | 'filesystem:write'
    | 'filesystem:delete'
    | 'network:outbound'
    | 'process:spawn'
    | 'ui:notify'
    | 'state:remember'
    | 'code:execute'
    | 'code:execute:sandbox'
    | 'knowledge:read'
    | 'knowledge:update';

export type ToolContext = {
    workspacePath: string;
    taskId: string;
    onCancel?: (waiter: (reason: string) => void) => (() => void);
};

export type ToolDefinition = {
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
    effects: ToolEffect[];
    handler: (args: any, context: ToolContext) => Promise<any>;
};
