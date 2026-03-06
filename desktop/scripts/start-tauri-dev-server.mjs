import { execSync, spawn } from 'node:child_process';
import process from 'node:process';

const DEV_PORT = Number(process.env.TAURI_DEV_PORT || 5173);

function parseWindowsListeningPids(port) {
  const output = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  const lines = output.split(/\r?\n/);
  const pids = new Set();
  const portPattern = new RegExp(`:${port}\\s+`, 'i');

  for (const line of lines) {
    if (!/LISTENING/i.test(line) || !portPattern.test(line)) {
      continue;
    }
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (Number.isFinite(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  return [...pids];
}

function getWindowsProcessCommandLine(pid) {
  try {
    const command = `$proc = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($proc) { $proc.CommandLine }`;
    return execSync(`powershell -NoProfile -NonInteractive -Command "${command}"`, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function getWindowsProcessImageName(pid) {
  try {
    const output = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' }).trim();
    if (!output || output.startsWith('INFO:')) return '';
    const cols = output.split('","').map((part) => part.replace(/^"/, '').replace(/"$/, ''));
    return (cols[0] || '').trim();
  } catch {
    return '';
  }
}

function listWindowsDesktopDebugPids() {
  try {
    const command = `
$items = Get-CimInstance Win32_Process -Filter "Name = 'coworkany-desktop.exe'" |
  Select-Object ProcessId, CommandLine |
  ConvertTo-Json -Compress
if ($items) { $items }
`;
    const raw = execSync(`powershell -NoProfile -NonInteractive -Command "${command}"`, { encoding: 'utf8' }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((item) => {
        const cmd = String(item.CommandLine || '').toLowerCase();
        return cmd.includes('\\desktop\\src-tauri\\target\\debug\\coworkany-desktop.exe');
      })
      .map((item) => Number(item.ProcessId))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

function killWindowsDesktopDebugProcesses() {
  const pids = listWindowsDesktopDebugPids();
  for (const pid of pids) {
    console.log(`[dev-server] Killing existing debug desktop process PID ${pid}`);
    execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'inherit' });
  }
}

function killWindowsViteOnPort(port) {
  const pids = parseWindowsListeningPids(port);
  for (const pid of pids) {
    const cmdline = getWindowsProcessCommandLine(pid).toLowerCase();
    const imageName = getWindowsProcessImageName(pid).toLowerCase();
    if (cmdline.includes('vite')) {
      console.log(`[dev-server] Killing existing vite process on port ${port}: PID ${pid}`);
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'inherit' });
      continue;
    }

    // Some Windows environments fail to read command line reliably; allow killing node.exe on the Vite port.
    if (!cmdline && imageName === 'node.exe') {
      console.log(`[dev-server] Command line unavailable for PID ${pid}; killing node.exe on port ${port}`);
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'inherit' });
      continue;
    }

    if (cmdline.length > 0) {
      throw new Error(
        `[dev-server] Port ${port} is occupied by non-vite process PID ${pid}: ${cmdline}`
      );
    }

    throw new Error(
      `[dev-server] Port ${port} is occupied by PID ${pid} (${imageName || 'unknown'}), unable to confirm it is vite.`
    );
  }
}

function parseUnixListeningPids(port) {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' }).trim();
    if (!output) return [];
    return output
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch {
    return [];
  }
}

function killUnixViteOnPort(port) {
  const pids = parseUnixListeningPids(port);
  for (const pid of pids) {
    try {
      const cmdline = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' })
        .trim()
        .toLowerCase();

      if (cmdline.includes('vite')) {
        console.log(`[dev-server] Killing existing vite process on port ${port}: PID ${pid}`);
        process.kill(pid, 'SIGKILL');
        continue;
      }

      throw new Error(
        `[dev-server] Port ${port} is occupied by non-vite process PID ${pid}: ${cmdline}`
      );
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(`[dev-server] Failed to inspect process on port ${port}`);
    }
  }
}

function ensureCleanPort(port) {
  if (process.platform === 'win32') {
    killWindowsDesktopDebugProcesses();
    killWindowsViteOnPort(port);
    return;
  }
  killUnixViteOnPort(port);
}

function startVite(port) {
  const vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      stdio: 'inherit',
      cwd: process.cwd(),
    }
  );

  const shutdown = (signal) => {
    if (!vite.killed) {
      vite.kill(signal);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  vite.on('exit', (code, signal) => {
    if (signal) {
      process.exit(0);
      return;
    }
    process.exit(code ?? 0);
  });
}

try {
  ensureCleanPort(DEV_PORT);
  startVite(DEV_PORT);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
