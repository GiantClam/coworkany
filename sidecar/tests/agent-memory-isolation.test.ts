import { describe, expect, test } from 'bun:test';
import { KnowledgeUpdater } from '../src/runtime/knowledge/knowledgeUpdater';
import { ReActController } from '../src/agent/reactLoop';
import { AutonomousAgentController } from '../src/agent/autonomousAgent';
import { setTaskIsolationPolicy } from '../src/runtime/taskIsolationPolicyStore';

describe('agent memory isolation', () => {
    test('knowledge updater writes memories into the allowed task scope', async () => {
        const writes: Array<{
            relativePath: string;
            metadata?: Record<string, unknown>;
        }> = [];

        setTaskIsolationPolicy({
            taskId: 'task-knowledge-scope',
            workspacePath: '/tmp/workspace-knowledge',
            memoryIsolationPolicy: {
                classificationMode: 'scope_tagged',
                readScopes: ['task'],
                writeScopes: ['task'],
                defaultWriteScope: 'task',
                notes: [],
            },
        });

        const updater = new KnowledgeUpdater({
            vaultManager: {
                writeDocument: async (
                    relativePath: string,
                    _content: string,
                    options?: { metadata?: Record<string, unknown> }
                ) => {
                    writes.push({ relativePath, metadata: options?.metadata });
                    return true;
                },
            } as any,
            isolation: {
                taskId: 'task-knowledge-scope',
                workspacePath: '/tmp/workspace-knowledge',
            },
        });

        const result = await updater.saveKnowledge({
            title: 'Fix flaky gateway authorization',
            content: 'Use tenant-aware metadata filters during retrieval.',
            category: 'solutions',
            tags: ['gateway', 'tenant'],
            confidence: 0.9,
            source: 'test',
        });

        expect(result.success).toBe(true);
        expect(result.path).toContain('task/task-knowledge-scope/learnings/solutions/');
        expect(writes[0]?.metadata).toMatchObject({
            memory_scope: 'task',
            task_id: 'task-knowledge-scope',
            workspace_path: '/tmp/workspace-knowledge',
        });
    });

    test('react controller requests memory using task-scoped context', async () => {
        const memoryCalls: any[] = [];
        const controller = new ReActController({
            llm: {
                generateThought: async () => 'No tool needed.',
                decideAction: async () => null,
                generateFinalAnswer: async () => 'Done.',
            },
            toolExecutor: {
                execute: async () => 'unused',
            },
            getMemoryContext: async (input) => {
                memoryCalls.push(input);
                return 'Scoped memory context';
            },
        });

        const run = controller.execute('continue task', {
            taskId: 'task-react-scope',
            workspacePath: '/tmp/workspace-react',
            availableTools: [],
        });

        const first = await run.next();
        const second = await run.next();

        expect(first.done).toBe(false);
        expect(second.done).toBe(true);
        expect(memoryCalls).toEqual([
            {
                taskId: 'task-react-scope',
                workspacePath: '/tmp/workspace-react',
                query: 'continue task',
                topK: 3,
                maxChars: 2000,
            },
        ]);
    });

    test('autonomous controller reads and writes memory under the session task scope', async () => {
        const memoryReads: any[] = [];
        const memoryWrites: any[] = [];
        const controller = new AutonomousAgentController({
            llm: {
                decomposeTask: async () => ({
                    subtasks: [
                        {
                            description: 'Check runtime isolation',
                            requiresTools: [],
                            estimatedComplexity: 'simple',
                        },
                    ],
                    overallStrategy: 'Run one focused check',
                    canRunAutonomously: true,
                    requiresUserInput: [],
                }),
                executeSubtask: async () => ({
                    result: 'checked',
                    toolsUsed: [],
                }),
                verifyGoalCompletion: async () => ({
                    goalMet: true,
                    evidence: 'All checks passed',
                    confidence: 0.95,
                }),
                extractMemories: async () => ({
                    shouldSave: true,
                    facts: [
                        {
                            content: 'Tenant filters must be applied before retrieval.',
                            category: 'learning',
                            confidence: 0.9,
                        },
                    ],
                }),
                summarizeTask: async () => 'Autonomous summary',
            },
            getMemoryContext: async (input) => {
                memoryReads.push(input);
                return 'Scoped autonomous memory';
            },
            saveMemory: async (input) => {
                memoryWrites.push(input);
                return 'learnings/task/task-auto-scope/2026-03-21-tenant-filters.md';
            },
        });

        const task = await controller.startTask('verify isolation', {
            autoSaveMemory: true,
            notifyOnComplete: true,
            runInBackground: false,
            sessionTaskId: 'task-auto-scope',
            workspacePath: '/tmp/workspace-auto',
        });

        expect(task.id).toBe('task-auto-scope');
        expect(memoryReads).toEqual([
            {
                taskId: 'task-auto-scope',
                workspacePath: '/tmp/workspace-auto',
                query: 'verify isolation',
                topK: 5,
                maxChars: 3000,
            },
        ]);
        expect(memoryWrites).toEqual([
            {
                taskId: 'task-auto-scope',
                workspacePath: '/tmp/workspace-auto',
                title: 'Tenant filters must be applied before retrieval',
                content: 'Tenant filters must be applied before retrieval.',
                category: 'learnings',
                tags: ['auto-extracted', 'task-task-auto-scope'],
            },
        ]);
        expect(task.memoryExtracted).toEqual([
            'learnings/task/task-auto-scope/2026-03-21-tenant-filters.md',
        ]);
    });
});
