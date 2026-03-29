import * as fs from 'fs';
import * as path from 'path';

interface ConsoleLike {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
}

interface SidecarProcessLoggingOptions {
    cwd?: string;
    consoleLike?: ConsoleLike;
    now?: () => Date;
}

export interface SidecarProcessLogging {
    logFile: string;
    closeLogStreamSafely: () => Promise<void>;
}

export function initializeSidecarProcessLogging(
    options: SidecarProcessLoggingOptions = {},
): SidecarProcessLogging {
    const cwd = options.cwd ?? process.cwd();
    const consoleLike = options.consoleLike ?? console;
    const now = options.now ?? (() => new Date());

    const logDir = path.join(cwd, '.coworkany', 'logs');
    try {
        fs.mkdirSync(logDir, { recursive: true });
    } catch {
        // ignore directory creation failures
    }

    const logDate = now().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `sidecar-${logDate}.log`);

    let logStream: fs.WriteStream | null = null;
    try {
        logStream = fs.createWriteStream(logFile, { flags: 'a' });
        logStream.on('error', () => {
            logStream = null;
        });
    } catch {
        // non-critical: continue without file stream
    }

    const writeToLogFile = (level: string, args: unknown[]): void => {
        if (!logStream) return;
        try {
            const ts = now().toISOString();
            const message = args.map((entry) =>
                typeof entry === 'string' ? entry : JSON.stringify(entry)
            ).join(' ');
            logStream.write(`[${ts}] [${level}] ${message}\n`);
        } catch {
            // never crash on log write failure
        }
    };

    const originalError = consoleLike.error.bind(consoleLike);
    const originalWarn = consoleLike.warn.bind(consoleLike);

    consoleLike.log = (...args: unknown[]) => {
        originalError(...args);
        writeToLogFile('LOG', args);
    };
    consoleLike.error = (...args: unknown[]) => {
        originalError(...args);
        writeToLogFile('ERR', args);
    };
    consoleLike.warn = (...args: unknown[]) => {
        originalWarn(...args);
        writeToLogFile('WRN', args);
    };

    const closeLogStreamSafely = async (): Promise<void> => {
        if (!logStream) {
            return;
        }

        const stream = logStream;
        logStream = null;

        await new Promise<void>((resolve) => {
            stream.end(() => resolve());
        });
    };

    return {
        logFile,
        closeLogStreamSafely,
    };
}
