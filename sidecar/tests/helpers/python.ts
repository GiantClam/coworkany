export function resolvePythonExecutable(): string {
    return Bun.which('python3') || Bun.which('python') || 'python3';
}
