import { describe, expect, test } from 'bun:test';
import {
    extractMastraFinalAssistantTextEvent,
    extractMastraTokenUsageEvent,
    mapMastraChunkToDesktopEvent,
} from '../src/ipc/bridge';

describe('mastra bridge mapping', () => {
    test('maps payload text-delta events', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'text-delta',
            payload: {
                text: 'hello',
            },
        }, 'run-1');

        expect(event).toEqual({
            type: 'text_delta',
            runId: 'run-1',
            content: 'hello',
            role: 'assistant',
        });
    });

    test('maps direct text-delta events without payload wrapper', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'text-delta',
            text: 'hi',
        }, 'run-2');

        expect(event).toEqual({
            type: 'text_delta',
            runId: 'run-2',
            content: 'hi',
            role: 'assistant',
        });
    });

    test('maps textDelta payload fields from ai sdk v6', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'text-delta',
            payload: {
                textDelta: 'hello-v6',
            },
        }, 'run-2b');

        expect(event).toEqual({
            type: 'text_delta',
            runId: 'run-2b',
            content: 'hello-v6',
            role: 'assistant',
        });
    });

    test('maps reasoning chunks to thinking role', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'reasoning',
            payload: {
                textDelta: 'reasoning text',
            },
        }, 'run-2c');

        expect(event).toEqual({
            type: 'text_delta',
            runId: 'run-2c',
            content: 'reasoning text',
            role: 'thinking',
        });
    });

    test('extracts token usage from finish payload', () => {
        const event = extractMastraTokenUsageEvent({
            type: 'finish',
            payload: {
                usage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                },
                response: {
                    modelId: 'anthropic/claude-sonnet-4-5',
                },
            },
        }, 'run-3');

        expect(event).toMatchObject({
            type: 'token_usage',
            runId: 'run-3',
            modelId: 'anthropic/claude-sonnet-4-5',
            provider: 'anthropic',
            usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
            },
        });
    });

    test('extracts token usage from step-finish prompt/completion fields', () => {
        const event = extractMastraTokenUsageEvent({
            type: 'step-finish',
            usage: {
                promptTokens: 4,
                completionTokens: 6,
                totalTokens: 10,
            },
            response: {
                model: 'openai/gpt-4.1',
            },
        }, 'run-4');

        expect(event).toMatchObject({
            type: 'token_usage',
            runId: 'run-4',
            modelId: 'openai/gpt-4.1',
            provider: 'openai',
            usage: {
                inputTokens: 4,
                outputTokens: 6,
                totalTokens: 10,
            },
        });
    });

    test('maps tripwire events with reason and processor metadata', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tripwire',
            payload: {
                reason: 'prompt_injection_detected',
                retry: false,
                processorId: 'prompt-injection-detector',
                metadata: {
                    severity: 'high',
                },
            },
        }, 'run-5');

        expect(event).toEqual({
            type: 'tripwire',
            runId: 'run-5',
            reason: 'prompt_injection_detected',
            retry: false,
            processorId: 'prompt-injection-detector',
            metadata: {
                severity: 'high',
            },
        });
    });

    test('extracts finish response text as fallback assistant event', () => {
        const event = extractMastraFinalAssistantTextEvent({
            type: 'finish',
            payload: {
                response: {
                    uiMessages: [
                        {
                            parts: [{ text: 'final response from uiMessages' }],
                        },
                    ],
                },
            },
        }, 'run-6');

        expect(event).toEqual({
            type: 'text_delta',
            runId: 'run-6',
            role: 'assistant',
            content: 'final response from uiMessages',
        });
    });

    test('maps agent-execution-event-* wrapper approval chunks', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'agent-execution-event-tool-call-approval',
            payload: {
                toolCallId: 'call-agent-wrapper',
                toolName: 'agent-researcher',
                args: { prompt: 'wrapped approval' },
                resumeSchema: '{"type":"object"}',
            },
        }, 'run-7');

        expect(event).toEqual({
            type: 'approval_required',
            runId: 'run-7',
            toolCallId: 'call-agent-wrapper',
            toolName: 'agent-researcher',
            args: { prompt: 'wrapped approval' },
            resumeSchema: '{"type":"object"}',
        });
    });

    test('maps tool input available chunks as tool_call events', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tool-input-available',
            payload: {
                name: 'search_web',
                input: { query: 'coworkany' },
                id: 'tool-call-1',
            },
        }, 'run-8');

        expect(event).toEqual({
            type: 'tool_call',
            runId: 'run-8',
            toolName: 'search_web',
            args: { query: 'coworkany' },
        });
    });

    test('maps tool result aliases without explicit toolCallId', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tool-result',
            payload: {
                name: 'search_web',
                output: { items: [{ title: 'result' }] },
                success: true,
            },
        }, 'run-9');

        expect(event).toEqual({
            type: 'tool_result',
            runId: 'run-9',
            toolCallId: 'unknown:search_web',
            toolName: 'search_web',
            result: { items: [{ title: 'result' }] },
            isError: false,
        });
    });

    test('marks workspace execute command result as error when stderr-like output reports ffmpeg encoder failure', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tool-result',
            payload: {
                name: 'mastra_workspace_execute_command',
                toolCallId: 'call-cmd-ffmpeg',
                result: [
                    '[libx264 @ 0x714c99180] width not divisible by 2 (1x1)',
                    '[vost#0:0/libx264 @ 0x715044000] Error while opening encoder - maybe incorrect parameters',
                ].join('\n'),
            },
        }, 'run-9b');

        expect(event).toEqual({
            type: 'tool_result',
            runId: 'run-9b',
            toolCallId: 'call-cmd-ffmpeg',
            toolName: 'mastra_workspace_execute_command',
            result: [
                '[libx264 @ 0x714c99180] width not divisible by 2 (1x1)',
                '[vost#0:0/libx264 @ 0x715044000] Error while opening encoder - maybe incorrect parameters',
            ].join('\n'),
            isError: true,
        });
    });

    test('marks workspace execute command result as error when non-zero exitCode is returned', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tool-result',
            payload: {
                name: 'mastra_workspace_execute_command',
                toolCallId: 'call-cmd-exit',
                result: {
                    stdout: '',
                    stderr: 'ffmpeg failed',
                    exitCode: 1,
                },
            },
        }, 'run-9c');

        expect(event).toEqual({
            type: 'tool_result',
            runId: 'run-9c',
            toolCallId: 'call-cmd-exit',
            toolName: 'mastra_workspace_execute_command',
            result: {
                stdout: '',
                stderr: 'ffmpeg failed',
                exitCode: 1,
            },
            isError: true,
        });
    });

    test('marks workspace execute command result as error even when success=true but stderr-like output reports failure', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tool-result',
            payload: {
                name: 'mastra_workspace_execute_command',
                toolCallId: 'call-cmd-success-flagged',
                success: true,
                result: 'Error opening input file slideshow_input.txt\nExit code: 254',
            },
        }, 'run-9d');

        expect(event).toEqual({
            type: 'tool_result',
            runId: 'run-9d',
            toolCallId: 'call-cmd-success-flagged',
            toolName: 'mastra_workspace_execute_command',
            result: 'Error opening input file slideshow_input.txt\nExit code: 254',
            isError: true,
        });
    });

    test('marks workspace execute command result as error when failure text is nested in stdout payload fields', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tool-result',
            payload: {
                name: 'mastra_workspace_execute_command',
                toolCallId: 'call-cmd-stdout-failure',
                success: true,
                result: {
                    stdout: 'Error opening input file slideshow_input.txt\nExit code: 254',
                    stderr: '',
                },
            },
        }, 'run-9e');

        expect(event).toEqual({
            type: 'tool_result',
            runId: 'run-9e',
            toolCallId: 'call-cmd-stdout-failure',
            toolName: 'mastra_workspace_execute_command',
            result: {
                stdout: 'Error opening input file slideshow_input.txt\nExit code: 254',
                stderr: '',
            },
            isError: true,
        });
    });

    test('maps tool-output-error chunks as failed tool_result events', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'tool-output-error',
            payload: {
                toolName: 'voice_speak',
                toolCallId: 'call-voice-1',
                error: { message: 'tts unavailable' },
            },
        }, 'run-10');

        expect(event).toEqual({
            type: 'tool_result',
            runId: 'run-10',
            toolCallId: 'call-voice-1',
            toolName: 'voice_speak',
            result: { message: 'tts unavailable' },
            isError: true,
        });
    });

    test('maps agent-start lifecycle chunks as agent_task_notification tool_call', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'agent-execution-event-agent-start',
            payload: {
                agentId: 'agent-123',
                summary: 'Agent task started',
            },
        }, 'run-11');

        expect(event).toEqual({
            type: 'tool_call',
            runId: 'run-11',
            toolName: 'agent_task_notification',
            args: {
                taskId: 'agent-123',
                status: 'running',
                summary: 'Agent task started',
                xml: `<task-notification>
<task-id>agent-123</task-id>
<status>running</status>
<summary>Agent task started</summary>
</task-notification>`,
            },
        });
    });

    test('maps agent-finish lifecycle chunks as agent_task_notification tool_result', () => {
        const event = mapMastraChunkToDesktopEvent({
            type: 'agent-execution-event-agent-finish',
            payload: {
                taskId: 'agent-a1b',
                summary: 'Agent completed auth investigation',
                result: 'Found issue in src/auth/validate.ts:42',
                usage: {
                    total_tokens: 118,
                    tool_uses: 2,
                    duration_ms: 540,
                },
            },
        }, 'run-12');

        expect(event).toEqual({
            type: 'tool_result',
            runId: 'run-12',
            toolCallId: 'agent-task:agent-a1b',
            toolName: 'agent_task_notification',
            result: {
                taskId: 'agent-a1b',
                status: 'completed',
                summary: 'Agent completed auth investigation',
                result: 'Found issue in src/auth/validate.ts:42',
                usage: {
                    totalTokens: 118,
                    toolUses: 2,
                    durationMs: 540,
                },
                xml: `<task-notification>
<task-id>agent-a1b</task-id>
<status>completed</status>
<summary>Agent completed auth investigation</summary>
<result>Found issue in src/auth/validate.ts:42</result>
<usage><total_tokens>118</total_tokens><tool_uses>2</tool_uses><duration_ms>540</duration_ms></usage>
</task-notification>`,
            },
            isError: false,
        });
    });
});
