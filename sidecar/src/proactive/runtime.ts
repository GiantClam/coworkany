import * as path from 'path';
import { createHeartbeatEngine, type HeartbeatEngine, type ProactiveTaskExecutor } from './heartbeat';

type ExecutorFactory = (workspacePath: string) => ProactiveTaskExecutor;

const engines = new Map<string, HeartbeatEngine>();

let executorFactory: ExecutorFactory = () => ({
    executeTask: async () => ({
        success: false,
        error: 'Heartbeat executor is not initialized.',
    }),
    runSkill: async () => ({
        success: false,
        error: 'Heartbeat skill runner is not initialized.',
    }),
    notify: async () => {},
});

export function setHeartbeatExecutorFactory(factory: ExecutorFactory): void {
    executorFactory = factory;
}

export function getHeartbeatEngine(workspacePath: string): HeartbeatEngine {
    const normalizedWorkspace = path.resolve(workspacePath);
    const existing = engines.get(normalizedWorkspace);
    if (existing) {
        return existing;
    }

    const configPath = path.join(normalizedWorkspace, '.coworkany', 'triggers.json');
    const engine = createHeartbeatEngine({
        executor: executorFactory(normalizedWorkspace),
        configPath,
    });
    engine.start();
    engines.set(normalizedWorkspace, engine);
    return engine;
}

export function shutdownHeartbeatEngines(): void {
    for (const engine of engines.values()) {
        engine.stop();
    }
    engines.clear();
}
