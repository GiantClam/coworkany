import { describe, expect, test } from 'bun:test';
import {
    formatTaskFailureDetails,
    getTaskFailureUiDescriptor,
    normalizeTaskFailureErrorMessage,
} from '../src/lib/taskFailureUi';

describe('task failure UI formatter', () => {
    test('includes error, error code, failure class, and suggestion in readable order', () => {
        const text = formatTaskFailureDetails(
            {
                error: 'Approval resume failed: runId missing',
                errorCode: 'E_APPROVAL_RESUME_FAILED',
                failureClass: 'retryable',
                recoverable: true,
                suggestion: 'Retry the task, then approve again if required.',
            },
            {
                fallbackDescription: 'Execution failed unexpectedly.',
                includePrefix: true,
            },
        );

        expect(text).toContain('Task failed: Approval resume failed: runId missing');
        expect(text).toContain('Error code: E_APPROVAL_RESUME_FAILED');
        expect(text).toContain('Temporary upstream issue');
        expect(text).toContain('Retry the task, then approve again if required.');
    });

    test('falls back to default description and recoverable hint when failure payload is sparse', () => {
        const text = formatTaskFailureDetails(
            {
                error: '',
                recoverable: true,
            },
            {
                fallbackDescription: 'Execution failed unexpectedly.',
                includePrefix: true,
            },
        );

        expect(text).toContain('Execution failed unexpectedly.');
        expect(text).toContain('This task can be retried from the current state.');
    });

    test('renders missing tool evidence failure as readable retryable guidance', () => {
        const descriptor = getTaskFailureUiDescriptor({
            status: 'failed',
            suspension: null,
            failure: {
                error: 'workflow_missing_required_tool_evidence:command_execution',
                errorCode: 'E_PROTOCOL_MISSING_TOOL_EVIDENCE',
                recoverable: true,
                suggestion: 'Retry this task and ensure required tools are invoked before completion.',
            },
        });

        expect(descriptor?.category).toBe('retryable');
        expect(descriptor?.action).toBe('retry');
        expect(descriptor?.titleDefault).toBe('Execution steps were not run');
        expect(descriptor?.descriptionDefault).toContain('did not execute required tools');
    });

    test('normalizes structured escaped JSON errors into readable text', () => {
        const raw = String.raw`'{"message":"Failed to connect to MCP server e2e-user-server: McpError: MCP error -32000: Connection closed\n    at Function.fromError (...)","code":"MCP_CLIENT_CONNECT_FAILED","details":{"name":"e2e-user-server"},"cause":{"message":"MCP error -32000: Connection closed"}}'`;
        const text = normalizeTaskFailureErrorMessage(raw);
        expect(text).toContain('Failed to connect to MCP server e2e-user-server');
        expect(text).toContain('cause: MCP error -32000: Connection closed');
        expect(text).toContain('server: e2e-user-server');
        expect(text).not.toContain('\\n');
    });

    test('drops stack frames from Error-prefixed task failures', () => {
        const text = normalizeTaskFailureErrorMessage(
            'Error: stream_idle_timeout:60000\\n    at consumeStream (streaming.ts:1:2)'
        );
        expect(text).toBe('stream_idle_timeout:60000');
    });
});
