let bootLogEmitted = false;
let minimalConsoleInstalled = false;
const originalConsole = {
    info: console.info.bind(console),
    error: console.error.bind(console),
};

type BootLogPayload = {
    runtime: 'tauri' | 'web';
    windowLabel: string;
    startupProfile?: string;
};

export function emitBootJsonLog(payload: BootLogPayload): void {
    if (bootLogEmitted) {
        return;
    }

    bootLogEmitted = true;
    originalConsole.info(JSON.stringify({
        app: 'coworkany-desktop',
        event: 'boot',
        ts: new Date().toISOString(),
        ...payload,
    }));
}

export function installMinimalConsoleMode(): void {
    if (minimalConsoleInstalled) {
        return;
    }

    minimalConsoleInstalled = true;
    console.debug = () => undefined;
    console.log = () => undefined;
    console.info = () => undefined;
    console.warn = () => undefined;
    // Keep console.error for actionable runtime failures.
    console.error = (...args: unknown[]) => originalConsole.error(...args);
}
