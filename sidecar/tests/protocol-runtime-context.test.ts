import { describe, expect, test } from 'bun:test';
import { PlatformRuntimeContextSchema } from '../src/protocol/commands';

describe('platform runtime context protocol', () => {
    test('accepts null sidecarLaunchMode and normalizes it away', () => {
        const parsed = PlatformRuntimeContextSchema.parse({
            platform: 'macos',
            arch: 'aarch64',
            appDir: '/Applications/CoworkAny.app',
            appDataDir: '/tmp/coworkany',
            shell: '/bin/zsh',
            sidecarLaunchMode: null,
            python: { available: true, path: 'python3', source: 'system' },
            skillhub: { available: false },
            managedServices: [],
        });

        expect(parsed.sidecarLaunchMode).toBeUndefined();
    });
});
