import { IpcCommandSchema, IpcResponseSchema, type IpcCommand, type IpcResponse } from '../protocol';
import type { ValidationErrorLike } from './commandValidation';

type ZodValidationErrorLike = ValidationErrorLike & {
    format: () => unknown;
};

export type MessageLineProcessorDeps = {
    handleCommand: (command: IpcCommand) => Promise<void>;
    handleResponse: (response: IpcResponse) => Promise<void>;
    summarizeValidationIssues: (error: ValidationErrorLike) => string;
    buildInvalidCommandResponse: (raw: unknown, details: string) => Record<string, unknown> | null;
    emitRawIpcResponse: (message: Record<string, unknown>) => void;
    logDebug: (...args: unknown[]) => void;
    logError: (...args: unknown[]) => void;
};

export function createMessageLineProcessor(deps: MessageLineProcessorDeps) {
    return async function processLine(line: string): Promise<void> {
        const trimmed = line.trim();
        if (!trimmed) return;

        deps.logDebug('[DEBUG] Received line:', trimmed.substring(0, 200));

        try {
            const raw = JSON.parse(trimmed);
            deps.logDebug('[DEBUG] Parsed JSON, type:', (raw as { type?: unknown })?.type);

            const commandResult = IpcCommandSchema.safeParse(raw);
            if (commandResult.success) {
                deps.logDebug('[DEBUG] Valid command, handling:', commandResult.data.type);
                await deps.handleCommand(commandResult.data);
                return;
            }

            deps.logDebug(
                '[DEBUG] Command parse failed:',
                JSON.stringify(commandResult.error.format()).substring(0, 500),
            );
            const details = deps.summarizeValidationIssues(commandResult.error as ZodValidationErrorLike);
            const response = deps.buildInvalidCommandResponse(raw, details);
            if (response) {
                deps.emitRawIpcResponse(response);
            }

            const responseResult = IpcResponseSchema.safeParse(raw);
            if (responseResult.success) {
                deps.logDebug('[DEBUG] Valid response, handling:', responseResult.data.type);
                await deps.handleResponse(responseResult.data);
                return;
            }

            deps.logError('[ERROR] Invalid message:', (commandResult.error as ZodValidationErrorLike).format());
        } catch (error) {
            deps.logError('[ERROR] Failed to parse JSON:', error);
        }
    };
}
