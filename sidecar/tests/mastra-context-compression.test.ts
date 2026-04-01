import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskContextCompressionStore } from '../src/mastra/contextCompression';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('task context compression store', () => {
    test('builds micro + structured summary and persists to MEMORY.md', () => {
        const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-context-compress-'));
        const workspacePath = path.join(appDataRoot, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        tempDirs.push(appDataRoot);

        const storePath = path.join(appDataRoot, 'mastra-context-state.json');
        const store = new TaskContextCompressionStore(storePath);

        store.recordUserTurn({
            taskId: 'task-ctx-1',
            threadId: 'thread-ctx-1',
            resourceId: 'employee-task-ctx-1',
            workspacePath,
            content: '请分析这个仓库并给出发布清单',
        });
        store.recordAssistantTurn({
            taskId: 'task-ctx-1',
            threadId: 'thread-ctx-1',
            resourceId: 'employee-task-ctx-1',
            workspacePath,
            content: '我会先检查 release-readiness、测试和变更日志。',
        });

        const snapshot = store.get('task-ctx-1');
        expect(snapshot).toBeDefined();
        expect(snapshot?.microSummary).toContain('[U]');
        expect(snapshot?.microSummary).toContain('[A]');
        expect(snapshot?.structuredSummary).toContain('Current objective:');
        expect(snapshot?.structuredSummary).toContain('Assistant progress:');

        const preamble = store.buildPreamble('task-ctx-1');
        expect(preamble).toContain('[Context Compression]');
        expect(preamble).toContain('Micro context:');
        expect(preamble).toContain('Structured summary:');

        const memoryFile = path.join(workspacePath, '.coworkany', 'MEMORY.md');
        expect(fs.existsSync(memoryFile)).toBe(true);
        const memoryContent = fs.readFileSync(memoryFile, 'utf-8');
        expect(memoryContent).toContain('Task task-ctx-1');

        const reloaded = new TaskContextCompressionStore(storePath).get('task-ctx-1');
        expect(reloaded?.structuredSummary).toContain('Current objective:');
    });

    test('writes topic memory files and recalls relevant entries into preamble', () => {
        const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-context-topic-'));
        const workspacePath = path.join(appDataRoot, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
        tempDirs.push(appDataRoot);

        const storePath = path.join(appDataRoot, 'mastra-context-state.json');
        const store = new TaskContextCompressionStore(storePath);

        store.recordUserTurn({
            taskId: 'task-topic-1',
            threadId: 'thread-topic-1',
            resourceId: 'employee-task-topic-1',
            workspacePath,
            content: '请整理发布清单和上线回滚流程',
        });
        store.recordAssistantTurn({
            taskId: 'task-topic-1',
            threadId: 'thread-topic-1',
            resourceId: 'employee-task-topic-1',
            workspacePath,
            content: '我已经记录发布清单、上线检查和回滚步骤。',
        });
        store.recordUserTurn({
            taskId: 'task-topic-1',
            threadId: 'thread-topic-1',
            resourceId: 'employee-task-topic-1',
            workspacePath,
            content: '继续补充发布清单的风险项',
        });

        const topicDir = path.join(workspacePath, '.coworkany', 'memory');
        expect(fs.existsSync(topicDir)).toBe(true);
        const topicFiles = fs.readdirSync(topicDir).filter((name) => name.endsWith('.md'));
        expect(topicFiles.length).toBeGreaterThan(0);

        const preamble = store.buildPreamble('task-topic-1') ?? '';
        expect(preamble).toContain('Relevant file memories:');
        expect(preamble).toContain('memory/');
    });
});
