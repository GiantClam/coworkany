import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import { createRpcReader, encodeRpcMessage } from "../runtime/rpc";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
type CapturedEnvironment = { config: string; home: string; data: string; revision: string; path: string; pythonHome?: string; pythonNoUserSite?: string; pid: number };

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "coworkany-host-stage-"));
  const stops: Array<() => Promise<void>> = [];
  await mkdir(join(root, "python", "lib"), { recursive: true });
  t.after(async () => {
    for (const stop of stops) await stop();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const source = join(root, "bundle", "skills");
  const agents = join(root, "bundle", "agents");
  const put = async (path: string, text: string) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
  };
  await put(join(source, "native", "SKILL.md"), "---\nname: native\ndescription: Native fixture\n---\nUse upstream scripts.\n");
  await put(join(source, "native", "scripts", "run.js"), "version one");
  await put(join(source, "native", "assets", "template.txt"), "old template");
  await put(join(agents, "agency-native.md"), "---\nname: native\ncolor: blue\n---\nNative agent\n");
  const capture = join(root, "environment.json");
  const executable = join(root, "capture-serve.mjs");
  await put(executable, `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.HOST_STAGE_CAPTURE, JSON.stringify({
  config: process.env.OPENCODE_CONFIG_DIR, home: process.env.HOME,
  data: process.env.XDG_DATA_HOME, revision: process.env.COWORKANY_SKILL_CATALOG_REVISION,
  path: process.env.PATH, pythonHome: process.env.PYTHONHOME,
  pythonNoUserSite: process.env.PYTHONNOUSERSITE, pid: process.pid
}), 'utf8');
await import(${JSON.stringify(pathToFileURL(join(desktopRoot, "test", "fixtures", "fake-opencode-serve.mjs")).href)});
`);
  const start = () => {
    const child = spawn(process.execPath, ["--import", "tsx", join(desktopRoot, "runtime", "host.ts")], {
      cwd: desktopRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, COWORKANY_SKILLS_DIR: source, COWORKANY_AGENTS_DIR: agents,
        COWORKANY_OPENCODE_CONFIG_DIR: join(root, "config-root"), OPENCODE_RUNTIME_DIR: root,
        COWORKANY_OPENCODE_PATH: executable, HOST_STAGE_CAPTURE: capture,
        COWORKANY_PYTHON_PATH: join(root, "python", "python.exe") },
    });
    let errors = "";
    child.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString("utf8")).slice(-4000); });
    const pending = new Map<string, (frame: Record<string, unknown>) => void>();
    const servePids = new Set<number>();
    createRpcReader(child.stdout, frame => pending.get(String(frame.requestId))?.({ ...frame }), error => { errors = error.message; });
    const session = async () => {
      const requestId = `session-${Date.now()}-${Math.random()}`;
      const frame = await new Promise<Record<string, unknown>>((resolveFrame, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Host stage timeout: ${errors}`)); }, 20_000);
        pending.set(requestId, result => { clearTimeout(timer); pending.delete(requestId); resolveFrame(result); });
        child.stdin.write(encodeRpcMessage({ version: 1, requestId, type: "session.create", payload: {
          conversationId: requestId, workspacePath: join(root, "workspace"), provider: { id: "local", model: "local/model" },
        } }));
      });
      assert.equal(frame.ok, true, JSON.stringify(frame));
      const environment = JSON.parse(await readFile(capture, "utf8")) as CapturedEnvironment;
      servePids.add(environment.pid);
      return environment;
    };
    const stop = async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, "exit");
        child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
        if (process.platform === "win32") {
          await once(spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }), "close");
        } else child.kill();
        await closed;
      }
      for (const pid of servePids) {
        try { process.kill(pid); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      }
      servePids.clear();
    };
    stops.push(stop);
    return { session, stop };
  };
  return { root, source, agents, put, start };
}

test("host restart with the same bundle preserves installed dependencies and runtime assets", async t => {
  const f = await fixture(t);
  const firstHost = f.start();
  const first = await firstHost.session();
  const dependency = join(first.config, "skills", "native", "node_modules", "native-dependency", "index.js");
  const asset = join(first.config, "skills", "native", "runtime-assets", "download.bin");
  await f.put(dependency, "installed dependency");
  await f.put(asset, "downloaded asset");
  await firstHost.stop();
  const restarted = await f.start().session();
  assert.equal(restarted.config, first.config);
  assert.equal(await readFile(dependency, "utf8"), "installed dependency");
  assert.equal(await readFile(asset, "utf8"), "downloaded asset");
});

test("catalog changes are applied after host restart, without replacing a live session catalog", async t => {
  const f = await fixture(t);
  const host = f.start();
  const first = await host.session();
  const script = join(first.config, "skills", "native", "scripts", "run.js");
  const oldAsset = join(first.config, "skills", "native", "assets", "template.txt");
  await f.put(join(f.source, "native", "scripts", "run.js"), "version two");
  await rm(join(f.source, "native", "assets", "template.txt"));
  const stillRunning = await host.session();
  assert.equal(stillRunning.pid, first.pid, "catalog update must not restart an active OpenCode instance");
  assert.equal(await readFile(script, "utf8"), "version one");
  await host.stop();
  const updated = await f.start().session();
  assert.equal(updated.home, first.home);
  assert.equal(updated.data, first.data, "upgrades must not hide native conversation history");
  assert.notEqual(updated.revision, first.revision, "support-file-only changes invalidate the catalog");
  assert.equal(await readFile(script, "utf8"), "version two");
  await assert.rejects(readFile(oldAsset), /ENOENT/);
  assert.ok(updated.path.startsWith(`${join(f.root, "python")}${process.platform === "win32" ? ";" : ":"}${join(f.root, "python", "Scripts")}`));
  if (process.platform === "darwin") {
    assert.equal(updated.pythonHome, join(f.root, "python"));
    assert.equal(updated.pythonNoUserSite, "1");
  }
});
