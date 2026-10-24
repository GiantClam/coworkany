import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../out/", import.meta.url));
const files = await readdir(root, { recursive: true, withFileTypes: true });
const allowed = /^(?:_next\/static\/|(?:en|zh)\.(?:html|txt)$|404(?:\/index)?\.html$|brand\/coworkany-(?:logo|icon)\.png$|(?:apple-)?icon\.png$|og-image\.png$|robots\.txt$|sitemap\.xml$|_headers$)/;
for (const file of files.filter(item => item.isFile())) {
  const path = resolve(file.parentPath, file.name).slice(root.length).replaceAll("\\", "/");
  assert.match(path, allowed, `Unexpected deployable file: ${path}`);
}
const origin = new URL(process.env.WEBSITE_ORIGIN || "https://coworkany.com").origin;
const start = process.env.WEBSITE_START_URL || "https://www.aimarketingsite.com/register";
for (const locale of ["en", "zh"]) {
  const html = await readFile(resolve(root, `${locale}.html`), "utf8");
  assert.match(html, new RegExp(`<html lang="${locale === "zh" ? "zh-CN" : "en"}"`));
  assert.ok(html.includes(`href="${origin}/${locale}"`), "canonical must use the public website origin");
  assert.ok(html.includes('hrefLang="x-default" href="' + origin + '/en"'));
  assert.ok(html.includes(`href="${start}"`), "CTA must point at the separate application");
  assert.doesNotMatch(html, /href="\/(?:register|login|dashboard)(?:["/?])/);
  assert.match(html, /\/brand\/coworkany-logo\.png/);
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(html.includes(`property="og:image" content="${origin}/og-image.png"`));
  assert.ok(html.includes(`name="twitter:image" content="${origin}/og-image.png"`));
  assert.ok(html.includes('property="og:image:width" content="1200"'));
  assert.ok(html.includes('property="og:image:height" content="630"'));
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
}
const socialImage = await readFile(resolve(root, "og-image.png"));
assert.deepEqual([...socialImage.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(socialImage.readUInt32BE(16), 1200);
assert.equal(socialImage.readUInt32BE(20), 630);
console.log("Static export verified: localized public pages and allowlisted website assets only.");
