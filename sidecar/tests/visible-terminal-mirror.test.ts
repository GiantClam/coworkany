import { afterEach, describe, expect, test } from 'bun:test';
import { shouldEnableVisibleTerminalMirror } from '../src/tools/visibleTerminalMirror';

const ORIGINAL_ENV = {
    COWORKANY_SHELL_VISIBLE_TERMINAL: process.env.COWORKANY_SHELL_VISIBLE_TERMINAL,
    COWORKANY_APP_DIR: process.env.COWORKANY_APP_DIR,
};

afterEach(() => {
    if (ORIGINAL_ENV.COWORKANY_SHELL_VISIBLE_TERMINAL === undefined) {
        delete process.env.COWORKANY_SHELL_VISIBLE_TERMINAL;
    } else {
        process.env.COWORKANY_SHELL_VISIBLE_TERMINAL = ORIGINAL_ENV.COWORKANY_SHELL_VISIBLE_TERMINAL;
    }
    if (ORIGINAL_ENV.COWORKANY_APP_DIR === undefined) {
        delete process.env.COWORKANY_APP_DIR;
    } else {
        process.env.COWORKANY_APP_DIR = ORIGINAL_ENV.COWORKANY_APP_DIR;
    }
});

describe('shouldEnableVisibleTerminalMirror', () => {
    test('returns false by default outside desktop runtime', () => {
        delete process.env.COWORKANY_SHELL_VISIBLE_TERMINAL;
        delete process.env.COWORKANY_APP_DIR;
        expect(shouldEnableVisibleTerminalMirror()).toBe(false);
    });

    test('returns true by default inside desktop runtime', () => {
        delete process.env.COWORKANY_SHELL_VISIBLE_TERMINAL;
        process.env.COWORKANY_APP_DIR = '/tmp/coworkany-app';
        expect(shouldEnableVisibleTerminalMirror()).toBe(true);
    });

    test('explicit env false overrides desktop default', () => {
        process.env.COWORKANY_APP_DIR = '/tmp/coworkany-app';
        process.env.COWORKANY_SHELL_VISIBLE_TERMINAL = '0';
        expect(shouldEnableVisibleTerminalMirror()).toBe(false);
    });

    test('explicit env true enables mirror without desktop app dir', () => {
        delete process.env.COWORKANY_APP_DIR;
        process.env.COWORKANY_SHELL_VISIBLE_TERMINAL = 'true';
        expect(shouldEnableVisibleTerminalMirror()).toBe(true);
    });
});
