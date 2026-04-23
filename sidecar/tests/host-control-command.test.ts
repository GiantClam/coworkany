import { describe, expect, test } from 'bun:test';
import { deriveHostControlShellCommand } from '../src/mastra/hostControlCommand';

describe('hostControlCommand', () => {
    test('maps recycle-bin cleanup intent to platform-specific command', () => {
        const command = deriveHostControlShellCommand('请帮我清空回收站');

        if (process.platform === 'darwin') {
            expect(command).toContain('tell application "Finder" to empty the trash');
            return;
        }
        if (process.platform === 'win32') {
            expect(command).toContain('Clear-RecycleBin -Force');
            return;
        }

        expect(command).toContain('trash');
    });

    test('maps relative minute shutdown phrasing to delayed shutdown command', () => {
        expect(deriveHostControlShellCommand('设置 1 分钟后关机')).toBe('sudo shutdown -h +1');
        expect(deriveHostControlShellCommand('设置电脑一分钟后关机')).toBe('sudo shutdown -h +1');
    });

    test('maps relative reboot delay to delayed reboot command', () => {
        expect(deriveHostControlShellCommand('1小时后重启电脑')).toBe('sudo shutdown -r +60');
    });

    test('maps absolute hour cue to shutdown command format', () => {
        expect(deriveHostControlShellCommand('9点关机')).toBe('sudo shutdown -h 0900');
        expect(deriveHostControlShellCommand('9点重启')).toBe('sudo shutdown -r 0900');
    });

    test('falls back to immediate shutdown/reboot commands', () => {
        expect(deriveHostControlShellCommand('请关机')).toBe('sudo shutdown -h now');
        expect(deriveHostControlShellCommand('重启电脑')).toBe('sudo shutdown -r now');
    });
});
