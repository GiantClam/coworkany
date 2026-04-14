#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function usage() {
    console.error('Usage: bun run scripts/external/run-external-benchmark-step.mjs --name <string> --command <shell> [--working-dir <dir>] [--required-env <env1,env2>] [--bootstrap <json-array>] [--timeout-ms <ms>] [--skip-on-missing-env]');
    process.exit(2);
}

function getArgValue(index, args) {
    return index + 1 < args.length ? args[index + 1] : undefined;
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        usage();
    }

    const result = {
        name: undefined,
        command: undefined,
        workingDir: process.cwd(),
        requiredEnv: [],
        bootstrap: [],
        timeoutMs: undefined,
        skipOnMissingEnv: false,
    };

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--name') {
            result.name = getArgValue(i, args);
            i += 1;
            continue;
        }
        if (arg === '--command') {
            result.command = getArgValue(i, args);
            i += 1;
            continue;
        }
        if (arg === '--working-dir') {
            result.workingDir = getArgValue(i, args) || process.cwd();
            i += 1;
            continue;
        }
        if (arg === '--required-env') {
            const raw = getArgValue(i, args);
            if (typeof raw === 'string' && raw.trim().length > 0) {
                result.requiredEnv = raw.split(',').map((item) => item.trim()).filter(Boolean);
            }
            i += 1;
            continue;
        }
        if (arg === '--bootstrap') {
            const raw = getArgValue(i, args);
            if (typeof raw === 'string' && raw.trim().length > 0) {
                try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        result.bootstrap = parsed.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
                    }
                } catch {
                    result.bootstrap = raw
                        .split('&&')
                        .map((entry) => entry.trim())
                        .filter(Boolean);
                }
            }
            i += 1;
            continue;
        }
        if (arg === '--timeout-ms') {
            const value = Number.parseInt(getArgValue(i, args) || '', 10);
            if (Number.isFinite(value) && value > 0) {
                result.timeoutMs = value;
            }
            i += 1;
            continue;
        }
        if (arg === '--skip-on-missing-env') {
            result.skipOnMissingEnv = true;
            continue;
        }
        usage();
    }

    return result;
}

function ensureWorkingDir(dir, benchmarkName) {
    if (!dir) {
        return null;
    }

    if (!fs.existsSync(dir)) {
        console.log(`[SKIP] ${benchmarkName}: 指定工作目录不存在: ${dir}`);
        return null;
    }

    return dir;
}

function runBootstrapStep(bootstrap, options) {
    if (!Array.isArray(bootstrap) || bootstrap.length === 0) {
        return true;
    }
    console.log('[BOOTSTRAP] 运行前置依赖安装');
    for (const item of bootstrap) {
        if (typeof item !== 'string' || item.trim().length === 0) {
            continue;
        }
        const ok = runShellCommand(item, options);
        if (!ok) {
            return false;
        }
    }
    return true;
}

function runShellCommand(command, options) {
    const result = spawnSync(command, {
        shell: true,
        stdio: 'inherit',
        env: options.env,
        cwd: options.cwd,
        timeout: options.timeoutMs,
    });
    return result.status === 0;
}

function main() {
    const args = parseArgs();
    const {
        name,
        command,
        workingDir,
        requiredEnv,
        bootstrap,
        timeoutMs,
        skipOnMissingEnv,
    } = args;

    const benchmarkName = name || '外部基准';
    if (!command) {
        console.error('[ERROR] 缺少 --command');
        process.exit(2);
    }

    const missing = requiredEnv.filter((envName) => !process.env[envName]);
    if (missing.length > 0) {
        console.log(`[SKIP] ${benchmarkName}: 缺失环境变量 ${missing.join(', ')}`);
        if (skipOnMissingEnv) {
            process.exit(0);
        }
        process.exit(2);
    }

    if (bootstrap.length > 0) {
        const ok = runBootstrapStep(bootstrap, {
            cwd: workingDir,
            env: process.env,
            timeoutMs: timeoutMs ?? undefined,
        });
        if (!ok) {
            console.error(`[ERROR] ${benchmarkName}: 预处理命令失败`);
            process.exit(1);
        }
    }

    const finalWorkingDir = ensureWorkingDir(workingDir, benchmarkName);
    const options = {
        cwd: finalWorkingDir || process.cwd(),
        env: process.env,
        timeoutMs: timeoutMs ?? undefined,
    };

    console.log(`[RUN] ${benchmarkName}`);
    console.log(`[RUN] command: ${command}`);
    const ok = runShellCommand(command, options);
    if (!ok) {
        console.error(`[FAILED] ${benchmarkName}`);
        process.exit(1);
    }

    console.log(`[OK] ${benchmarkName}`);
}

main();
