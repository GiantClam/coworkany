import { describe, expect, test } from 'bun:test';
import { deriveSingletonConfig, matchesEnabledFlag } from '../src/ipc/singletonConfig';

describe('singleton config', () => {
    test('matchesEnabledFlag accepts common truthy values', () => {
        expect(matchesEnabledFlag('1')).toBe(true);
        expect(matchesEnabledFlag('true')).toBe(true);
        expect(matchesEnabledFlag(' YES ')).toBe(true);
        expect(matchesEnabledFlag('on')).toBe(true);
        expect(matchesEnabledFlag('0')).toBe(false);
        expect(matchesEnabledFlag(undefined)).toBe(false);
    });

    test('deriveSingletonConfig trims socket path and derives lock path hash', () => {
        const config = deriveSingletonConfig(
            {
                COWORKANY_SIDECAR_SINGLETON: 'true',
                COWORKANY_SIDECAR_SOCKET_PATH: ' /tmp/coworkany.sock ',
            },
            '/tmp',
        );

        expect(config.enabled).toBe(true);
        expect(config.socketPath).toBe('/tmp/coworkany.sock');
        expect(config.lockPath?.startsWith('/tmp/coworkany-sidecar-')).toBe(true);
        expect(config.lockPath?.endsWith('.lock')).toBe(true);
    });

    test('deriveSingletonConfig disables lock path when socket path missing', () => {
        const config = deriveSingletonConfig(
            {
                COWORKANY_SIDECAR_SINGLETON: 'false',
                COWORKANY_SIDECAR_SOCKET_PATH: '   ',
            },
            '/tmp',
        );

        expect(config.enabled).toBe(false);
        expect(config.socketPath).toBeUndefined();
        expect(config.lockPath).toBeUndefined();
    });
});
