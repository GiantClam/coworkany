import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

function isEnoent(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const maybeErrno = error as NodeJS.ErrnoException;
    return maybeErrno.code === 'ENOENT';
}

export function writeJsonFileAtomic(filePath: string, payload: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content = JSON.stringify(payload, null, 2);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, content, 'utf-8');
    try {
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        if (isEnoent(error)) {
            // Cross-process temp-file races can remove temp files between write and rename.
            // Fall back to direct write so state persistence remains best-effort and non-fatal.
            fs.writeFileSync(filePath, content, 'utf-8');
            try {
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            } catch {
                // Best-effort cleanup.
            }
            return;
        }
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch {
            // Best-effort cleanup.
        }
        throw error;
    }
}
