import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import sharp from "sharp";
const website = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(website, "../..");
const output = resolve(website, "public");
await mkdir(resolve(output, "brand"), { recursive: true });
// Allowlist: never copy root public/, generated previews, documents, or app data.
for (const name of ["coworkany-logo.png", "coworkany-icon.png"]) {
  await copyFile(resolve(root, "public/brand", name), resolve(output, "brand", name));
}
for (const name of ["icon.png", "apple-icon.png"]) {
  await copyFile(resolve(root, "app", name), resolve(output, name));
}
const logo = await sharp(resolve(root, "public/brand/coworkany-logo.png"))
  .resize({ width: 470, withoutEnlargement: true })
  .png()
  .toBuffer();
const icon = await sharp(resolve(root, "public/brand/coworkany-icon.png"))
  .resize(286, 286)
  .png()
  .toBuffer();
const socialCard = Buffer.from(`
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#fdfdfb"/>
    <rect width="18" height="630" fill="#ffd000"/>
    <rect x="790" width="410" height="630" fill="#ffd000"/>
    <path d="M790 0L720 630H790V0Z" fill="#111111" opacity="0.04"/>
    <text x="66" y="270" fill="#111111" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700" letter-spacing="-2">Your work.</text>
    <text x="66" y="354" fill="#111111" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700" letter-spacing="-2">Your agent.</text>
    <text x="70" y="436" fill="#5f5f5a" font-family="Arial, Helvetica, sans-serif" font-size="25">Research · write · design · deliver</text>
    <text x="70" y="546" fill="#111111" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" letter-spacing="3">WEB · MACOS · WINDOWS</text>
  </svg>
`);
await sharp(socialCard)
  .composite([
    { input: logo, left: 66, top: 58 },
    { input: icon, left: 852, top: 172 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(resolve(output, "og-image.png"));
const origin = new URL(process.env.WEBSITE_ORIGIN || "https://coworkany.com").origin;
await writeFile(resolve(output, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile(resolve(output, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["en", "zh"].map(locale => `<url><loc>${origin}/${locale}</loc></url>`).join("")}</urlset>\n`);
await writeFile(resolve(output, "_headers"), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n\n/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
