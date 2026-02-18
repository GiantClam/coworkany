
import { handleReloadTools } from '../src/handlers/tools';
import { SkillStore } from '../src/storage/skillStore';
import { globalToolRegistry } from '../src/tools/registry';
import { BUILTIN_TOOLS } from '../src/tools/builtin';
import path from 'path';

// Mock context
const ctx = {
    taskId: 'test-reload',
    now: () => new Date().toISOString(),
    nextEventId: () => 'evt-1',
    nextSequence: () => 1
};

async function testReload() {
    console.log('Testing reload_tools...');

    // Initialize mock deps
    const workspaceRoot = process.cwd();
    const skillStore = new SkillStore(workspaceRoot);

    // Pre-populate registry
    globalToolRegistry.register('builtin', BUILTIN_TOOLS);
    console.log('Initial tool count:', globalToolRegistry.getAllTools().length);

    // Create command
    const command = {
        id: 'cmd-1',
        timestamp: new Date().toISOString(),
        type: 'reload_tools' as const,
        payload: { force: true }
    };

    // Run handler
    const result = handleReloadTools(command, ctx, { skillStore });

    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.response.payload && result.response.payload.success) {
        console.log('Reload successful!');
    } else {
        console.error('Reload failed!');
        process.exit(1);
    }
}

testReload();
