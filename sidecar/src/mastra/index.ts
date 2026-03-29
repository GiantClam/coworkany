import { Mastra } from '@mastra/core';
import type { LogLevel } from '@mastra/loggers';
import { PinoLogger } from '@mastra/loggers';
import { coworker } from './agents/coworker';
import { supervisor } from './agents/supervisor';
import { researcher } from './agents/researcher';
import { coder } from './agents/coder';
import { memoryConfig, memoryStorage } from './memory/config';
import { controlPlaneWorkflow, scheduledTaskWorkflow } from './workflows';

const logLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';

export const mastra = new Mastra({
    storage: memoryStorage,
    logger: new PinoLogger({
        name: 'CoworkAny',
        level: logLevel,
    }),
    agents: {
        coworker,
        supervisor,
        researcher,
        coder,
    },
    workflows: {
        controlPlane: controlPlaneWorkflow,
        scheduledTask: scheduledTaskWorkflow,
    },
    memory: {
        default: memoryConfig,
    },
});

export function getMastraHealth(): {
    agents: string[];
    workflows: string[];
    storageConfigured: boolean;
} {
    return {
        agents: Object.keys(mastra.listAgents()),
        workflows: Object.keys(mastra.listWorkflows()),
        storageConfigured: Boolean(mastra.getStorage()),
    };
}
