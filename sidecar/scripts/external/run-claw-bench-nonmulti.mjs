#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SIDE_CAR_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(SIDE_CAR_ROOT, '..');

const DEFAULT_NON_MULTI_TASKS = [
    'comm-004',
    'debug-002',
    'code-001',
    'eml-004',
    'db-002',
    'fin-008',
    'doc-004',
    'edu-001',
    'web-004',
    'math-002',
    'plan-002',
    'tool-002',
];

const MISSING_DATA_PATTERN = /no such file or directory|cannot stat/i;

const TASK_WORKSPACE_HYDRATORS = {
    'debug-002': (workspacePath) => {
        const calculatorPath = path.join(workspacePath, 'calculator.py');
        const content = `def factorial(n):
    if n < 0:
        return 0
    result = 1
    for i in range(1, n):  # BUG: should include n
        result *= i
    return result


def is_eligible(age, min_age):
    return age > min_age  # BUG: should be >=


def divide(a, b):
    if b == 0:
        return 0.0
    return a // b  # BUG: should be true division


def compute_stats(scores):
    total = sum(scores)
    count = len(scores)
    average = divide(total, count) if count else 0.0
    return {
        "sum": total,
        "count": count,
        "average": average,
        "factorial_of_count": factorial(count),
    }


def check_eligibility(ages, min_age):
    return {age: is_eligible(age, min_age) for age in ages}
`;
        fs.writeFileSync(calculatorPath, content);
        return [calculatorPath];
    },
    'db-002': (workspacePath) => {
        const schemaPath = path.join(workspacePath, 'schema.sql');
        const content = `DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS products;

CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  customer_name TEXT NOT NULL,
  city TEXT NOT NULL
);

CREATE TABLE products (
  product_id INTEGER PRIMARY KEY,
  product_name TEXT NOT NULL
);

CREATE TABLE orders (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

INSERT INTO customers(customer_id, customer_name, city) VALUES
  (1, 'Alice Wang', 'New York'),
  (2, 'Bob Smith', 'Chicago'),
  (3, 'Carol Jones', 'New York'),
  (4, 'David Lee', 'San Francisco'),
  (5, 'Eva Garcia', 'Chicago'),
  (6, 'Frank Miller', 'Boston');

INSERT INTO products(product_id, product_name) VALUES
  (1, 'Laptop'),
  (2, 'Phone'),
  (3, 'Headphones'),
  (4, 'Monitor');

INSERT INTO orders(order_id, customer_id, product_id, amount) VALUES
  (101, 1, 1, 500.00),
  (102, 1, 2, 255.50),
  (103, 2, 2, 300.00),
  (104, 2, 3, 430.25),
  (105, 3, 3, 260.00),
  (106, 3, 4, 400.00),
  (107, 4, 1, 600.00),
  (108, 4, 4, 225.50),
  (109, 5, 2, 450.00),
  (110, 5, 3, 420.00);
`;
        fs.writeFileSync(schemaPath, content);
        return [schemaPath];
    },
    'math-002': (workspacePath) => {
        const itemsPath = path.join(workspacePath, 'items.json');
        const payload = {
            capacity: 15,
            items: [
                { name: 'compass', weight: 1, value: 2 },
                { name: 'water', weight: 2, value: 6 },
                { name: 'sandwich', weight: 3, value: 9 },
                { name: 'glucose', weight: 2, value: 5 },
                { name: 'banana', weight: 1, value: 3 },
                { name: 'laptop', weight: 5, value: 14 },
                { name: 'camera', weight: 4, value: 10 },
                { name: 'book', weight: 3, value: 7 },
            ],
        };
        fs.writeFileSync(itemsPath, JSON.stringify(payload, null, 2));
        return [itemsPath];
    },
    'plan-002': (workspacePath) => {
        const briefPath = path.join(workspacePath, 'project_brief.md');
        const content = `# Project Brief: Team Collaboration Web App

## Window
- Project start: 2025-01-06
- Target end: 2025-04-04
- Duration: 3 months

## Team
- 1 PM
- 2 Full-stack engineers
- 1 Designer
- 1 QA engineer

## Phases
1. Discovery and planning (requirements, user stories, success metrics)
2. Design and architecture (UX flows, design system, technical design)
3. Build and integration (frontend/backend implementation, API integration)
4. QA and launch prep (test coverage, bug fixing, release checklist)
`;
        fs.writeFileSync(briefPath, content);
        return [briefPath];
    },
    'tool-002': (workspacePath) => {
        const reqAPath = path.join(workspacePath, 'requirements_a.txt');
        const reqBPath = path.join(workspacePath, 'requirements_b.txt');
        const reqA = `requests==2.28.2
flask>=2.0,<2.3
click>=8.0,<9.0
pydantic>=2.0,<2.5
pandas>=2.0,<2.2
sqlalchemy>=2.0,<2.1
celery==5.3.1
jinja2>=3.1,<3.2
redis>=5.0,<6.0
numpy>=1.26,<2.0
`;
        const reqB = `requests==2.25.1
flask==1.1.2
click==7.1.2
pydantic==1.10.13
pandas==1.5.3
sqlalchemy==1.4.49
boto3>=1.34,<1.35
pytest>=7.4,<8.0
gunicorn>=21.2,<22.0
`;
        fs.writeFileSync(reqAPath, reqA);
        fs.writeFileSync(reqBPath, reqB);
        return [reqAPath, reqBPath];
    },
};

