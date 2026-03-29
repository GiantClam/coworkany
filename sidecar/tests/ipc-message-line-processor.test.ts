import { describe, expect, test } from 'bun:test';
import { createMessageLineProcessor } from '../src/ipc/messageLineProcessor';

describe('IPC message line processor', () => {
    test('dispatches valid command lines to command handler', async () => {
        const seen: string[] = [];
        const processLine = createMessageLineProcessor({
            handleCommand: async (command) => {
                seen.push(`cmd:${command.type}`);
            },
            handleResponse: async () => {
                seen.push('response');
            },
            summarizeValidationIssues: () => 'invalid',
            buildInvalidCommandResponse: () => null,
            emitRawIpcResponse: () => {
                seen.push('emit_invalid');
            },
            logDebug: () => {},
            logError: () => {},
        });

        await processLine(
            JSON.stringify({
                id: '11111111-1111-1111-1111-111111111111',
                timestamp: new Date().toISOString(),
                type: 'get_runtime_snapshot',
                payload: {},
            }),
        );

        expect(seen).toEqual(['cmd:get_runtime_snapshot']);
    });

    test('dispatches valid response lines to response handler', async () => {
        const seen: string[] = [];
        const processLine = createMessageLineProcessor({
            handleCommand: async () => {
                seen.push('command');
            },
            handleResponse: async (response) => {
                seen.push(`resp:${response.type}`);
            },
            summarizeValidationIssues: () => 'invalid',
            buildInvalidCommandResponse: () => null,
            emitRawIpcResponse: () => {
                seen.push('emit_invalid');
            },
            logDebug: () => {},
            logError: () => {},
        });

        await processLine(
            JSON.stringify({
                commandId: '22222222-2222-2222-2222-222222222222',
                timestamp: new Date().toISOString(),
                type: 'get_runtime_snapshot_response',
                payload: {
                    success: true,
                    snapshot: {
                        generatedAt: new Date().toISOString(),
                        tasks: [],
                        count: 0,
                    },
                },
            }),
        );

        expect(seen).toEqual(['resp:get_runtime_snapshot_response']);
    });

    test('emits invalid command response when command parse fails with command id', async () => {
        const emitted: Array<Record<string, unknown>> = [];
        const processLine = createMessageLineProcessor({
            handleCommand: async () => {},
            handleResponse: async () => {},
            summarizeValidationIssues: () => 'bad payload',
            buildInvalidCommandResponse: (raw) => {
                const candidate = raw as { id?: string; type?: string };
                if (!candidate.id) return null;
                return {
                    type: `${candidate.type ?? 'unknown'}_response`,
                    commandId: candidate.id,
                    payload: { success: false, error: 'invalid_command: bad payload' },
                };
            },
            emitRawIpcResponse: (message) => {
                emitted.push(message);
            },
            logDebug: () => {},
            logError: () => {},
        });

        await processLine(
            JSON.stringify({
                id: 'cmd-invalid',
                timestamp: new Date().toISOString(),
                type: 'start_task',
                payload: {
                    taskId: 123,
                },
            }),
        );

        expect(emitted.length).toBe(1);
        expect(emitted[0]?.commandId).toBe('cmd-invalid');
    });

    test('ignores malformed JSON safely', async () => {
        const seen: string[] = [];
        const processLine = createMessageLineProcessor({
            handleCommand: async () => {
                seen.push('command');
            },
            handleResponse: async () => {
                seen.push('response');
            },
            summarizeValidationIssues: () => 'invalid',
            buildInvalidCommandResponse: () => null,
            emitRawIpcResponse: () => {
                seen.push('emit_invalid');
            },
            logDebug: () => {},
            logError: () => {
                seen.push('error');
            },
        });

        await processLine('{bad-json');
        expect(seen).toContain('error');
        expect(seen).not.toContain('command');
        expect(seen).not.toContain('response');
    });
});
