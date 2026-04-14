#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const CONFIG_PATH = path.join(ROOT_DIR, 'tests', 'composite-benchmark-suite.json');
const WORKING_DIR_MODE_MAP = {
    'env-first': 'CLAW_BENCH_REPO_DIR',
    'osworld-repo': 'OSWORLD_REPO_DIR',
    'browsergym-repo': 'BROWSERGYM_REPO_DIR',
    'gaia2-repo': 'GAIA2_REPO_DIR',
    'the-agent-company-repo': 'THEAGENTCOMPANY_REPO_DIR',
};

function usage() {
    console.error('Usage: bun run scripts/run-composite-benchmarks.mjs [--profile <id>|--all] [--list] [--include-external]');
    process.exit(2);
}

function runCommand(command, args, options = {}) {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        cwd: ROOT_DIR,
        ...options,
    });
    return result.status === 0;
}

function getArgValue(index, args) {
    return index + 1 < args.length ? args[index + 1] : undefined;
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        usage();
    }

    let profile = 'smoke';
    let includeAll = false;
    let listOnly = false;
    let includeExternal = false;

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--all') {
            includeAll = true;
            continue;
        }
        if (arg === '--list') {
            listOnly = true;
            continue;
        }
        if (arg === '--include-external') {
            includeExternal = true;
            continue;
        }
        if (arg === '--profile') {
            const next = getArgValue(i, args);
            if (!next) {
                usage();
            }
            profile = next;
            i += 1;
            continue;
        }
        usage();
    }

    return { profile, includeAll, listOnly, includeExternal };
}

function readSuiteConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error(`[ERROR] 配置文件不存在: ${CONFIG_PATH}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
}

function printList(suite) {
    console.log('组合测试集 Profile:');
    for (const profile of suite.profiles) {
        console.log(`- ${profile.id}: ${profile.name}`);
        console.log(`  ${profile.objective}`);
    }
}

function resolveExternalWorkingDir(step) {
    if (step.repoDirEnv && process.env[step.repoDirEnv]) {
        return process.env[step.repoDirEnv];
    }

    const envName = WORKING_DIR_MODE_MAP[step.workingDirMode] || step.workingDir;
    if (envName && process.env[envName]) {
        return process.env[envName];
    }

    return ROOT_DIR;
}

function runStep(step, includeExternal, failures) {
    if (step.kind === 'bun-test') {
        const files = Array.isArray(step.files) ? step.files : [];
        if (files.length === 0) {
            return;
        }
        const ok = runCommand('bun', ['test', ...files]);
        const isCritical = step.critical !== false;
        if (!ok) {
            if (isCritical) {
                failures.push(step.name || 'bun-test step');
            } else {
                console.log(`[WARN] Non-critical step 失败: ${step.name || 'bun-test step'}`);
            }
        }
        return;
    }

    if (step.kind === 'checklist') {
        const items = Array.isArray(step.items) ? step.items : [];
        console.log(`[CHECKLIST] ${step.name || 'external benchmark'} 注意事项:`);
        for (const item of items) {
            console.log(` - ${item}`);
        }
        return;
    }

    if (step.kind === 'manual') {
        if (!includeExternal) {
            console.log(`[SKIP] ${step.name || 'external benchmark'} 未开启 --include-external`);
            return;
        }
        const prereq = Array.isArray(step.prerequisites) ? step.prerequisites.join('；') : '';
        console.log(`[MANUAL] ${step.name || 'external benchmark'}`);
        if (prereq) {
            console.log(`[MANUAL] 先决条件: ${prereq}`);
        }
        console.log(`[MANUAL] 命令: ${step.command || '未配置'}`);
        return;
    }

    if (step.kind === 'external') {
        if (!includeExternal) {
            console.log(`[SKIP] ${step.name || 'external benchmark'} 未开启 --include-external`);
            return;
        }

        const runner = path.join(ROOT_DIR, step.runner || 'scripts/external/run-external-benchmark-step.mjs');
        const requiredEnv = Array.isArray(step.requiredEnv) ? step.requiredEnv.join(',') : '';
        const bootstrap = Array.isArray(step.bootstrap) ? JSON.stringify(step.bootstrap) : '';
        const workingDir = resolveExternalWorkingDir(step);
        const timeoutMs = step.timeoutMs;

        const commandArgs = [
            'run',
            runner,
            '--name',
            step.name || step.id || 'external-step',
            '--command',
            step.command || '',
            '--working-dir',
            workingDir,
            '--required-env',
            requiredEnv,
            '--skip-on-missing-env',
        ];

        if (bootstrap.length > 0) {
            commandArgs.push('--bootstrap', bootstrap);
        }

        if (typeof timeoutMs === 'number' && timeoutMs > 0) {
            commandArgs.push('--timeout-ms', String(timeoutMs));
        }

        const ok = runCommand('bun', commandArgs);
        const isCritical = step.critical !== false;
        if (!ok) {
            if (isCritical) {
                failures.push(step.name || step.id || 'external step');
            } else {
                console.log(`[WARN] Non-critical external step 失败: ${step.name || step.id || 'external step'}`);
            }
        }
        return;
    }

    console.log(`[WARN] Unknown step kind: ${step.kind}`);
}

function runProfile(profile, includeExternal) {
    const failures = [];
    console.log(`\n=== Running profile: ${profile.id} (${profile.name}) ===`);
    console.log(profile.objective || '');

    for (const step of profile.steps || []) {
        console.log(`\n- Step: ${step.name || 'unnamed'}`);
        runStep(step, includeExternal, failures);
        if (failures.length > 0 && step.critical === true) {
            console.log(`[FAIL] Critical step 失败: ${failures[failures.length - 1]}`);
        }
    }

    return failures;
}

function main() {
    const { profile: targetProfile, includeAll, listOnly, includeExternal } = parseArgs();
    const suite = readSuiteConfig();

    const profileById = new Map(suite.profiles.map((p) => [p.id, p]));

    if (listOnly) {
        printList(suite);
        return;
    }

    const selectedProfiles = includeAll
        ? suite.profiles
        : [profileById.get(targetProfile)].filter(Boolean);

    if (selectedProfiles.length === 0) {
        console.error(`[ERROR] 未找到 profile: ${targetProfile}`);
        printList(suite);
        process.exit(2);
    }

    let failedSteps = 0;
    let totalSteps = 0;
    for (const profile of selectedProfiles) {
        const failures = runProfile(profile, includeExternal);
        totalSteps += (profile.steps || []).length;
        failedSteps += failures.length;
    }

    if (failedSteps > 0) {
        console.error(`\n[FAILED] 总失败 Step: ${failedSteps}/${totalSteps}`);
        process.exit(1);
    }

    console.log(`\n[OK] 完成。`);
}

main();
