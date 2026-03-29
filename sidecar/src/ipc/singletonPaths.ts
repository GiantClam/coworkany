export function isNamedPipePath(socketPath: string): boolean {
    return socketPath.startsWith('\\\\.\\pipe\\');
}

export function canUnlinkSocketPath(
    socketPath: string,
    platform: NodeJS.Platform = process.platform,
): boolean {
    return platform !== 'win32' && !isNamedPipePath(socketPath);
}
