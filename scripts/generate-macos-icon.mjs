import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? `${root}/apps/desktop/src-tauri/icons/coworkany-icon.png`);
const destination = resolve(process.argv[3] ?? `${root}/apps/desktop/src-tauri/icons/coworkany-icon.icns`);
const png = await readFile(source);

if (png.length < 8 || png.subarray(1, 4).toString("ascii") !== "PNG") throw new Error(`macos_icon_source_invalid:${source}`);
const chunk = Buffer.alloc(8);
chunk.write("ic10", 0, "ascii");
chunk.writeUInt32BE(png.length + 8, 4);
const header = Buffer.alloc(8);
header.write("icns", 0, "ascii");
header.writeUInt32BE(png.length + 16, 4);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, Buffer.concat([header, chunk, png]));
console.log(JSON.stringify({ status: "generated", source, destination, bytes: png.length + 16 }));
