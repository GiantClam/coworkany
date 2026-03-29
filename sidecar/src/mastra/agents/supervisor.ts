import { Agent } from '@mastra/core/agent';
import { coworker } from './coworker';
import { researcher } from './researcher';
import { coder } from './coder';
import { memoryConfig } from '../memory/config';

const DEFAULT_MODEL = process.env.COWORKANY_MODEL || 'anthropic/claude-sonnet-4-5';

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
});