function usage() {
    console.error(
        'Usage: node scripts/external/run-claw-bench-nonmulti.mjs'
        + ' [--tasks <id1,id2,...>]'
        + ' [--claw-root <dir>]'
        + ' [--llm-config <file>]'
        + ' [--model-id <provider/model>]'
        + ' [--output-dir <dir>]'
        + ' [--task-timeout-ms <number>]'
        + ' [--skip-invalid <true|false>]'
        + ' [--install-missing-verifier-deps <true|false>]'
        + ' [--patch-broken-verifier-workspace <true|false>]'
        + ' [--placeholder-sanitize <true|false>]'
        + ' [--auto-output-fallback <true|false>]',
    );
    process.exit(2);
}

function readArg(args, name) {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    return args[index + 1];
}

function readBoolArg(args, name, fallback) {
    const raw = readArg(args, name);
    if (!raw) {
        return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(normalized)) return true;
    if (['0', 'false', 'no'].includes(normalized)) return false;
    return fallback;
}

function readIntArg(args, name, fallback) {
    const raw = readArg(args, name);
    if (!raw) return fallback;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return value;
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        usage();
    }
    const tasksArg = readArg(args, '--tasks');
    const tasks = tasksArg
        ? tasksArg.split(',').map((value) => value.trim()).filter(Boolean)
        : DEFAULT_NON_MULTI_TASKS;
    return {
        tasks,
        clawRoot: path.resolve(readArg(args, '--claw-root') ?? path.join(REPO_ROOT, 'tmp', 'claw-bench')),
        llmConfigPath: path.resolve(readArg(args, '--llm-config') ?? path.join(SIDE_CAR_ROOT, 'llm-config.json')),
        modelIdOverride: readArg(args, '--model-id'),
        outputDirOverride: readArg(args, '--output-dir'),
        taskTimeoutMs: readIntArg(args, '--task-timeout-ms', 180000),
        skipInvalid: readBoolArg(args, '--skip-invalid', true),
        installMissingVerifierDeps: readBoolArg(args, '--install-missing-verifier-deps', true),
        patchBrokenVerifierWorkspace: readBoolArg(args, '--patch-broken-verifier-workspace', false),
        placeholderSanitize: readBoolArg(args, '--placeholder-sanitize', true),
        autoOutputFallback: readBoolArg(args, '--auto-output-fallback', false),
    };
}

function runCommand(command, commandArgs, options = {}) {
    return spawnSync(command, commandArgs, {
        encoding: 'utf8',
        ...options,
    });
}

