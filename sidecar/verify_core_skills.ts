/**
 * Verification Script for Unified Core Skills
 * Run from sidecar/ directory
 */

import { globalToolRegistry } from './src/tools/registry';
import { BUILTIN_TOOLS } from './src/tools/builtin';

async function verify() {
    console.log('🔍 Verifying Unified Tool Registry...');

    // 1. Manually register BUILTIN_TOOLS
    globalToolRegistry.register('builtin', BUILTIN_TOOLS);

    // 2. Check for Core Skills
    const coreSkills = [
        'voice_speak',
        'task_create',
        'task_list',
        'task_update',
        'system_status'
    ];

    let missing = 0;
    for (const name of coreSkills) {
        const tool = globalToolRegistry.getTool(name);
        if (tool) {
            console.log(`✅ Found Skill: ${name}`);
            console.log(`   - Effects: ${JSON.stringify(tool.effects)}`);
        } else {
            console.error(`❌ MISSING Skill: ${name}`);
            missing++;
        }
    }

    if (missing === 0) {
        console.log('\n✨ SUCCESS: All Unified Core Skills are registered!');
        process.exit(0);
    } else {
        console.error(`\n💀 FAILURE: ${missing} skills missing.`);
        process.exit(1);
    }
}

verify().catch(console.error);
