import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sidecarDir = path.resolve(scriptDir, '..');
const distDir = path.join(sidecarDir, 'dist');
const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'coworkany-sidecar.exe' : 'coworkany-sidecar';
const binaryPath = path.join(distDir, binaryName);
const nodeEntryName = 'coworkany-sidecar-node.mjs';
const nodeEntryPath = path.join(distDir, nodeEntryName);
const bridgeSource = path.join(sidecarDir, 'src', 'services', 'playwright-bridge.cjs');
const bridgeTarget = path.join(distDir, 'playwright-bridge.cjs');
const distNodeModulesDir = path.join(distDir, 'node_modules');
const runtimeNodeModules = ['playwright', 'playwright-core'];
const distNodeBinDir = path.join(distDir, 'node', 'bin');
const bundledNodePath = path.join(distNodeBinDir, isWindows ? 'node.exe' : 'node');

mkdirSync(distDir, { recursive: true });
rmSync(path.join(distDir, 'ms-playwright'), { recursive: true, force: true });

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
  '-e',
  'playwright',
  '-e',
  'playwright-core',
  '-e',
  'playwright-core/*',
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

const nodeBundleArgs = [
  'build',
  '--target=node',
  '-e',
  'electron',
  '-e',
  'chromium-bidi',
  '-e',
  'chromium-bidi/*',
  '-e',
  'playwright',
  '-e',
  'playwright-core',
  '-e',
  'playwright-core/*',
  'src/main.ts',
  `--outfile=${nodeEntryPath}`,
];

const nodeBundleResult = spawnSync('bun', nodeBundleArgs, {
  cwd: sidecarDir,
  stdio: 'inherit',
  shell: isWindows,
});

if (nodeBundleResult.status !== 0) {
  process.exit(nodeBundleResult.status ?? 1);
}

if (!existsSync(bridgeSource)) {
  console.error(`Missing Playwright bridge script: ${bridgeSource}`);
  process.exit(1);
}

copyFileSync(bridgeSource, bridgeTarget);

for (const moduleName of runtimeNodeModules) {
  const moduleSource = path.join(sidecarDir, 'node_modules', moduleName);
  const moduleTarget = path.join(distNodeModulesDir, moduleName);

  if (!existsSync(moduleSource)) {
    console.error(`Missing runtime module for packaged sidecar: ${moduleSource}`);
    process.exit(1);
  }

  rmSync(moduleTarget, { recursive: true, force: true });
  cpSync(moduleSource, moduleTarget, { recursive: true, force: true, dereference: true });
}

mkdirSync(distNodeBinDir, { recursive: true });
copyFileSync(process.execPath, bundledNodePath);
if (!isWindows) {
  chmodSync(bundledNodePath, 0o755);
}

console.log(`Built sidecar binary: ${binaryPath}`);
console.log(`Built sidecar Node entry: ${nodeEntryPath}`);
console.log(`Copied bridge script: ${bridgeTarget}`);
console.log(`Bundled runtime modules: ${runtimeNodeModules.join(', ')}`);
console.log(`Bundled Node runtime: ${bundledNodePath}`);
console.log('Bundled Playwright browsers: disabled (use system Chrome)');
