import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const desktopOrigins = ["tauri://localhost", "http://tauri.localhost", "http://127.0.0.1:1420"];
const serverMarker = "// COWORKANY_DESKTOP_PREVIEW_CORS";
const launcherMarker = "// COWORKANY_HTTP_LOOPBACK_ONLY_V2";

/** Add a narrowly scoped CORS bridge for CoworkAny's card-level PPTX export. */
export async function patchDashiPreviewDesktopBridge(skillRoot) {
  const serverPath = join(skillRoot, "project", "scripts", "serve-preview-https.mjs");
  const routesPath = join(skillRoot, "project", "scripts", "preview", "export-routes.mjs");
  const launcherPath = join(skillRoot, "project", "scripts", "start-preview-server.mjs");
  let server = await readFile(serverPath, "utf8");
  let routes = await readFile(routesPath, "utf8");
  let launcher = await readFile(launcherPath, "utf8");

  if (!launcher.includes(launcherMarker)) {
    const urlAnchor = "    const localUrl = `https://localhost:${port}/`;\n    const url = isLoopbackHost(host) ? localUrl : `https://${localName}.local:${port}/`;\n    const httpUrl = `http://127.0.0.1:${port}/`;\n    const localHttpUrl = `http://localhost:${port}/`;\n    const lanHttpUrl = isLoopbackHost(host) ? null : `http://${localName}.local:${port}/`;";
    if (launcher.includes(urlAnchor)) {
      launcher = launcher.replace(urlAnchor, `${launcherMarker}\n    const httpUrl = \`http://127.0.0.1:\u0024{port}/\`;\n    const url = httpUrl;\n    const localHttpUrl = \`http://localhost:\u0024{port}/\`;\n    const localUrl = httpUrl;\n    const lanHttpUrl = null;`);
    } else if (!launcher.includes("const url = httpUrl;")) {
      throw new Error("dashi_preview_launcher_url_patch_anchor_missing");
    } else {
      launcher = launcher.replace("// COWORKANY_HTTP_LOOPBACK_ONLY\n", `${launcherMarker}\n`);
      if (!launcher.includes(launcherMarker)) launcher = launcher.replace("    const httpUrl =", `${launcherMarker}\n    const httpUrl =`);
    }
    const healthAnchor = "      await Promise.all([\n        fetchHttp(`http://${urlHost}:${port}/`),\n        fetchHttps(`https://${urlHost}:${port}/`),\n      ]);";
    if (!launcher.includes(healthAnchor)) throw new Error("dashi_preview_launcher_health_patch_anchor_missing");
    launcher = launcher.replace(healthAnchor, "      await fetchHttp(`http://${urlHost}:${port}/`);");
    launcher = launcher.replace("import https from 'node:https';\n", "");
    launcher = launcher.replace("console.log(`HTTPS preview URL: ${url}`);", "console.log(`CoworkAny preview URL: ${url}`);");
    launcher = launcher.replace("console.log(`Local HTTPS URL: ${localUrl}`);", "console.log(`CoworkAny HTTP loopback URL: ${localUrl}`);");
    launcher = launcher.replace("throw new Error(`HTTPS preview did not become ready: ${lastError?.message || 'unknown error'}`);", "throw new Error(`Local HTTP preview did not become ready: ${lastError?.message || 'unknown error'}`);");
    const httpsHelper = "function fetchHttps(url) {\n  return new Promise((resolve, reject) => {\n    https.get(url, { rejectUnauthorized: false }, response => {\n      response.resume();\n      response.on('end', () => {\n        if (response.statusCode === 200) resolve();\n        else reject(new Error(`status=${response.statusCode}`));\n      });\n    }).on('error', reject);\n  });\n}\n\n";
    if (!launcher.includes(httpsHelper)) throw new Error("dashi_preview_launcher_https_helper_patch_anchor_missing");
    launcher = launcher.replace(httpsHelper, "");
    if (launcher.includes("HTTPS preview URL:") || launcher.includes("Local HTTPS URL:") || launcher.includes("fetchHttps(")) {
      throw new Error("dashi_preview_launcher_https_reference_remaining");
    }
  }

  if (!server.includes(serverMarker)) {
    const serverAnchor = "const serveRequest = async (req, res) => {\n  const requestUrl = new URL(req.url || '/', 'https://local.invalid');";
    if (!server.includes(serverAnchor)) throw new Error("dashi_preview_server_patch_anchor_missing");
    const cors = `${serverMarker}\nconst COWORKANY_DESKTOP_ORIGINS = new Set(${JSON.stringify(desktopOrigins)});\nfunction handleCoworkAnyDesktopExportCors(req, res, pathname) {\n  const origin = req.headers.origin;\n  if (pathname !== '/api/export-editable-pptx' || !COWORKANY_DESKTOP_ORIGINS.has(origin)) return false;\n  if (req.method === 'OPTIONS') {\n    const requestedHeaders = String(req.headers['access-control-request-headers'] || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);\n    if (req.headers['access-control-request-method'] !== 'POST' || requestedHeaders.some(value => value !== 'content-type')) {\n      res.writeHead(403, { 'cache-control': 'no-store' });\n      res.end();\n      return true;\n    }\n    res.writeHead(204, {\n      'access-control-allow-origin': origin,\n      'access-control-allow-methods': 'POST',\n      'access-control-allow-headers': 'content-type',\n      'access-control-max-age': '600',\n      'cache-control': 'no-store',\n      vary: 'Origin',\n    });\n    res.end();\n    return true;\n  }\n  if (req.method === 'POST') {\n    res.setHeader('access-control-allow-origin', origin);\n    res.setHeader('vary', 'Origin');\n  }\n  return false;\n}\n\nconst serveRequest = async (req, res) => {\n  const requestUrl = new URL(req.url || '/', 'https://local.invalid');\n  if (handleCoworkAnyDesktopExportCors(req, res, requestUrl.pathname)) return;`;
    server = server.replace(serverAnchor, cors);
  }

  const routeMarker = "// COWORKANY_DESKTOP_PREVIEW_ORIGINS";
  if (!routes.includes(routeMarker)) {
    const routeAnchor = "  const allowed = new Set(allowedHosts.flatMap(host => [\n    `http://${host}:${PORT}`,\n    `https://${host}:${PORT}`,\n  ]));";
    if (!routes.includes(routeAnchor)) throw new Error("dashi_preview_export_origin_patch_anchor_missing");
    const replacement = `${routeMarker}\n  const desktopOrigins = ${JSON.stringify(desktopOrigins)};\n  const allowed = new Set([\n    ...allowedHosts.flatMap(host => [\n      \`http://\u0024{host}:\u0024{PORT}\`,\n      \`https://\u0024{host}:\u0024{PORT}\`,\n    ]),\n    ...desktopOrigins,\n  ]);`;
    routes = routes.replace(routeAnchor, replacement);
  }

  await Promise.all([writeFile(serverPath, server, "utf8"), writeFile(routesPath, routes, "utf8"), writeFile(launcherPath, launcher, "utf8")]);
}

export const COWORKANY_DESKTOP_PREVIEW_ORIGINS = desktopOrigins;
