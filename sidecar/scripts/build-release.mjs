import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sidecarDir = path.resolve(scriptDir, '..');
const distDir = path.join(sidecarDir, 'dist');
const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'coworkany-sidecar.exe' : 'coworkany-sidecar';
const binaryPath = path.join(distDir, binaryName);
const bridgeSource = path.join(sidecarDir, 'src', 'services', 'playwright-bridge.cjs');
const bridgeTarget = path.join(distDir, 'playwright-bridge.cjs');

mkdirSync(distDir, { recursive: true });

const buildArgs = [
  'build',
  '--compile',
  '--target=bun',
  '-e',
  'electron',
  '-e',
  'chromium-bidi',
  '-e',
  'chromium-bidi/*',
  'src/main.ts',
  `--outfile=${binaryPath}`,
];

if (isWindows) {
  buildArgs.push('--windows-hide-console');
}

const result = spawnSync('bun', buildArgs, {
  cwd: sidecarDir,
  stdio: 'inherit',
  shell: isWindows,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(bridgeSource)) {
  console.error(`Missing Playwright bridge script: ${bridgeSource}`);
  process.exit(1);
}

copyFileSync(bridgeSource, bridgeTarget);
console.log(`Built sidecar binary: ${binaryPath}`);
console.log(`Copied bridge script: ${bridgeTarget}`);
