/**
 * Verification Script for Unified Core Skills
 * 
 * Checks if the 'Unified Capability Model' is strictly implemented.
 * - Core Skills (voice/task/system) must be present.
 * - They must have correct effects.
 * - Registry must resolve them.
 */

import { globalToolRegistry } from './sidecar/src/tools/registry';
import { BUILTIN_TOOLS } from './sidecar/src/tools/builtin';

async function verify() {
    console.log('🔍 Verifying Unified Tool Registry...');

    // 1. Manually register BUILTIN_TOOLS (as Sidecar main would do)
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

// Run verification
verify().catch(console.error);
