import { describe, expect, test } from 'bun:test';
import { resolveProfiledBuiltinAgentTools } from '../src/mastra/tools/profiledBuiltins';

describe('profiled builtin agent tools', () => {
    test('core profile does not inject feature tools directly into agents', () => {
        const tools = resolveProfiledBuiltinAgentTools({
            env: { COWORKANY_RUNTIME_PROFILE: 'core' } as NodeJS.ProcessEnv,
        });

        expect(Object.keys(tools)).toEqual([]);
    });

    test('full profile keeps existing builtin feature tools available', () => {
        const tools = resolveProfiledBuiltinAgentTools({
            env: { COWORKANY_RUNTIME_PROFILE: 'full' } as NodeJS.ProcessEnv,
            include: ['search_web', 'voice_speak'],
        });

        expect(Object.keys(tools).sort()).toEqual(['search_web', 'voice_speak']);
    });
});
