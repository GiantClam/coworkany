import { spawnSync } from 'node:child_process';

const files = process.argv.slice(2);

if (files.length === 0) {
    console.error('Usage: node scripts/run-tests-sequential.mjs <test-file> [test-file...]');
    process.exit(1);
}

for (const file of files) {
    console.log(`\n=== bun test ${file} ===`);
    const result = spawnSync('bun', ['test', file], {
        stdio: 'inherit',
        cwd: process.cwd(),
    });

    if ((result.status ?? 1) !== 0) {
        process.exit(result.status ?? 1);
    }
}