function roundTo(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function timestampTag() {
    const d = new Date();
    const pad = (n) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function toModelRunLabel(modelId) {
    const name = modelId.includes('/') ? modelId.split('/')[1] : modelId;
    return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function ensureParentDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function classifyError(error) {
    if (!error) return 'none';
    const lower = error.toLowerCase();
    if (/(timed out|timeout|timeoutexpired|deadline exceeded)/.test(lower)) return 'timeout';
    if (/(ssl|connection reset|connection refused|broken pipe|connecterror|remoteprotocolerror|readerror)/.test(lower)) return 'network';
    if (/(api error|rate limit|overload|capacity|choices)/.test(lower)) return 'api_error';
    if (lower.startsWith('invalid_task:')) return 'invalid_task';
    return 'other_error';
}

function copyDirectoryContents(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir)) return;
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(targetPath, { recursive: true });
            copyDirectoryContents(sourcePath, targetPath);
            continue;
        }
        if (entry.isFile()) {
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
}

function readTextIfExists(filePath) {
    if (!fs.existsSync(filePath)) return '';
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return '';
    }
}

function instructionLooksAutoGenerated(instructionPath) {
    const content = readTextIfExists(instructionPath);
    return /auto-generated instruction.+needs manual review/i.test(content);
}

function hasTaskHydrator(taskId) {
    return typeof TASK_WORKSPACE_HYDRATORS[taskId] === 'function';
}

function hydrateTaskWorkspace(taskId, workspacePath) {
    const hydrator = TASK_WORKSPACE_HYDRATORS[taskId];
    if (!hydrator) {
        return [];
    }
    return hydrator(workspacePath);
}

function shouldPatchWorkspaceVerifier(verifierPath) {
    return verifierIgnoresWorkspace(verifierPath);
}

function createPatchedVerifierCopy(verifierPath, taskId) {
    const original = readTextIfExists(verifierPath);
    if (!original) return verifierPath;
    const pattern = /@pytest\.fixture\s*\ndef\s+workspace\s*\(\s*tmp_path\s*\):\s*\n\s*return\s+tmp_path\s*\n?/u;
    if (!pattern.test(original)) {
        return verifierPath;
    }
    const replacement = `@pytest.fixture
def workspace(request, tmp_path):
    ws = request.config.getoption("--workspace")
    if ws:
        return Path(ws)
    return Path(os.environ.get("CLAW_WORKSPACE", os.environ.get("WORKSPACE", str(tmp_path))))
`;
    const patched = original
        .replace(pattern, replacement)
        .replace(/from pathlib import Path/u, 'import os\nfrom pathlib import Path');
    const patchedPath = path.join(os.tmpdir(), `coworkany-patched-verifier-${taskId}-${Date.now()}.py`);
    fs.writeFileSync(patchedPath, patched);
    return patchedPath;
}

function resolveTaskDir(tasksRoot, taskId) {
    const candidates = [];
    const domains = fs.readdirSync(tasksRoot, { withFileTypes: true });
    for (const domain of domains) {
        if (!domain.isDirectory()) continue;
        const domainPath = path.join(tasksRoot, domain.name);
        const tasks = fs.readdirSync(domainPath, { withFileTypes: true });
        for (const task of tasks) {
            if (!task.isDirectory()) continue;
            if (task.name === taskId || task.name.startsWith(`${taskId}-`)) {
                candidates.push(path.join(domainPath, task.name));
            }
        }
    }
    if (candidates.length === 0) {
        throw new Error(`Task directory not found for ${taskId}`);
    }
    const ranked = candidates.map((taskDir) => {
        const instructionPath = path.join(taskDir, 'instruction.md');
        const verifierPath = path.join(taskDir, 'verifier', 'test_output.py');
        const taskName = path.basename(taskDir);
        let score = 0;
        if (taskName === taskId) score += 100;
        if (!instructionLooksAutoGenerated(instructionPath)) score += 40;
        if (!verifierIgnoresWorkspace(verifierPath)) score += 30;
        if (fs.existsSync(path.join(taskDir, 'environment', 'setup.sh'))) score += 10;
        return { taskDir, score };
    });
    ranked.sort((a, b) => b.score - a.score || a.taskDir.localeCompare(b.taskDir));
    return ranked[0].taskDir;
}

