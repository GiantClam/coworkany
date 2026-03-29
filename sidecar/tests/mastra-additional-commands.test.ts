import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createMastraAdditionalCommandHandler } from '../src/mastra/additionalCommands';

function createCommand(
    type: string,
    payload: Record<string, unknown>,
): Record<string, unknown> {
    return {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type,
        payload,
    };
}

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('mastra additional command handler', () => {
    test('handles workspace lifecycle commands', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-workspace-');
        const appDataRoot = createTempDir('coworkany-mastra-appdata-');
        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const listBefore = await handler(createCommand('list_workspaces', {}));
        expect(listBefore?.type).toBe('list_workspaces_response');
        expect(((listBefore?.payload as Record<string, unknown>)?.workspaces as unknown[]).length).toBe(0);

        const createResponse = await handler(createCommand('create_workspace', {
            name: 'Mastra Workspace',
            path: 'default',
        }));
        expect(createResponse?.type).toBe('create_workspace_response');
        const createPayload = createResponse?.payload as Record<string, unknown>;
        expect(createPayload.success).toBe(true);
        const workspace = createPayload.workspace as Record<string, unknown>;
        const workspacePath = workspace.path as string;
        expect(workspacePath.startsWith(path.join(appDataRoot, 'workspaces'))).toBe(true);

        const listAfter = await handler(createCommand('list_workspaces', {}));
        const workspaces = (listAfter?.payload as Record<string, unknown>)?.workspaces as Array<Record<string, unknown>>;
        expect(workspaces.length).toBe(1);
        expect(workspaces[0]?.name).toBe('Mastra Workspace');
    });

    test('handles capability and directive management commands', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-capability-');
        const appDataRoot = createTempDir('coworkany-mastra-capability-appdata-');
        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const toolpacks = await handler(createCommand('list_toolpacks', {
            includeDisabled: true,
        }));
        expect(toolpacks?.type).toBe('list_toolpacks_response');
        expect(Array.isArray((toolpacks?.payload as Record<string, unknown>)?.toolpacks)).toBe(true);

        const skills = await handler(createCommand('list_claude_skills', {
            includeDisabled: true,
        }));
        expect(skills?.type).toBe('list_claude_skills_response');
        expect(Array.isArray((skills?.payload as Record<string, unknown>)?.skills)).toBe(true);

        const listDirectives = await handler(createCommand('list_directives', {}));
        expect(listDirectives?.type).toBe('list_directives_response');
        const defaultDirectives = (listDirectives?.payload as Record<string, unknown>)?.directives as Array<Record<string, unknown>>;
        expect(defaultDirectives.length).toBeGreaterThan(0);

        const upsert = await handler(createCommand('upsert_directive', {
            directive: {
                id: 'mastra-test',
                name: 'Mastra Test',
                content: 'Test content',
                enabled: true,
                priority: 10,
            },
        }));
        expect(upsert?.type).toBe('upsert_directive_response');
        expect((upsert?.payload as Record<string, unknown>)?.success).toBe(true);

        const remove = await handler(createCommand('remove_directive', {
            directiveId: 'mastra-test',
        }));
        expect(remove?.type).toBe('remove_directive_response');
        expect((remove?.payload as Record<string, unknown>)?.success).toBe(true);
    });

    test('returns null for commands it does not handle', async () => {
        const workspaceRoot = createTempDir('coworkany-mastra-unhandled-');
        const appDataRoot = createTempDir('coworkany-mastra-unhandled-appdata-');
        const { handler } = createMastraAdditionalCommandHandler({
            workspaceRoot,
            appDataRoot,
        });

        const result = await handler(createCommand('start_task', {
            taskId: randomUUID(),
            userQuery: 'hello',
        }));
        expect(result).toBeNull();
    });
});

