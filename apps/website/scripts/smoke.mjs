import assert from "node:assert/strict";
const base = process.env.WEBSITE_TEST_URL || "http://127.0.0.1:8788";
async function request(path, headers = {}) {
  return fetch(new URL(path, base), { headers, redirect: "manual" });
}
for (const [headers, locale] of [
  [{}, "en"],
  [{ "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" }, "zh"],
  [{ "Accept-Language": "en-US,en;q=0.9,zh;q=0.7" }, "en"],
  [{ "Accept-Language": "fr-FR,de;q=0.9" }, "en"],
  [{ "Accept-Language": "zh;q=0.2,en;q=0.9" }, "en"],
  [{ "Accept-Language": "zh-CN", Cookie: "coworkany_site_locale=en" }, "en"],
  [{ "Accept-Language": "en-US", Cookie: "coworkany_site_locale=zh" }, "zh"],
]) {
  const response = await request("/?utm_source=verification", headers);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, `/${locale}`);
  assert.equal(location.search, "?utm_source=verification");
  assert.match(response.headers.get("cache-control"), /no-store/);
}
for (const locale of ["en", "zh"]) {
  const response = await request(`/${locale}`, { "Accept-Language": locale === "en" ? "zh" : "en", Cookie: `coworkany_site_locale=${locale === "en" ? "zh" : "en"}` });
  assert.equal(response.status, 200, `explicit /${locale} must be honored`);
  const html = await response.text();
  assert.match(html, new RegExp(`<html lang="${locale === "zh" ? "zh-CN" : "en"}"`));
  assert.match(html, /Coworkany/);
  assert.doesNotMatch(html, /href="\/register"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:image" content="https:\/\/coworkany\.com\/og-image\.png"/);
  assert.match(html, /name="twitter:image" content="https:\/\/coworkany\.com\/og-image\.png"/);
  assert.match(response.headers.get("x-content-type-options"), /nosniff/);
}
for (const path of ["/api/test", "/dashboard", "/register", "/unknown"]) {
  assert.equal((await request(path)).status, 404, `${path} must not expose the application`);
}
for (const path of ["/icon.png", "/apple-icon.png", "/og-image.png", "/brand/coworkany-logo.png", "/brand/coworkany-icon.png", "/robots.txt", "/sitemap.xml"]) {
  assert.equal((await request(path)).status, 200, `${path} must load`);
}
console.log(`Website smoke checks passed: locale negotiation, manual preference, direct links, assets, and isolated routes (${base}).`);
