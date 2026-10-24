import assert from "node:assert/strict"
import { test } from "node:test"

// Run against a local Next.js server: node --test scripts/test-coworkany-website.mjs
const base = process.env.COWORKANY_SITE_TEST_URL || "http://127.0.0.1:3100"
const pages = new Map()

async function getPage(locale) {
  if (!pages.has(locale)) {
    const response = await fetch(`${base}/${locale}`)
    assert.equal(response.status, 200, `${locale} homepage should render`)
    pages.set(locale, await response.text())
  }
  return pages.get(locale)
}

for (const locale of ["zh", "en"]) {
  test(`${locale}: localized, indexable Coworkany homepage with working destinations`, async () => {
    const html = await getPage(locale)
    const title = html.match(/<title>(.*?)<\/title>/)?.[1]
    assert.ok(title?.includes("Coworkany"))
    assert.ok(!title.includes("AIMarketingSite"), "Legacy brand must not leak through the layout title template")
    assert.match(html, new RegExp(`<link rel="canonical" href="[^"]*/${locale}"`))
    assert.match(html, /property="og:site_name" content="Coworkany"/)
    assert.match(html, /coworkany-logo\.png/, "Homepage should use the approved Coworkany logo")
    assert.match(html, /coworkany-icon\.png/, "Homepage product previews should use the approved Coworkany icon")
    assert.match(html, /href="\/register"/)
    assert.match(html, /href="https:\/\/github.com\/GiantClam\/coworkany\/releases"/)
    assert.match(html, new RegExp(`href="/${locale === "zh" ? "en" : "zh"}"`))
    assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1)
    for (const anchor of ["main", "capabilities", "use-cases", "desktop", "faq"]) {
      assert.ok(html.includes(`id="${anchor}"`), `${anchor} navigation target exists`)
    }
  })

  test(`${locale}: accessible examples and truthful FAQ are present in server HTML`, async () => {
    const html = await getPage(locale)
    assert.equal((html.match(/role="tab"/g) || []).length, 4)
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 1)
    assert.match(html, /role="tabpanel" aria-labelledby="tab-writing"/)
    const faqJson = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1]
    assert.ok(faqJson, "FAQ should be crawlable without JavaScript")
    const faq = JSON.parse(faqJson)
    assert.equal(faq["@type"], "FAQPage")
    assert.equal(faq.mainEntity.length, 4)
    for (const item of faq.mainEntity) {
      assert.ok(html.includes(item.name), "Structured questions match visible FAQ")
      assert.ok(html.includes(item.acceptedAnswer.text), "Structured answers match visible FAQ")
    }
    const privacy = faq.mainEntity.at(-1).acceptedAnswer.text
    assert.match(privacy, locale === "zh" ? /可能发送给你配置的模型服务商/ : /may send.*configured provider/)
    assert.match(privacy, locale === "zh" ? /不等于完全离线/ : /does not mean fully offline/)
    assert.ok(!html.includes("/homepage-redesign/"), "The homepage renders native UI, not old screenshot mockups")
  })
}

test("root entry retains locale routing", async () => {
  const response = await fetch(base, { redirect: "manual", headers: { cookie: "aimarketing_locale=zh" } })
  assert.equal(response.status, 307)
  assert.equal(new URL(response.headers.get("location")).pathname, "/zh")
})
