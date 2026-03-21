import { describe, expect, test } from 'bun:test';
import {
    assertWorkspaceOverrideAllowed,
    buildMemoryMetadataFilters,
    resolveAllowedMemoryWriteScope,
    setTaskIsolationPolicy,
} from '../src/execution/taskIsolationPolicyStore';

describe('task isolation policy store', () => {
    test('denies workspace overrides for frozen task sessions', () => {
        setTaskIsolationPolicy({
            taskId: 'task-1',
            workspacePath: '/tmp/workspace-a',
            sessionIsolationPolicy: {
                workspaceBindingMode: 'frozen_workspace_only',
                followUpScope: 'same_task_only',
                allowWorkspaceOverride: false,
                supersededContractHandling: 'tombstone_prior_contracts',
                staleEvidenceHandling: 'evict_on_refreeze',
                notes: [],
            },
        });

        expect(assertWorkspaceOverrideAllowed('task-1', '/tmp/workspace-a')).toBeNull();
        expect(assertWorkspaceOverrideAllowed('task-1', '/tmp/workspace-b')).toContain('/tmp/workspace-a');
    });

    test('enforces memory write scopes and stamps tenant-aware metadata filters', () => {
        setTaskIsolationPolicy({
            taskId: 'task-2',
            workspacePath: '/tmp/workspace-a',
            memoryIsolationPolicy: {
                classificationMode: 'scope_tagged',
                readScopes: ['task', 'workspace', 'user_preference'],
                writeScopes: ['task'],
                defaultWriteScope: 'task',
                notes: [],
            },
        });

        expect(resolveAllowedMemoryWriteScope('task-2')).toBe('task');
        expect(() => resolveAllowedMemoryWriteScope('task-2', 'workspace')).toThrow('Memory write scope denied');
        expect(buildMemoryMetadataFilters({
            taskId: 'task-2',
            workspacePath: '/tmp/workspace-a',
            scope: 'task',
        })).toMatchObject({
            memory_scope: 'task',
            task_id: 'task-2',
        });
        expect(buildMemoryMetadataFilters({
            taskId: 'task-2',
            workspacePath: '/tmp/workspace-a',
            scope: 'workspace',
        })).toMatchObject({
            memory_scope: 'workspace',
        });
    });
});
