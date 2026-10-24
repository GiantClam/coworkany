/** Export the approved artwork without redrawing or substituting the wordmark. */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const master = resolve(root, "public/brand/coworkany-v2");
const desktop = "apps/desktop";
const icon = await sharp(resolve(master, "icon.png")).trim().png().toBuffer();
const logo = await sharp(resolve(master, "logo.png")).trim().png().toBuffer();
async function save(path, data) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
}
const iconPng = (size) => sharp(icon).resize(size, size, { fit: "contain", background: "#00000000" }).png().toBuffer();
const logoPng = await sharp(logo).resize({ width: 1120, withoutEnlargement: true }).png().toBuffer();
await save("public/brand/coworkany-logo.png", logoPng);
await save(`${desktop}/public/brand/coworkany-logo.png`, logoPng);
await save("public/brand/coworkany-icon.png", await iconPng(256));
await save("app/icon.png", await iconPng(64));
await save("app/apple-icon.png", await iconPng(180));
await save(`${desktop}/public/brand/coworkany-icon-64.png`, await iconPng(64));
const fullIcon = await iconPng(1024);
await save(`${desktop}/src-tauri/icons/coworkany-icon.png`, fullIcon);
await save(`${desktop}/src-tauri/icons/icon.png`, fullIcon);

// ICO directory with embedded PNGs, covering taskbar through installer sizes.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(iconPng));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
images.forEach((png, i) => {
  const entry = 6 + i * 16;
  directory[entry] = directory[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(png.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
const ico = Buffer.concat([directory, ...images]);
await save(`${desktop}/src-tauri/icons/coworkany-icon.ico`, ico);
await save(`${desktop}/src-tauri/icons/icon.ico`, ico);
await import("./generate-macos-icon.mjs");
console.log("Approved Coworkany artwork exported for web, Windows, and macOS.");
