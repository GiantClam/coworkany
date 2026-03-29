import * as os from 'os';
import * as path from 'path';

export interface SingletonConfig {
    enabled: boolean;
    socketPath?: string;
    lockPath?: string;
}

export function matchesEnabledFlag(value?: string): boolean {
    if (!value) return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function deriveSingletonConfig(
    env: NodeJS.ProcessEnv = process.env,
    tmpDir: string = os.tmpdir(),
): SingletonConfig {
    const socketPath = env.COWORKANY_SIDECAR_SOCKET_PATH?.trim() || undefined;
    const enabled = matchesEnabledFlag(env.COWORKANY_SIDECAR_SINGLETON);
    const lockPath = socketPath
        ? path.join(
            tmpDir,
            `coworkany-sidecar-${Buffer.from(socketPath).toString('hex').slice(0, 24)}.lock`,
        )
        : undefined;

    return {
        enabled,
        socketPath,
        lockPath,
    };
}
