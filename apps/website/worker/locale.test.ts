import assert from "node:assert/strict";
import test from "node:test";
import worker from "./index";
import { DEFAULT_LOCALE, localeFromAcceptLanguage, localeFromCookie, localeFromRequest } from "./locale";

test("Accept-Language selects supported variants by quality and browser order", () => {
  assert.equal(localeFromAcceptLanguage("fr;q=0.9, zh-CN;q=0.8, en-US;q=0.7"), "zh");
  assert.equal(localeFromAcceptLanguage("en-GB;q=0.8, zh;q=0.8"), "en");
  assert.equal(localeFromAcceptLanguage("zh-Hant;q=0, en;q=0.4"), "en");
});

test("malformed or unsupported language preferences fall back to English", () => {
  assert.equal(localeFromAcceptLanguage("zh;q=1.2, en;q=wat"), DEFAULT_LOCALE);
  assert.equal(localeFromAcceptLanguage("de, *;q=0.5"), DEFAULT_LOCALE);
  assert.equal(localeFromAcceptLanguage(null), DEFAULT_LOCALE);
});

test("the exact locale cookie wins over browser preference", () => {
  assert.equal(localeFromCookie("theme=dark; coworkany_site_locale=zh"), "zh");
  assert.equal(localeFromRequest(new Request("https://coworkany.com/", {
    headers: { Cookie: "coworkany_site_locale=en", "Accept-Language": "zh-CN" },
  })), "en");
  assert.equal(localeFromRequest(new Request("https://coworkany.com/", {
    headers: { Cookie: "coworkany_site_locale=fr", "Accept-Language": "zh-CN" },
  })), "zh");
});

test("root redirects to the selected locale while preserving the query", async () => {
  const response = await worker.fetch(new Request("https://coworkany.com/?utm_source=launch"), {
    ASSETS: { fetch: async () => new Response("asset") },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://coworkany.com/en?utm_source=launch");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Vary"), "Accept-Language, Cookie");
});

test("explicit locale paths never redirect and unknown paths delegate to ASSETS", async () => {
  const requests: Request[] = [];
  const env = { ASSETS: { fetch: async (request: Request) => { requests.push(request); return new Response("asset"); } } };

  const english = await worker.fetch(new Request("https://coworkany.com/en", { headers: { "Accept-Language": "zh" } }), env);
  const notFound = await worker.fetch(new Request("https://coworkany.com/missing", { headers: { "Accept-Language": "zh" } }), env);
  assert.equal(english.status, 200);
  assert.equal(notFound.status, 200);
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), ["/en", "/missing"]);
});
