export function deriveDefaultResourceId(taskId: string): string {
    const configured = process.env.COWORKANY_MASTRA_RESOURCE_ID;
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return configured.trim();
    }
    return `employee-${taskId}`;
}
