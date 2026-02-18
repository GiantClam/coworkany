/**
 * Policy Bridge
 *
 * IPC bridge between Sidecar and Tauri Rust PolicyEngine.
 * Sends effect requests and waits for approval/denial from UI.
 */

import { EffectRequest, EffectResponse, EffectType, EffectSource } from '../protocol';

// ============================================================================
// Types
// ============================================================================

export interface PolicyBridgeConfig {
    /**
     * Function to send IPC commands to Tauri.
     * This is injected to allow different transport mechanisms.
     */
    sendCommand: (command: string, payload: unknown) => Promise<unknown>;

    /**
     * Timeout for waiting for user confirmation (ms)
     */
    confirmationTimeoutMs?: number;
}

export interface ConfirmationResult {
    approved: boolean;
    remember?: boolean;
    reason?: string;
}

// ============================================================================
// Policy Bridge
// ============================================================================

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

    /**
     * Request effect approval from PolicyEngine.
     * Returns immediately if auto-approved/denied.
     * Waits for user confirmation if required.
     */
    async requestEffect(request: EffectRequest): Promise<EffectResponse> {
        console.log(`[PolicyBridge] Requesting effect: ${request.id} (${request.effectType})`);

        try {
            const response = (await this.config.sendCommand(
                'request_effect',
                request
            )) as EffectResponse;

            // Check if awaiting confirmation
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

    /**
     * Called when user confirms an effect (from event listener).
     */
    handleConfirmation(requestId: string, approved: boolean, remember?: boolean): void {
        const pending = this.pendingConfirmations.get(requestId);
        if (pending) {
            pending.resolve({ approved, remember });
            this.pendingConfirmations.delete(requestId);
        }
    }

    /**
     * Called when user denies an effect (from event listener).
     */
    handleDenial(requestId: string, reason?: string): void {
        const pending = this.pendingConfirmations.get(requestId);
        if (pending) {
            pending.resolve({ approved: false, reason });
            this.pendingConfirmations.delete(requestId);
        }
    }

    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------

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
                        approvalType: result.remember ? 'session' : 'once',
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

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a PolicyBridge that communicates via stdout/stdin IPC.
 * This is the default for sidecar running under Tauri.
 */
export function createStdioPolicyBridge(): PolicyBridge {
    return new PolicyBridge({
        sendCommand: async (command, payload) => {
            // Send command via stdout (Tauri will receive and process)
            const ipcCommand = {
                type: command,
                payload,
                timestamp: new Date().toISOString(),
            };
            console.log(JSON.stringify(ipcCommand));

            // Note: Response comes back via event, not return value
            // The IPC protocol is async, handled by handleConfirmation/handleDenial
            return { awaiting: true };
        },
    });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create an EffectRequest for filesystem write.
 */
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

/**
 * Create an EffectRequest for shell command.
 */
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
