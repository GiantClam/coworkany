import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const desktopDir = path.resolve(new URL('..', import.meta.url).pathname);
const appPath = path.join(desktopDir, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'CoworkAny.app');
const swiftScript = path.join(desktopDir, 'tests', 'native-shell-macos.swift');
const promptAccessibility = process.argv.includes('--prompt-accessibility');

if (process.platform !== 'darwin') {
  console.error('[native-shell-macos] This runner is macOS-only.');
  process.exit(1);
}

const args = [swiftScript, '--app', appPath];
if (promptAccessibility) {
  args.push('--prompt-accessibility');
}

const child = spawn('swift', args, {
  cwd: desktopDir,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }
  process.exit(code ?? 1);
});
