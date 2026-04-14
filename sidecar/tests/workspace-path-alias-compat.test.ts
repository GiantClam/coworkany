import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { createTaskRequestContext } from '../src/mastra/requestContext';
import {
    ensureWorkspaceCommandPathAliases,
    getWorkspacePolicySnapshot,
    normalizeWorkspaceToolPath,
} from '../src/mastra/workspace/runtime';

describe('workspace path alias compatibility', () => {
    const workspacePath = '/tmp/coworkany-workspace-alias-test';

    test('strips workspace prefix for relative paths', () => {
        expect(normalizeWorkspaceToolPath('workspace/form.html', workspacePath)).toBe('form.html');
        expect(normalizeWorkspaceToolPath('./workspace/form_fields.json', workspacePath)).toBe('form_fields.json');
        expect(normalizeWorkspaceToolPath('workspace', workspacePath)).toBe('.');
    });

    test('strips environment/data prefix for relative paths', () => {
        expect(normalizeWorkspaceToolPath('environment/data/schema.sql', workspacePath)).toBe('schema.sql');
        expect(normalizeWorkspaceToolPath('./environment/data/income_statement.csv', workspacePath)).toBe('income_statement.csv');
    });

    test('normalizes workspace aliases in absolute paths', () => {
        const absoluteWorkspaceAlias = path.join(workspacePath, 'workspace', 'chat_log.json');
        const absoluteEnvironmentAlias = path.join(workspacePath, 'environment', 'data', 'emails.json');
        expect(normalizeWorkspaceToolPath(absoluteWorkspaceAlias, workspacePath)).toBe('chat_log.json');
        expect(normalizeWorkspaceToolPath(absoluteEnvironmentAlias, workspacePath)).toBe('emails.json');
    });

    test('handles backslash separators', () => {
        expect(normalizeWorkspaceToolPath('workspace\\form.html', workspacePath)).toBe('form.html');
        expect(normalizeWorkspaceToolPath('environment\\data\\schema.sql', workspacePath)).toBe('schema.sql');
    });

    test('keeps relative unrelated paths untouched and rewrites external absolute paths into workspace-relative form', () => {
        expect(normalizeWorkspaceToolPath('notes/todo.md', workspacePath)).toBe('notes/todo.md');
        expect(normalizeWorkspaceToolPath('/var/tmp/other/file.txt', workspacePath)).toBe('var/tmp/other/file.txt');
    });

    test('can preserve external absolute paths when rewrite flag is disabled', () => {
        const previous = process.env.COWORKANY_WORKSPACE_REWRITE_EXTERNAL_ABSOLUTE_PATH;
        process.env.COWORKANY_WORKSPACE_REWRITE_EXTERNAL_ABSOLUTE_PATH = '0';
        try {
            expect(normalizeWorkspaceToolPath('/var/tmp/other/file.txt', workspacePath)).toBe('/var/tmp/other/file.txt');
        } finally {
            if (previous === undefined) {
                delete process.env.COWORKANY_WORKSPACE_REWRITE_EXTERNAL_ABSOLUTE_PATH;
            } else {
                process.env.COWORKANY_WORKSPACE_REWRITE_EXTERNAL_ABSOLUTE_PATH = previous;
            }
        }
    });

    test('creates workspace and environment/data command path aliases', () => {
        const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-workspace-alias-'));
        try {
            ensureWorkspaceCommandPathAliases(tempWorkspace);
            const workspaceAlias = path.join(tempWorkspace, 'workspace');
            const environmentDataAlias = path.join(tempWorkspace, 'environment', 'data');

            expect(fs.lstatSync(workspaceAlias).isSymbolicLink()).toBe(true);
            expect(fs.readlinkSync(workspaceAlias)).toBe('.');

            expect(fs.lstatSync(environmentDataAlias).isSymbolicLink()).toBe(true);
            expect(fs.readlinkSync(environmentDataAlias)).toBe('..');
        } finally {
            fs.rmSync(tempWorkspace, { recursive: true, force: true });
        }
    });

    test('keeps approval required by default and allows per-request override', () => {
        const defaultPolicy = getWorkspacePolicySnapshot();
        expect(defaultPolicy.tools[WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]?.requireApproval).toBe(true);
        expect(defaultPolicy.tools[WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]?.requireApproval).toBe(true);

        const requestContext = createTaskRequestContext({
            threadId: 'thread-1',
            resourceId: 'resource-1',
            taskId: 'task-1',
            requireToolApproval: false,
        });
        const overriddenPolicy = getWorkspacePolicySnapshot(requestContext);
        expect(overriddenPolicy.tools[WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]?.requireApproval).toBe(false);
        expect(overriddenPolicy.tools[WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]?.requireReadBeforeWrite).toBe(false);
        expect(overriddenPolicy.tools[WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]?.requireApproval).toBe(false);
    });
});
