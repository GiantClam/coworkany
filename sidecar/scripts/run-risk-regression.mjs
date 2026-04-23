import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Run high-risk regression suites and fail fast when filtered tests accidentally
 * match zero cases (a common false-green failure mode with name-pattern runs).
 */
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUITE_FIXTURE_PATH = path.resolve(SCRIPT_DIR, '../tests/fixtures/risk-regression-suites.json');

/**
 * @typedef {{
 *   name: string;
 *   cwd?: string;
 *   args: string[];
 *   minPass: number;
 * }} RiskSuite
 */

/**
 * @param {string[]} argv
 * @returns {{suiteFilter: Set<string>}}
 */
function parseArgs(argv) {
    const suiteFilter = new Set();
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--suite') {
            const value = (argv[index + 1] ?? '').trim();
            if (!value) {
                throw new Error('Missing value for --suite');
            }
            suiteFilter.add(value);
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return { suiteFilter };
}

/**
 * @returns {RiskSuite[]}
 */
function loadSuites() {
    const raw = fs.readFileSync(SUITE_FIXTURE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const suites = Array.isArray(parsed?.suites) ? parsed.suites : [];
    return suites.map((suite, index) => {
        const name = typeof suite?.name === 'string' ? suite.name.trim() : '';
        const cwd = typeof suite?.cwd === 'string' ? suite.cwd.trim() : '.';
        const minPass = Number.isFinite(suite?.minPass) ? Math.max(1, Math.floor(suite.minPass)) : 1;
        const args = Array.isArray(suite?.args)
            ? suite.args.filter((value) => typeof value === 'string' && value.length > 0)
            : [];
        if (!name || args.length === 0) {
            throw new Error(`Invalid suite fixture at index ${index}`);
        }
        return {
            name,
            cwd,
            minPass,
            args,
        };
    });
}

function extractPassCount(output) {
    const matches = Array.from(output.matchAll(/(\d+)\s+pass\b/g));
    if (matches.length === 0) {
        return 0;
    }
    return Number.parseInt(matches[matches.length - 1][1], 10);
}

const { suiteFilter } = parseArgs(process.argv.slice(2));
const suites = loadSuites().filter((suite) => (
    suiteFilter.size === 0 || suiteFilter.has(suite.name)
));

if (suites.length === 0) {
    console.error('[risk-regression] no suites matched the current filter.');
    process.exit(1);
}

for (const suite of suites) {
    const suiteCwd = path.resolve(process.cwd(), suite.cwd ?? '.');
    console.log(`\n=== Risk Regression: ${suite.name} ===`);
    console.log(`(cwd=${suiteCwd}) bun ${suite.args.join(' ')}`);

    const result = spawnSync('bun', suite.args, {
        cwd: suiteCwd,
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
