import { Mastra } from '@mastra/core';
import type { LogLevel } from '@mastra/loggers';
import { PinoLogger } from '@mastra/loggers';
import { createRequire } from 'node:module';
import { coworker } from './agents/coworker';
import { supervisor } from './agents/supervisor';
import { researcher } from './agents/researcher';
import { coder } from './agents/coder';
import { memoryConfig, memoryStorage } from './memory/config';
import { runtimeScorerRegistry } from './scorers/runtime';
import { controlPlaneWorkflow, scheduledTaskWorkflow } from './workflows';

const logLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
const require = createRequire(import.meta.url);

function readPackageVersion(packageName: string): string | null {
    try {
        const pkg = require(`${packageName}/package.json`) as { version?: string };
        return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : null;
    } catch {
        return null;
    }
}

function resolveMastraPackageVersions(): Record<string, string | null> {
    return {
        core: readPackageVersion('@mastra/core'),
        memory: readPackageVersion('@mastra/memory'),
        mcp: readPackageVersion('@mastra/mcp'),
        libsql: readPackageVersion('@mastra/libsql'),
        loggers: readPackageVersion('@mastra/loggers'),
    };
}
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
    scorers: runtimeScorerRegistry,
    memory: {
        default: memoryConfig,
    },
});
export function getMastraHealth(): {
    agents: string[];
    workflows: string[];
    storageConfigured: boolean;
    mastraPackages: Record<string, string | null>;
} {
    return {
        agents: Object.keys(mastra.listAgents()),
        workflows: Object.keys(mastra.listWorkflows()),
        storageConfigured: Boolean(mastra.getStorage()),
        mastraPackages: resolveMastraPackageVersions(),
    };
}
