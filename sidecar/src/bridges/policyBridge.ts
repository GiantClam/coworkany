import { EffectRequest, EffectResponse, EffectType, EffectSource } from '../protocol';
export interface PolicyBridgeConfig {
    sendCommand: (command: string, payload: unknown) => Promise<unknown>;
    confirmationTimeoutMs?: number;
}
export interface ConfirmationResult {
    approved: boolean;
    approvalType?: EffectResponse['approvalType'];
    reason?: string;
}
export class PolicyBridge {
    private config: Required<PolicyBridgeConfig>;
    private pendingConfirmations = new Map<
        string,
        {
            resolve: (result: ConfirmationResult) => void;
            reject: (error: Error) => void;
        }
    >();
    constructor(config: PolicyBridgeConfig) {
        this.config = {
            sendCommand: config.sendCommand,
            confirmationTimeoutMs: config.confirmationTimeoutMs ?? 300000, // 5 min default
        };
    }
    async requestEffect(request: EffectRequest): Promise<EffectResponse> {
        console.log(`[PolicyBridge] Requesting effect: ${request.id} (${request.effectType})`);
        try {
            const response = (await this.config.sendCommand(
                'request_effect',
                request
            )) as EffectResponse;
            if (
                !response.approved &&
                response.denialReason === 'awaiting_confirmation'
            ) {
                console.log(`[PolicyBridge] Awaiting user confirmation for: ${request.id}`);
                return this.waitForConfirmation(request.id);
            }
            return response;
        } catch (error) {
            console.error(`[PolicyBridge] Error requesting effect:`, error);
            throw error;
        }
    }
    handleConfirmation(
        requestId: string,
        approved: boolean,
        approvalType?: EffectResponse['approvalType']
    ): void {
        const pending = this.pendingConfirmations.get(requestId);
        if (pending) {
            pending.resolve({ approved, approvalType });
            this.pendingConfirmations.delete(requestId);
        }
    }
    handleDenial(requestId: string, reason?: string): void {
        const pending = this.pendingConfirmations.get(requestId);
        if (pending) {
            pending.resolve({ approved: false, reason });
            this.pendingConfirmations.delete(requestId);
        }
    }
    private async waitForConfirmation(requestId: string): Promise<EffectResponse> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingConfirmations.delete(requestId);
                reject(new Error(`Confirmation timeout for ${requestId}`));
            }, this.config.confirmationTimeoutMs);
            this.pendingConfirmations.set(requestId, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve({
                        requestId,
                        timestamp: new Date().toISOString(),
                        approved: result.approved,
                        approvalType: result.approvalType ?? (result.approved ? 'once' : undefined),
                        denialReason: result.reason,
                    });
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });
        });
    }
}
export function createStdioPolicyBridge(): PolicyBridge {
    return new PolicyBridge({
        sendCommand: async (command, payload) => {
            const ipcCommand = {
                type: command,
                payload,
                timestamp: new Date().toISOString(),
            };
            console.log(JSON.stringify(ipcCommand));
            return { awaiting: true };
        },
    });
}
export function createFilesystemWriteRequest(
    id: string,
    path: string,
    operation: 'write' | 'create' | 'delete',
    source: EffectSource,
    options?: {
        sourceId?: string;
        taskId?: string;
        reasoning?: string;
    }
): EffectRequest {
    return {
        id,
        timestamp: new Date().toISOString(),
        effectType: 'filesystem:write',
        source,
        sourceId: options?.sourceId,
        payload: {
            path,
            operation,
        },
        context: options?.taskId
            ? {
                taskId: options.taskId,
                reasoning: options.reasoning,
            }
            : undefined,
    };
}
export function createShellWriteRequest(
    id: string,
    command: string,
    source: EffectSource,
    options?: {
        sourceId?: string;
        taskId?: string;
        cwd?: string;
        args?: string[];
        reasoning?: string;
    }
): EffectRequest {
    return {
        id,
        timestamp: new Date().toISOString(),
        effectType: 'shell:write',
        source,
        sourceId: options?.sourceId,
        payload: {
            command,
            args: options?.args,
            cwd: options?.cwd,
        },
        context: options?.taskId
            ? {
                taskId: options.taskId,
                reasoning: options.reasoning,
            }
            : undefined,
    };
}
