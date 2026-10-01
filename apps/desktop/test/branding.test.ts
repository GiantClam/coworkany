import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";


const desktopRoot = process.cwd();

function pngDimensions(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function icoSizes(path: string): number[] {
  const bytes = readFileSync(path);
  assert.equal(bytes.readUInt16LE(0), 0);
  assert.equal(bytes.readUInt16LE(2), 1);
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const width = bytes[6 + index * 16];
    return width === 0 ? 256 : width;
  }).sort((left, right) => left - right);
}

test("desktop brand assets are wired into the window, bundle, and responsive sidebar", () => {
  const app = readFileSync(resolve(desktopRoot, "src/App.tsx"), "utf8");
  const index = readFileSync(resolve(desktopRoot, "index.html"), "utf8");
  const styles = readFileSync(resolve(desktopRoot, "src/styles.css"), "utf8");
  const tauriConfig = JSON.parse(readFileSync(resolve(desktopRoot, "src-tauri/tauri.conf.json"), "utf8")) as {
    productName: string;
    identifier: string;
    bundle: { icon: string[] };
    app: { windows: Array<{ title: string }> };
  };

  assert.equal(tauriConfig.productName, "CoworkAny");
  assert.equal(tauriConfig.identifier, "com.coworkany.desktop");
  assert.equal(tauriConfig.app.windows[0]?.title, "CoworkAny");
  assert.ok(existsSync(resolve(desktopRoot, "public/brand/coworkany-icon-64.png")));
  assert.ok(existsSync(resolve(desktopRoot, "public/brand/coworkany-logo.png")));
  assert.ok(existsSync(resolve(desktopRoot, "src-tauri/icons/coworkany-icon.ico")));
  assert.deepEqual(pngDimensions(resolve(desktopRoot, "public/brand/coworkany-icon-64.png")), { width: 64, height: 64 });
  assert.deepEqual(icoSizes(resolve(desktopRoot, "src-tauri/icons/coworkany-icon.ico")), [16, 24, 32, 48, 64, 128, 256]);
  assert.deepEqual(pngDimensions(resolve(desktopRoot, "public/brand/coworkany-logo.png")), { width: 1120, height: 228 });
  assert.deepEqual(readFileSync(resolve(desktopRoot, "public/brand/coworkany-logo.png")), readFileSync(resolve(desktopRoot, "../../public/brand/coworkany-logo.png")));
  assert.deepEqual(readFileSync(resolve(desktopRoot, "public/brand/coworkany-icon-64.png")), readFileSync(resolve(desktopRoot, "../../app/icon.png")));
  const icns = readFileSync(resolve(desktopRoot, "src-tauri/icons/coworkany-icon.icns"));
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.deepEqual(icns.subarray(16), readFileSync(resolve(desktopRoot, "src-tauri/icons/coworkany-icon.png")));
  assert.deepEqual(pngDimensions(resolve(desktopRoot, "src-tauri/icons/coworkany-icon.png")), { width: 1024, height: 1024 });
  assert.match(app, /className="bootstrap-logo" src="\/brand\/coworkany-logo\.png" alt="Coworkany"/u);
  assert.match(index, /href="\/brand\/coworkany-icon-64\.png"/u);
  assert.deepEqual(tauriConfig.bundle.icon, ["icons/coworkany-icon.ico"]);
  const csp = (tauriConfig as unknown as { app: { security: { csp: string } } }).app.security.csp;
  assert.match(csp, /connect-src[^;]*ipc:\s*http:\/\/ipc\.localhost/u);
  const capability = JSON.parse(readFileSync(resolve(desktopRoot, "src-tauri/capabilities/default.json"), "utf8")) as { permissions: string[] };
  assert.ok(capability.permissions.includes("core:event:default"));
  assert.match(styles, /\.wb-brand-mark[^}]+coworkany-icon-64\.png/u);
  assert.match(styles, /\.wb-brand-title[^}]+coworkany-logo\.png/u);
  assert.match(styles, /\.wb-brand-title[^}]+display:\s*none/u);
  assert.doesNotMatch(styles, /\.wb-shell:not\(\.wb-shell-collapsed\)[^}]+\.wb-brand-mark[^}]+display:\s*none/u);
  assert.match(styles, /\.bootstrap-mark[^}]+coworkany-icon-64\.png/u);
  assert.match(app, /"--primary":\s*WORKBENCH_THEME\.light\.primary/u);
  assert.match(app, /"--sidebar-primary":\s*WORKBENCH_THEME\.light\.sidebarPrimary/u);
  assert.match(app, /"--wb-sidebar-highlight":\s*WORKBENCH_THEME\.light\.sidebarPrimary/u);
  assert.match(app, /className="bootstrap-screen" style=\{(?:style|workbenchThemeStyle)\}/u);
  assert.doesNotMatch(app, /className="wb-runtime-status"/u);
  assert.doesNotMatch(styles, /#f5f84a/u);
});
