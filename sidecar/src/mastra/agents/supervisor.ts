import { Agent } from '@mastra/core/agent';
import { coworker } from './coworker';
import { researcher } from './researcher';
import { coder } from './coder';
import { memoryConfig } from '../memory/config';

const DEFAULT_MODEL = process.env.COWORKANY_MODEL || 'anthropic/claude-sonnet-4-5';
const UNSAFE_DELEGATION_PATTERNS: RegExp[] = [
    /\brm\s+-rf\b/i,
    /\bsudo\b/i,
    /\bdrop\s+table\b/i,
    /\bcurl\b[^\n|]*\|\s*(sh|bash)\b/i,
];

function containsUnsafeDelegationPrompt(prompt: string): boolean {
    return UNSAFE_DELEGATION_PATTERNS.some((pattern) => pattern.test(prompt));
}

export const supervisor = new Agent({
    id: 'supervisor',
    name: 'Supervisor',
    description: 'Routes tasks to specialized agents and keeps execution aligned.',
    instructions: [
        'You are the task supervisor of CoworkAny.',
        'Delegate research tasks to researcher, coding tasks to coder, and mixed tasks to coworker.',
        'Maintain safety and ask for approvals on destructive or external side-effect actions.',
    ].join('\n'),
    model: DEFAULT_MODEL,
    memory: memoryConfig,
    agents: {
        coworker,
        researcher,
        coder,
    },
    defaultOptions: {
        requireToolApproval: true,
        autoResumeSuspendedTools: true,
        toolCallConcurrency: 1,
        maxSteps: 20,
        delegation: {
            onDelegationStart: ({ prompt, primitiveId }) => {
                if (containsUnsafeDelegationPrompt(prompt)) {
                    return {
                        proceed: false,
                        rejectionReason: `Delegation blocked by safety policy for ${primitiveId}.`,
                    };
                }
                return {
                    modifiedInstructions: [
                        'Always keep side effects bounded and auditable.',
                        'For write/delete/network-affecting actions, use tools that trigger approval.',
                    ].join(' '),
                };
            },
            onDelegationComplete: ({ primitiveId, success, result }) => {
                if (!success) {
                    return {
                        feedback: `Delegation to ${primitiveId} failed. Retry with a narrower, safer plan.`,
                    };
                }
                if (result.text.trim().length === 0) {
                    return {
                        feedback: `Delegation to ${primitiveId} returned empty output. Provide a concrete summary.`,
                    };
                }
                return undefined;
            },
            messageFilter: ({ messages }) => messages.slice(-20),
        },
        onIterationComplete: ({ iteration, toolCalls, text, isFinal }) => {
            if (isFinal) {
                return undefined;
            }
            if (iteration >= 10 && toolCalls.length === 0 && text.trim().length < 20) {
                return {
                    continue: false,
                    feedback: 'No meaningful progress detected. Stop and provide current findings plus blockers.',
                };
            }
            return undefined;
        },
    },
});
