import { spawnSync } from 'node:child_process';

/**
 * Run high-risk regression suites and fail fast when filtered tests accidentally
 * match zero cases (a common false-green failure mode with name-pattern runs).
 */
const suites = [
    {
        name: 'tls-runtime-classification',
        args: [
            'test',
            'tests/runtime-error-classifier.test.ts',
            'tests/task-execution-service.test.ts',
            'tests/runtime-llm-env-seed.test.ts',
            '--test-name-pattern',
            'classifies certificate chain failures as configuration-required TLS trust errors'
            + '|keeps workflow failure for persistent TLS trust error without retries or direct fallback'
            + '|seeds insecure TLS env when active provider enables allowInsecureTls',
        ],
        minPass: 3,
    },
    {
        name: 'task-lifecycle-and-retry-guardrails',
        args: [
            'test',
            'tests/mastra-entrypoint.test.ts',
            '--test-name-pattern',
            'start_task emits TASK_FAILED when delegated task executor hangs past watchdog timeout'
            + '|start_task classifies TLS certificate trust failures as configuration-required errors'
            + '|approval_required maps to EFFECT_REQUESTED and report_effect_result resumes run'
            + '|send_task_message auto-retries when task turn has no required tool evidence'
            + '|send_task_message auto-retries workflow missing tool evidence error for command execution tasks'
            + '|retry_task recovers complete-before-approval race without duplicate assistant reply'
            + '|recover_tasks auto mode resumes/retries recoverable tasks and skips approval suspended tasks'
            + '|send_task_message emits supplemental summary when task narrative is too short after required tool evidence',
        ],
        minPass: 8,
    },
    {
        name: 'tool-call-fallback-and-timeout',
        args: [
            'test',
            'tests/phase2-tools.test.ts',
            'tests/execute-task-step.test.ts',
            '--test-name-pattern',
            'bash tool executes safe command'
            + '|bash tool returns non-zero for failed command'
            + '|bash tool returns command recovery hints for missing commands'
            + '|bash tool timeout returns quickly'
            + '|deterministic fallback generates attachment video when model never emits command tool evidence',
        ],
        minPass: 5,
    },
    {
        name: 'remote-session-full-chain-governance',
        args: [
            'test',
            'tests/additional-commands-full-chain.e2e.test.ts',
            '--test-name-pattern',
            'remote session bind \\+ channel event injection roundtrip through main flow'
            + '|remote session governance policy enforces managed tenant requirement in full chain'
            + '|remote session governance policy can enforce managed endpoint requirement in full chain'
            + '|managed channel command governance enforces tenant context in full chain'
            + '|recover_tasks dry-run is reachable in full stdio chain',
        ],
        minPass: 5,
    },
];

function extractPassCount(output) {
    const matches = Array.from(output.matchAll(/(\d+)\s+pass\b/g));
    if (matches.length === 0) {
        return 0;
    }
    return Number.parseInt(matches[matches.length - 1][1], 10);
}

for (const suite of suites) {
    console.log(`\n=== Risk Regression: ${suite.name} ===`);
    console.log(`bun ${suite.args.join(' ')}`);

    const result = spawnSync('bun', suite.args, {
        cwd: process.cwd(),
        encoding: 'utf8',
    });

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    process.stdout.write(stdout);
    process.stderr.write(stderr);

    if ((result.status ?? 1) !== 0) {
        console.error(`[risk-regression] suite "${suite.name}" failed with exit code ${result.status ?? 1}`);
        process.exit(result.status ?? 1);
    }

    const passCount = extractPassCount(`${stdout}\n${stderr}`);
    if (passCount < suite.minPass) {
        console.error(
            `[risk-regression] suite "${suite.name}" expected at least ${suite.minPass} passes, got ${passCount}.`,
        );
        process.exit(1);
    }
}

console.log('\n[risk-regression] all suites passed with expected minimum pass counts.');
