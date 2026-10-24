import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { COWORKANY_DESKTOP_PREVIEW_ORIGINS, patchDashiPreviewDesktopBridge } from "./dashi-preview-desktop-bridge.mjs";

test("Dashi server receives an allowlisted desktop-only export preflight bridge", async () => {
  const root = await mkdtemp(join(tmpdir(), "dashi-desktop-bridge-"));
  const serverPath = join(root, "project/scripts/serve-preview-https.mjs");
  const routesPath = join(root, "project/scripts/preview/export-routes.mjs");
  const launcherPath = join(root, "project/scripts/start-preview-server.mjs");
  await mkdir(join(root, "project/scripts/preview"), { recursive: true });
  await writeFile(serverPath, "const serveRequest = async (req, res) => {\n  const requestUrl = new URL(req.url || '/', 'https://local.invalid');\n};\n");
  await writeFile(routesPath, "  const allowed = new Set(allowedHosts.flatMap(host => [\n    `http://${host}:${PORT}`,\n    `https://${host}:${PORT}`,\n  ]));\n");
  await writeFile(launcherPath, "import https from 'node:https';\n    const localUrl = `https://localhost:${port}/`;\n    const url = isLoopbackHost(host) ? localUrl : `https://${localName}.local:${port}/`;\n    const httpUrl = `http://127.0.0.1:${port}/`;\n    const localHttpUrl = `http://localhost:${port}/`;\n    const lanHttpUrl = isLoopbackHost(host) ? null : `http://${localName}.local:${port}/`;\n    console.log(`HTTPS preview URL: ${url}`);\n    console.log(`Local HTTPS URL: ${localUrl}`);\nasync function waitForPreview(port, bindHost) {\n  const urlHost = hostForUrl(readyCheckHost(bindHost));\n  let lastError = null;\n  for (let attempt = 0; attempt < 40; attempt += 1) {\n    try {\n      await Promise.all([\n        fetchHttp(`http://${urlHost}:${port}/`),\n        fetchHttps(`https://${urlHost}:${port}/`),\n      ]);\n      return;\n    } catch (error) { lastError = error; }\n  }\n  throw new Error(`HTTPS preview did not become ready: ${lastError?.message || 'unknown error'}`);\n}\n\nfunction fetchHttps(url) {\n  return new Promise((resolve, reject) => {\n    https.get(url, { rejectUnauthorized: false }, response => {\n      response.resume();\n      response.on('end', () => {\n        if (response.statusCode === 200) resolve();\n        else reject(new Error(`status=${response.statusCode}`));\n      });\n    }).on('error', reject);\n  });\n}\n\n");
  try {
    await patchDashiPreviewDesktopBridge(root);
    const server = await readFile(serverPath, "utf8");
    const routes = await readFile(routesPath, "utf8");
    const launcher = await readFile(launcherPath, "utf8");
    assert.match(server, /COWORKANY_DESKTOP_ORIGINS/);
    assert.match(server, /access-control-allow-methods': 'POST'/);
    assert.match(server, /pathname !== '\/api\/export-editable-pptx'/);
    assert.match(routes, /\.\.\.desktopOrigins/);
    assert.match(launcher, /COWORKANY_HTTP_LOOPBACK_ONLY/u);
    assert.match(launcher, /const url = httpUrl/u);
    assert.match(launcher, /CoworkAny preview URL/u);
    assert.match(launcher, /CoworkAny HTTP loopback URL/u);
    assert.match(launcher, /Local HTTP preview did not become ready/u);
    assert.doesNotMatch(launcher, /HTTPS preview URL/u);
    assert.doesNotMatch(launcher, /Local HTTPS URL/u);
    assert.doesNotMatch(launcher, /fetchHttps\(/u);
    for (const origin of COWORKANY_DESKTOP_PREVIEW_ORIGINS) {
      assert.ok(server.includes(origin));
      assert.ok(routes.includes(origin));
    }
    const firstServer = server;
    const firstRoutes = routes;
    const firstLauncher = launcher;
    await patchDashiPreviewDesktopBridge(root);
    assert.equal(await readFile(serverPath, "utf8"), firstServer, "server patch is idempotent");
    assert.equal(await readFile(routesPath, "utf8"), firstRoutes, "origin patch is idempotent");
    assert.equal(await readFile(launcherPath, "utf8"), firstLauncher, "launcher patch is idempotent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
