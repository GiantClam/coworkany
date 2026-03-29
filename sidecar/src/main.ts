/**
 * Sidecar runtime bootstrap.
 *
 * Single runtime path: always start Mastra entrypoint.
 */
export {};

process.env.COWORKANY_RUNTIME_MODE = 'mastra';
await import('./main-mastra');
