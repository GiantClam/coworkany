/**
 * CoworkAny Protocol - Patches Schema
 * 
 * Defines the Patch type system for non-destructive code editing.
 * All file modifications go through Shadow FS → Diff → User Accept → Atomic Write.
 */

import { z } from 'zod';

// ============================================================================
// Patch Operation Types
// ============================================================================

export const PatchOperationSchema = z.enum([
    'create',   // New file
    'modify',   // Edit existing file
    'delete',   // Remove file
    'rename',   // Rename/move file
]);

export type PatchOperation = z.infer<typeof PatchOperationSchema>;

// ============================================================================
// Diff Hunk
// ============================================================================

/**
 * A single hunk in a unified diff.
 * Represents a contiguous block of changes.
 */
export const DiffHunkSchema = z.object({
    // Original file location
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),

    // New file location
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),

    // Content lines with +/- prefixes
    content: z.string(),

    // Optional metadata
    header: z.string().optional(), // @@ line
    context: z.string().optional(), // Function/class name
});

export type DiffHunk = z.infer<typeof DiffHunkSchema>;

// ============================================================================
// File Patch
// ============================================================================

/**
 * A complete patch for a single file.
 */
export const FilePatchSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),

    // File identification
    filePath: z.string(),
    operation: PatchOperationSchema,

    // For rename operations
    newFilePath: z.string().optional(),

    // File metadata
    oldMode: z.string().optional(), // e.g., "100644"
    newMode: z.string().optional(),

    // Diff content
    hunks: z.array(DiffHunkSchema),

    // Full content (for create operations or full replacement)
    fullContent: z.string().optional(),

    // Stats
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),

    // Metadata
    description: z.string().optional(),
    toolId: z.string().optional(), // Which tool generated this
});

export type FilePatch = z.infer<typeof FilePatchSchema>;

// ============================================================================
// Patch Set
// ============================================================================

/**
 * A collection of patches to be applied atomically.
 */
export const PatchSetSchema = z.object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    timestamp: z.string().datetime(),

    // Patches in this set
    patches: z.array(FilePatchSchema),

    // Metadata
    description: z.string(),

    // Stats
    totalAdditions: z.number().int().nonnegative(),
    totalDeletions: z.number().int().nonnegative(),
    filesAffected: z.number().int().positive(),
});

export type PatchSet = z.infer<typeof PatchSetSchema>;

// ============================================================================
// Shadow File
// ============================================================================

/**
 * A file in the shadow workspace.
 * Shadow files are staged versions awaiting user approval.
 */
export const ShadowFileSchema = z.object({
    // Original file info
    originalPath: z.string(),
    originalExists: z.boolean(),
    originalHash: z.string().optional(), // SHA-256

    // Shadow file info
    shadowPath: z.string(),
    shadowHash: z.string(),

    // Pending patch
    pendingPatch: FilePatchSchema.optional(),

    // State
    status: z.enum([
        'pending',    // Awaiting user review
        'approved',   // User accepted, ready to apply
        'rejected',   // User rejected
        'applied',    // Successfully written to original
        'conflict',   // Original changed since shadow created
    ]),

    // Timestamps
    createdAt: z.string().datetime(),
    reviewedAt: z.string().datetime().optional(),
});

export type ShadowFile = z.infer<typeof ShadowFileSchema>;

// ============================================================================
// Patch Apply Request
// ============================================================================

/**
 * Request to apply a patch (sent to Rust for atomic write).
 */
export const PatchApplyRequestSchema = z.object({
    patchId: z.string().uuid(),
    patchSetId: z.string().uuid().optional(),

    // What to apply
    patch: FilePatchSchema,

    // Options
    createBackup: z.boolean().default(true),
    backupSuffix: z.string().default('.bak'),

    // Conflict handling
    conflictStrategy: z.enum([
        'abort',    // Fail if file changed
        'force',    // Overwrite regardless
        'merge',    // Attempt 3-way merge
    ]).default('abort'),
});

export type PatchApplyRequest = z.infer<typeof PatchApplyRequestSchema>;

// ============================================================================
// Patch Apply Result
// ============================================================================

/**
 * Result of applying a patch (from Rust).
 */
export const PatchApplyResultSchema = z.object({
    patchId: z.string().uuid(),

    success: z.boolean(),

    // On success
    appliedAt: z.string().datetime().optional(),
    backupPath: z.string().optional(),

    // On failure
    error: z.string().optional(),
    errorCode: z.enum([
        'file_not_found',
        'permission_denied',
        'conflict_detected',
        'merge_failed',
        'io_error',
    ]).optional(),

    // Conflict details
    conflictDetails: z.object({
        expectedHash: z.string(),
        actualHash: z.string(),
        conflictingHunks: z.array(z.number()),
    }).optional(),
});

export type PatchApplyResult = z.infer<typeof PatchApplyResultSchema>;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a unified diff header.
 */
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

/**
 * Parse stats from hunks.
 */
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