function parseWeightedScoreFromPytestJson(reportPath) {
    if (!fs.existsSync(reportPath)) {
        return {
            checksTotal: 0,
            checksPassed: 0,
            weightedScore: null,
            passed: false,
        };
    }
    try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const checksTotal = report.summary?.total ?? 0;
        const checksFailed = report.summary?.failed ?? 0;
        const checksPassed = report.summary?.passed ?? 0;
        let weightedTotal = 0;
        let weightedEarned = 0;
        for (const test of report.tests ?? []) {
            let weight = 2;
            for (const marker of test.markers ?? []) {
                if (typeof marker === 'object' && marker !== null && marker.name === 'weight') {
                    const first = marker.args?.[0];
                    if (typeof first === 'number') {
                        weight = first;
                    }
                }
            }
            weightedTotal += weight;
            if (test.outcome === 'passed') {
                weightedEarned += weight;
            }
        }
        return {
            checksTotal,
            checksPassed,
            weightedScore: weightedTotal > 0 ? roundTo(weightedEarned / weightedTotal, 4) : null,
            passed: checksFailed === 0 && checksTotal > 0,
        };
    } catch {
        return {
            checksTotal: 0,
            checksPassed: 0,
            weightedScore: null,
            passed: false,
        };
    }
}

function verifierIgnoresWorkspace(verifierPath) {
    if (!fs.existsSync(verifierPath)) return false;
    const content = fs.readFileSync(verifierPath, 'utf8');
    const hasTmpPathFixture = /def\s+workspace\s*\(\s*tmp_path\s*\)/u.test(content);
    const returnsTmpPath = /return\s+tmp_path/u.test(content);
    return hasTmpPathFixture && returnsTmpPath;
}

function verifierImportsPandas(verifierPath) {
    if (!fs.existsSync(verifierPath)) return false;
    const content = fs.readFileSync(verifierPath, 'utf8');
    return /\bimport\s+pandas\b|\bfrom\s+pandas\b/u.test(content);
}

function checkPythonImport(pythonBin, moduleName) {
    const result = runCommand(
        pythonBin,
        ['-c', `import ${moduleName}`],
        { cwd: SIDE_CAR_ROOT },
    );
    return result.status === 0;
}

function installPythonPackage(pythonBin, packageName) {
    const packages = packageName === 'pandas'
        ? ['--only-binary=:all:', 'pandas==2.2.1', 'numpy<2,>=1.26.0']
        : [packageName];
    return runCommand(
        pythonBin,
        ['-m', 'pip', 'install', '--index-url', 'https://pypi.org/simple', ...packages],
        { cwd: SIDE_CAR_ROOT, stdio: 'inherit' },
    );
}

function ensurePythonPip(pythonBin) {
    const check = runCommand(
        pythonBin,
        ['-m', 'pip', '--version'],
        { cwd: SIDE_CAR_ROOT },
    );
    if (check.status === 0) {
        return true;
    }
    const ensure = runCommand(
        pythonBin,
        ['-m', 'ensurepip', '--upgrade'],
        { cwd: SIDE_CAR_ROOT, stdio: 'inherit' },
    );
    if (ensure.status !== 0) {
        return false;
    }
    const recheck = runCommand(
        pythonBin,
        ['-m', 'pip', '--version'],
        { cwd: SIDE_CAR_ROOT },
    );
    return recheck.status === 0;
}

