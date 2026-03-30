import { z } from 'zod';
export const PatchOperationSchema = z.enum([
    'create',   // New file
    'modify',   // Edit existing file
    'delete',   // Remove file
    'rename',   // Rename/move file
]);
export type PatchOperation = z.infer<typeof PatchOperationSchema>;
export const DiffHunkSchema = z.object({
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
    content: z.string(),
    header: z.string().optional(), // @@ line
    context: z.string().optional(), // Function/class name
});
export type DiffHunk = z.infer<typeof DiffHunkSchema>;
export const FilePatchSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
    filePath: z.string(),
    operation: PatchOperationSchema,
    newFilePath: z.string().optional(),
    oldMode: z.string().optional(), // e.g., "100644"
    newMode: z.string().optional(),
    hunks: z.array(DiffHunkSchema),
    fullContent: z.string().optional(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    description: z.string().optional(),
    toolId: z.string().optional(), // Which tool generated this
});
export const PatchSetSchema = z.object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    timestamp: z.string().datetime(),
    patches: z.array(FilePatchSchema),
    description: z.string(),
    totalAdditions: z.number().int().nonnegative(),
    totalDeletions: z.number().int().nonnegative(),
    filesAffected: z.number().int().positive(),
});
export const ShadowFileSchema = z.object({
    originalPath: z.string(),
    originalExists: z.boolean(),
    originalHash: z.string().optional(), // SHA-256
    shadowPath: z.string(),
    shadowHash: z.string(),
    pendingPatch: FilePatchSchema.optional(),
    status: z.enum([
        'pending',    // Awaiting user review
        'approved',   // User accepted, ready to apply
        'rejected',   // User rejected
        'applied',    // Successfully written to original
        'conflict',   // Original changed since shadow created
    ]),
    createdAt: z.string().datetime(),
    reviewedAt: z.string().datetime().optional(),
});
export const PatchApplyRequestSchema = z.object({
    patchId: z.string().uuid(),
    patchSetId: z.string().uuid().optional(),
    patch: FilePatchSchema,
    createBackup: z.boolean().default(true),
    backupSuffix: z.string().default('.bak'),
    conflictStrategy: z.enum([
        'abort',    // Fail if file changed
        'force',    // Overwrite regardless
        'merge',    // Attempt 3-way merge
    ]).default('abort'),
});
export const PatchApplyResultSchema = z.object({
    patchId: z.string().uuid(),
    success: z.boolean(),
    appliedAt: z.string().datetime().optional(),
    backupPath: z.string().optional(),
    error: z.string().optional(),
    errorCode: z.enum([
        'file_not_found',
        'permission_denied',
        'conflict_detected',
        'merge_failed',
        'io_error',
    ]).optional(),
    conflictDetails: z.object({
        expectedHash: z.string(),
        actualHash: z.string(),
        conflictingHunks: z.array(z.number()),
    }).optional(),
});
export function createDiffHeader(
    oldPath: string,
    newPath: string,
    operation: PatchOperation
): string {
    switch (operation) {
        case 'create':
            return `--- /dev/null\n+++ b/${newPath}`;
        case 'delete':
            return `--- a/${oldPath}\n+++ /dev/null`;
        case 'rename':
            return `--- a/${oldPath}\n+++ b/${newPath}`;
        default:
            return `--- a/${oldPath}\n+++ b/${newPath}`;
    }
}
export function calculatePatchStats(hunks: DiffHunk[]): {
    additions: number;
    deletions: number;
} {
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
        const lines = hunk.content.split('\n');
        for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                additions++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                deletions++;
            }
        }
    }
    return { additions, deletions };
}
