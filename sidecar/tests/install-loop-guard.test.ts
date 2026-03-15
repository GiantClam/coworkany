import { describe, expect, test } from 'bun:test';
import {
    buildRepeatedSuccessfulInstallMessage,
    isDirectPackageInstallRequest,
    isSuccessfulPythonInstallResult,
    normalizePythonInstallCommandForLoopGuard,
    parseRunCommandResult,
} from '../src/agent/installLoopGuard';

describe('installLoopGuard', () => {
    test('normalizes supported python install commands', () => {
        expect(normalizePythonInstallCommandForLoopGuard('pip install Pillow imagehash')).toBe('pip install pillow imagehash');
        expect(normalizePythonInstallCommandForLoopGuard('python -m pip install Pillow imagehash')).toBe('python -m pip install pillow imagehash');
        expect(normalizePythonInstallCommandForLoopGuard('uv pip install pillow')).toBe('uv pip install pillow');
        expect(normalizePythonInstallCommandForLoopGuard('npm install react')).toBeNull();
    });

    test('parses structured run_command results', () => {
        expect(parseRunCommandResult({
            exit_code: 0,
            stdout: 'Successfully installed Pillow-12.1.1',
            stderr: '',
        })).toEqual({
            exitCode: 0,
            stdout: 'Successfully installed Pillow-12.1.1',
            stderr: '',
            error: undefined,
        });
    });

    test('detects successful python package installation outputs', () => {
        expect(isSuccessfulPythonInstallResult({
            exit_code: 0,
            stdout: 'Requirement already satisfied: Pillow in c:\\python\\lib\\site-packages',
            stderr: '',
        })).toBe(true);

        expect(isSuccessfulPythonInstallResult({
            exit_code: 0,
            stdout: 'Successfully installed Pillow-12.1.1 imagehash-4.3.2',
            stderr: '',
        })).toBe(true);

        expect(isSuccessfulPythonInstallResult({
            exit_code: 1,
            stdout: '',
            stderr: 'ERROR: Could not find a version that satisfies the requirement missing-pkg',
            error: 'Command failed',
        })).toBe(false);
    });

    test('recognizes direct installation requests but not unrelated workflows', () => {
        expect(isDirectPackageInstallRequest('请帮我安装 Python 依赖 Pillow 和 imagehash')).toBe(true);
        expect(isDirectPackageInstallRequest('Install the Python packages required for this script')).toBe(true);
        expect(isDirectPackageInstallRequest('清理这个文件夹里的重复图片')).toBe(false);
    });

    test('builds a strong skip message for repeated successful installs', () => {
        const message = buildRepeatedSuccessfulInstallMessage('python -m pip install Pillow imagehash', 3);
        expect(message).toContain('already succeeded earlier in this task');
        expect(message).toContain('Do not run the same package installation again');
        expect(message).toContain('repeat prevention count: 3');
    });
});