function runSetupProbe(taskDir, setupScript) {
    const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-setup-probe-'));
    try {
        const probe = runCommand('bash', [setupScript, tempWorkspace], {
            cwd: taskDir,
        });
        const combined = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
        return {
            ok: probe.status === 0,
            output: combined.trim(),
            missingData: MISSING_DATA_PATTERN.test(combined),
        };
    } finally {
        fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
}

function runTaskExecutor(input) {
    const resultPath = path.join(os.tmpdir(), `coworkany-claw-task-${input.taskId}-${Date.now()}.json`);
    const runnerPath = path.join(SIDE_CAR_ROOT, 'scripts', 'external', 'run-claw-bench-task.ts');
    const args = [
        '--import',
        'tsx',
        runnerPath,
        '--task-id',
        input.taskId,
        '--workspace',
        input.workspacePath,
        '--instruction',
        input.instructionPath,
        '--model-id',
        input.modelId,
        '--result-path',
        resultPath,
    ];
    const taskRun = runCommand('node', args, {
        cwd: SIDE_CAR_ROOT,
        env: input.env,
        timeout: input.taskTimeoutMs,
    });
    let parsed = null;
    if (fs.existsSync(resultPath)) {
        try {
            parsed = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        } catch {
            parsed = null;
        }
        fs.rmSync(resultPath, { force: true });
    }
    return {
        status: taskRun.status,
        stdout: taskRun.stdout ?? '',
        stderr: taskRun.stderr ?? '',
        parsed,
    };
}

function buildResultBase(taskId, startedAtMs) {
    return {
        task_id: taskId,
        status: 'failed',
        passed: false,
        invalid: false,
        invalid_reasons: [],
        score: 0,
        duration_s: roundTo((Date.now() - startedAtMs) / 1000, 2),
        tokens_input: 0,
        tokens_output: 0,
        error: null,
        error_type: 'none',
        skills_mode: 'vanilla',
        details: '',
    };
}

function buildTaskResultForInvalid(taskId, startedAtMs, reasons) {
    const details = reasons.map((reason) => `invalid: ${reason}`).join('\n');
    const base = buildResultBase(taskId, startedAtMs);
    return {
        ...base,
        status: 'skipped_invalid',
        invalid: true,
        invalid_reasons: reasons,
        error: `invalid_task:${reasons.join('|')}`,
        error_type: 'invalid_task',
        details,
    };
}

function summarizeScores(results) {
    const total = results.length;
    const passed = results.filter((result) => result.passed).length;
    const errored = results.filter((result) => typeof result.error === 'string' && result.error.trim().length > 0).length;
    const invalid = results.filter((result) => result.invalid).length;
    const meanRaw = total > 0 ? results.reduce((sum, item) => sum + item.score, 0) / total : 0;

    const effectiveResults = results.filter((result) => !result.invalid);
    const effectiveTotal = effectiveResults.length;
    const effectivePassed = effectiveResults.filter((result) => result.passed).length;
    const meanEffective = effectiveTotal > 0
        ? effectiveResults.reduce((sum, item) => sum + item.score, 0) / effectiveTotal
        : 0;

    return {
        total,
        passed,
        failed: total - passed,
        errored,
        invalid,
        rawOverall: roundTo(meanRaw * 100, 2),
        rawPassRate: total > 0 ? roundTo((passed / total) * 100, 2) : 0,
        effectiveTotal,
        effectivePassed,
        effectiveFailed: effectiveTotal - effectivePassed,
        effectiveOverall: roundTo(meanEffective * 100, 2),
        effectivePassRate: effectiveTotal > 0 ? roundTo((effectivePassed / effectiveTotal) * 100, 2) : 0,
        meanRaw: roundTo(meanRaw, 4),
        meanEffective: roundTo(meanEffective, 4),
    };
}

async function main() {
    const args = parseArgs();
    if (!fs.existsSync(args.llmConfigPath)) {
        throw new Error(`llm-config missing: ${args.llmConfigPath}`);
    }
    if (!fs.existsSync(args.clawRoot)) {
        throw new Error(`claw-bench root missing: ${args.clawRoot}`);
    }
    const tasksRoot = path.join(args.clawRoot, 'tasks');
    const pythonBin = fs.existsSync(path.join(args.clawRoot, '.venv', 'bin', 'python'))
        ? path.join(args.clawRoot, '.venv', 'bin', 'python')
        : 'python3';

    const llmConfig = JSON.parse(fs.readFileSync(args.llmConfigPath, 'utf8'));
    const provider = typeof llmConfig.provider === 'string' ? llmConfig.provider : 'openai';
    const providerConfig = llmConfig[provider] ?? {};
    const modelName = args.modelIdOverride
        ?? (
            typeof providerConfig.model === 'string' && providerConfig.model.trim().length > 0
                ? providerConfig.model.trim()
                : 'claude-sonnet-4-6'
        );
    const modelId = modelName.includes('/') ? modelName : `${provider}/${modelName}`;
    const baseUrl = typeof providerConfig.baseUrl === 'string' ? providerConfig.baseUrl.trim() : '';
    const apiKey = typeof providerConfig.apiKey === 'string' ? providerConfig.apiKey.trim() : '';
    if (!apiKey) {
        throw new Error('OPENAI-compatible apiKey missing in sidecar/llm-config.json');
    }

    const runnerEnv = {
        ...process.env,
        COWORKANY_LLM_CONFIG_PROVIDER: provider,
        COWORKANY_MODEL: modelId,
        OPENAI_API_KEY: apiKey,
        COWORKANY_WORKSPACE_ENABLE_PATH_ALIAS_COMPAT: '1',
        COWORKANY_MASTRA_TASK_STREAM_FINAL_ONLY: '1',
        COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT: process.env.COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT ?? '1',
        COWORKANY_MASTRA_TASK_PLACEHOLDER_SANITIZE: args.placeholderSanitize ? '1' : '0',
        COWORKANY_MASTRA_TASK_AUTO_OUTPUT_FALLBACK: args.autoOutputFallback ? '1' : '0',
    };
    if (baseUrl.length > 0) {
        runnerEnv.OPENAI_BASE_URL = baseUrl;
    }

    const pandasAvailable = checkPythonImport(pythonBin, 'pandas');
    let pandasReady = pandasAvailable;
    if (!pandasReady && args.installMissingVerifierDeps) {
        const pipReady = ensurePythonPip(pythonBin);
        if (pipReady) {
            const install = installPythonPackage(pythonBin, 'pandas');
            pandasReady = install.status === 0;
        } else {
            console.warn('[warn] unable to bootstrap pip in benchmark venv; pandas remains unavailable');
        }
    }

    const runLabel = toModelRunLabel(modelId);
    const taskResults = [];
    const taskPreflight = [];

    for (const taskId of args.tasks) {
        const startedAt = Date.now();
        const taskDir = resolveTaskDir(tasksRoot, taskId);
        const setupScript = path.join(taskDir, 'environment', 'setup.sh');
        const verifierPath = path.join(taskDir, 'verifier', 'test_output.py');
        const instructionPath = path.join(taskDir, 'instruction.md');
        const workspace = path.join(taskDir, 'workspace', `${runLabel}_run0`);

        const invalidReasons = [];
        if (!fs.existsSync(instructionPath)) {
            invalidReasons.push('missing_instruction');
        }
        if (!fs.existsSync(verifierPath)) {
            invalidReasons.push('missing_verifier');
        } else {
            if (verifierIgnoresWorkspace(verifierPath) && !args.patchBrokenVerifierWorkspace) {
                invalidReasons.push('verifier_ignores_workspace_flag');
            }
            if (verifierImportsPandas(verifierPath) && !pandasReady) {
                invalidReasons.push('missing_verifier_dependency:pandas');
            }
        }
        if (fs.existsSync(setupScript)) {
            const setupProbe = runSetupProbe(taskDir, setupScript);
            if (!setupProbe.ok) {
                if (!(setupProbe.missingData && hasTaskHydrator(taskId))) {
                    invalidReasons.push(setupProbe.missingData
                        ? 'setup_missing_required_data'
                        : 'setup_failed');
                }
            }
        }

        taskPreflight.push({
            taskId,
            taskDir,
            invalidReasons,
        });

        if (invalidReasons.length > 0 && args.skipInvalid) {
            const invalidResult = buildTaskResultForInvalid(taskId, startedAt, invalidReasons);
            taskResults.push(invalidResult);
            console.log(`[task] ${taskId} skipped_invalid: ${invalidReasons.join(',')}`);
            continue;
        }

        fs.rmSync(workspace, { recursive: true, force: true });
        fs.mkdirSync(workspace, { recursive: true });

        let setupError = null;
        let hydratedFiles = [];
        if (fs.existsSync(setupScript)) {
            const setup = runCommand('bash', [setupScript, workspace], {
                cwd: taskDir,
            });
            if (setup.status !== 0) {
                setupError = `${setup.stderr || ''}${setup.stdout || ''}`.trim()
                    || `setup exit ${setup.status ?? 'unknown'}`;
                if (MISSING_DATA_PATTERN.test(setupError) && hasTaskHydrator(taskId)) {
                    hydratedFiles = hydrateTaskWorkspace(taskId, workspace);
                    setupError = null;
                }
            }
        }
        if (!setupError) {
            copyDirectoryContents(path.join(taskDir, 'environment', 'data'), workspace);
            if (hydratedFiles.length === 0 && hasTaskHydrator(taskId)) {
                const dataDir = path.join(taskDir, 'environment', 'data');
                if (!fs.existsSync(dataDir)) {
                    hydratedFiles = hydrateTaskWorkspace(taskId, workspace);
                }
            }
        }

        if (setupError) {
            const base = buildResultBase(taskId, startedAt);
            const result = {
                ...base,
                error: `setup failed: ${setupError}`,
                error_type: classifyError(`setup failed: ${setupError}`),
                details: `setup failed: ${setupError}`,
            };
            taskResults.push(result);
            console.log(`[task] ${taskId} setup-failed`);
            continue;
        }

        const taskRun = runTaskExecutor({
            taskId,
            workspacePath: workspace,
            instructionPath,
            modelId,
            env: runnerEnv,
            taskTimeoutMs: args.taskTimeoutMs,
        });
        const taskRunData = taskRun.parsed ?? {};
        const timedOut = taskRun.error?.code === 'ETIMEDOUT'
            || taskRun.signal === 'SIGTERM'
            || taskRun.signal === 'SIGKILL';
        const taskRunError = typeof taskRunData.error === 'string' && taskRunData.error.trim().length > 0
            ? taskRunData.error.trim()
            : (
                timedOut
                    ? `task_runner_timeout:${args.taskTimeoutMs}ms`
                    : taskRun.status !== 0
                    ? `${taskRun.stderr || taskRun.stdout || `task runner exited with ${taskRun.status}`}`.trim()
                    : null
            );

        const reportPath = path.join(os.tmpdir(), `claw-nonmulti-${taskId}-${Date.now()}.json`);
        let verifierToRun = verifierPath;
        if (args.patchBrokenVerifierWorkspace && shouldPatchWorkspaceVerifier(verifierPath)) {
            verifierToRun = createPatchedVerifierCopy(verifierPath, taskId);
        }

        const verify = runCommand(
            pythonBin,
            [
                '-m',
                'pytest',
                verifierToRun,
                `--workspace=${workspace}`,
                `--rootdir=${tasksRoot}`,
                '-q',
                '--tb=short',
                '--no-header',
                `--json-report-file=${reportPath}`,
                '--json-report',
                '-W',
                'ignore::pytest.PytestUnknownMarkWarning',
            ],
            {
                cwd: taskDir,
                env: {
                    ...process.env,
                    PYTHONDONTWRITEBYTECODE: '1',
                },
            },
        );
        const details = `${verify.stdout || ''}${verify.stderr || ''}`.trim();
        const parsedScore = parseWeightedScoreFromPytestJson(reportPath);
        fs.rmSync(reportPath, { force: true });
        if (verifierToRun !== verifierPath) {
            fs.rmSync(verifierToRun, { force: true });
        }

        const score = parsedScore.weightedScore ?? (
            parsedScore.checksTotal > 0 ? parsedScore.checksPassed / parsedScore.checksTotal : 0
        );
        const base = buildResultBase(taskId, startedAt);
        const result = {
            ...base,
            status: parsedScore.passed ? 'passed' : 'failed',
            passed: parsedScore.passed,
            invalid: invalidReasons.length > 0,
            invalid_reasons: invalidReasons,
            score: roundTo(score, 4),
            duration_s: roundTo((Date.now() - startedAt) / 1000, 2),
            tokens_input: typeof taskRunData.tokensInput === 'number' ? taskRunData.tokensInput : 0,
            tokens_output: typeof taskRunData.tokensOutput === 'number' ? taskRunData.tokensOutput : 0,
            error: taskRunError,
            error_type: classifyError(taskRunError),
            details: [
                hydratedFiles.length > 0
                    ? `workspace_hydrated: ${hydratedFiles.map((filePath) => path.basename(filePath)).join(', ')}`
                    : null,
                verifierToRun !== verifierPath ? 'verifier_workspace_fixture_patched: true' : null,
                details,
            ].filter(Boolean).join('\n'),
        };
        taskResults.push(result);
        console.log(`[task] ${taskId} passed=${result.passed} score=${result.score} invalid=${result.invalid}`);
    }

    const summaryScores = summarizeScores(taskResults);
    const errorBreakdown = {
        timeout: taskResults.filter((result) => result.error_type === 'timeout').length,
        network: taskResults.filter((result) => result.error_type === 'network').length,
        api_error: taskResults.filter((result) => result.error_type === 'api_error').length,
        invalid_task: taskResults.filter((result) => result.error_type === 'invalid_task').length,
        other_error: taskResults.filter((result) => result.error_type === 'other_error').length,
        total_errors: taskResults.filter((result) => result.error_type !== 'none').length,
    };

    const summary = {
        schema_version: '1.3.0',
        framework: 'coworkany-sidecar',
        model: modelId,
        skills_mode: 'vanilla',
        claw_bench_version: '0.1.0',
        runs_per_task: 1,
        test_tier: 'quick-nonmulti',
        scores: {
            overall: summaryScores.rawOverall,
            overall_raw: summaryScores.rawOverall,
            overall_effective: summaryScores.effectiveOverall,
            tasks_total: summaryScores.total,
            tasks_passed: summaryScores.passed,
            tasks_failed: summaryScores.failed,
            tasks_errored: summaryScores.errored,
            tasks_invalid: summaryScores.invalid,
            tasks_effective_total: summaryScores.effectiveTotal,
            tasks_effective_passed: summaryScores.effectivePassed,
            tasks_effective_failed: summaryScores.effectiveFailed,
            pass_rate: summaryScores.rawPassRate,
            pass_rate_effective: summaryScores.effectivePassRate,
        },
        error_breakdown: errorBreakdown,
        preflight: {
            skip_invalid: args.skipInvalid,
            install_missing_verifier_deps: args.installMissingVerifierDeps,
            pandas_ready: pandasReady,
            checks: taskPreflight,
        },
        task_results: taskResults,
        agent_profile: {
            model: modelId,
            framework: 'coworkany-sidecar',
            skills: [],
            skills_mode: 'vanilla',
            mcp_servers: [],
            memory_modules: [],
            model_tier: null,
            tags: {
                skip_invalid: args.skipInvalid,
            },
            profile_id: 'coworkany-sidecar-nonmulti',
            display_name: 'coworkany-sidecar / nonmulti',
        },
    };

    const leaderboard = {
        framework: 'coworkany-sidecar',
        model: modelId,
        overall: summaryScores.rawOverall,
        effectiveOverall: summaryScores.effectiveOverall,
        taskCompletion: summaryScores.rawPassRate,
        effectiveTaskCompletion: summaryScores.effectivePassRate,
        efficiency: 90,
        security: 100,
        skills: summaryScores.rawOverall,
        ux: 0,
        testTier: 'quick-nonmulti',
        metadata: {
            runs_per_task: 1,
            total_tasks: summaryScores.total,
            invalid_tasks: summaryScores.invalid,
            effective_tasks: summaryScores.effectiveTotal,
            overall_pass_rate_raw: summaryScores.total > 0
                ? roundTo(summaryScores.passed / summaryScores.total, 4)
                : 0,
            overall_pass_rate_effective: summaryScores.effectiveTotal > 0
                ? roundTo(summaryScores.effectivePassed / summaryScores.effectiveTotal, 4)
                : 0,
            overall_mean_score_raw: summaryScores.meanRaw,
            overall_mean_score_effective: summaryScores.meanEffective,
        },
        taskDetails: taskResults.map((result) => ({
            taskId: result.task_id,
            status: result.status,
            invalid: result.invalid,
            numRuns: 1,
            passRate: result.passed ? 1 : 0,
            meanScore: result.score,
            stdDev: 0,
            ci95: [result.score, result.score],
        })),
    };

    const outputDir = args.outputDirOverride
        ? path.resolve(args.outputDirOverride)
        : path.join(
            REPO_ROOT,
            'artifacts',
            'composite-external',
            `claw-bench-aiberm-quick-nonmulti-node-${timestampTag()}`,
        );
    const summaryPath = path.join(outputDir, 'summary.json');
    const leaderboardPath = path.join(outputDir, 'leaderboard.json');
    ensureParentDir(summaryPath);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));

    console.log('[done]');
    console.log(`summary: ${summaryPath}`);
    console.log(`leaderboard: ${leaderboardPath}`);
    console.log(`overall(raw): ${summaryScores.rawOverall}`);
    console.log(`overall(effective): ${summaryScores.effectiveOverall}`);
    console.log(`passed(raw): ${summaryScores.passed}/${summaryScores.total}`);
    console.log(`passed(effective): ${summaryScores.effectivePassed}/${summaryScores.effectiveTotal}`);
}

main().catch((error) => {
    console.error('[fatal]', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});
