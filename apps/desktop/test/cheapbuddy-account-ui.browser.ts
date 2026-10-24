import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

// pnpm exec tsx --test test/cheapbuddy-account-ui.browser.ts
// All callbacks are local fixtures; this check never calls account or billing APIs.
test("CheapBuddy panel signs in, verifies, clears secrets and separates product catalogs", async (t) => {
  const bundle = await build({
    stdin: {
      contents: `
        import React, { useState, StrictMode } from 'react';
        import { createRoot } from 'react-dom/client';
        import { CheapBuddyAccountPanel } from './cheapbuddy-account';
        import { SIGNED_OUT_CHEAPBUDDY_STATE } from './cheapbuddy-contract';
        const events = [];
        let update;
        let reject = false;
        let release;
        let defer = false;
        function Fixture() {
          const [props, setProps] = useState({locale:'zh',state:SIGNED_OUT_CHEAPBUDDY_STATE,busy:false});
          update = patch => setProps(previous => ({...previous,...patch}));
          return <CheapBuddyAccountPanel {...props} onAction={async (action,payload) => {
            events.push({action,payload});
            if (defer) await new Promise(resolve => {release = resolve;});
            if (reject) {reject=false;throw new Error('DO_NOT_RENDER_RAW_SECRET');}
          }} onPurchase={async () => {events.push({action:'purchase'});}} />;
        }
        window.fixture = {events,set:patch=>update(patch),fail:()=>{reject=true;},hold:()=>{defer=true;},release:()=>{defer=false;release();}};
        createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
      `,
      loader: "tsx",
      resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const css = await readFile(new URL("../src/cheapbuddy-account.css", import.meta.url), "utf8");
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
    response.end(request.url === "/fixture.js" ? bundle.outputFiles[0]!.text : `<!doctype html><html lang="zh"><meta charset="utf-8"><style>body{font-family:system-ui;margin:16px;background:#fdfdfb}button{border:1px solid #ddd;border-radius:5px;background:#fff}.primary{background:#111;color:#ffd000}${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1120, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole("heading", { name: "CheapBuddy 账号", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "登录并配置", exact: true }).isDisabled(), true);
  assert.equal(await page.getByText("充值目录尚未同步，前往官网购买", { exact: true }).count(), 1);
  assert.equal(await page.getByText("登录仅在当前桌面会话中有效，关闭应用后需要重新登录。", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "前往官网购买", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => (window as unknown as { fixture: { events: unknown[] } }).fixture.events), [{ action: "purchase" }]);

  await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("fixture@example.com");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password");
  await page.evaluate(() => (window as unknown as { fixture: { hold(): void } }).fixture.hold());
  await page.getByRole("button", { name: "登录并配置", exact: true }).click();
  assert.equal(await page.getByLabel("密码", { exact: true }).inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "正在登录…", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "前往官网购买", exact: true }).isDisabled(), true);
  assert.equal(await page.locator(".cheapbuddy-account").getAttribute("aria-busy"), "true");
  await page.evaluate(() => (window as unknown as { fixture: { release(): void } }).fixture.release());
  await page.getByRole("button", { name: "登录并配置", exact: true }).waitFor();
  const signIn = await page.evaluate(() => (window as unknown as { fixture: { events: Array<{action: string; payload?: unknown}> } }).fixture.events.find((event) => event.action === "login"));
  assert.deepEqual(signIn, { action: "login", payload: { email: "fixture@example.com", password: "fixture-password" } });

  await page.evaluate(() => (window as unknown as { fixture: { set(patch: unknown): void } }).fixture.set({ state: { status: "verification_required", persistent: false, products: [], memberships: [], rechargeCatalogAvailable: false } }));
  await page.getByRole("textbox", { name: "验证码", exact: true }).waitFor();
  assert.equal(await page.getByLabel("密码", { exact: true }).count(), 0);
  await page.getByRole("textbox", { name: "验证码", exact: true }).fill("123");
  assert.equal(await page.getByRole("button", { name: "验证并登录", exact: true }).isDisabled(), true);
  await page.getByRole("textbox", { name: "验证码", exact: true }).fill("246810");
  await page.getByRole("button", { name: "验证并登录", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "验证码", exact: true }).inputValue(), "");
  const verification = await page.evaluate(() => (window as unknown as { fixture: { events: Array<{action: string; payload?: unknown}> } }).fixture.events.find((event) => event.action === "verify"));
  assert.deepEqual(verification, { action: "verify", payload: { code: "246810" } });

  await page.evaluate(() => (window as unknown as { fixture: { set(patch: unknown): void } }).fixture.set({ state: {
    status: "connected", persistent: false, account: { id: 1, email: "fixture@example.com", balance: 12.5 },
    memberships: [{ id: "current", name: "Existing membership", expiresAt: "2026-11-13" }], rechargeCatalogAvailable: true,
    products: [{ id: "r1", kind: "recharge", name: "Recharge fixture", amount: 20, currency: "USD" },
      { id: "p1", kind: "membership", name: "Monthly fixture", amount: 9.99, currency: "CNY", period: "30 days" },
      { id: "p2", kind: "membership", name: "Unpriced fixture" }],
    provider: { id: "cheapbuddy", source: "openai-compatible", model: "fixture", apiKey: "NEVER_RENDER_KEY", credentialRef: "NEVER_RENDER_REF" },
  } }));
  await page.getByText("已连接", { exact: true }).waitFor();
  assert.equal(await page.getByText("登录仅在当前桌面会话中有效，关闭应用后需要重新登录。", { exact: true }).count(), 1);
  assert.equal(await page.getByText("fixture@example.com", { exact: true }).count(), 1);
  assert.equal(await page.getByText("12.5", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Existing membership", { exact: true }).count(), 1);
  assert.equal(await page.getByText("到期: 2026-11-13", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("region", { name: "余额充值", exact: true }).getByText("20 USD", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("region", { name: "会员套餐", exact: true }).getByText("9.99 CNY", { exact: true }).count(), 1);
  assert.equal(await page.getByText("价格尚未同步，请在官网查看", { exact: true }).count(), 1);
  assert.equal((await page.locator(".cheapbuddy-account").innerHTML()).includes("NEVER_RENDER"), false);
  assert.equal(await page.getByLabel("密码", { exact: true }).count(), 0);
  await page.getByRole("region", { name: "会员套餐", exact: true }).getByRole("button", { name: "前往官网购买", exact: true }).first().click();
  await page.getByRole("button", { name: "刷新账号", exact: true }).click();
  await page.evaluate(() => (window as unknown as { fixture: { fail(): void } }).fixture.fail());
  await page.getByRole("button", { name: "刷新账号", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText("操作失败，请重试。", { exact: true }).count(), 1);
  assert.equal((await page.locator(".cheapbuddy-account").innerText()).includes("DO_NOT_RENDER_RAW_SECRET"), false);
  await page.evaluate(() => (window as unknown as { fixture: { set(patch: unknown): void } }).fixture.set({error: "账号同步失败"}));
  await page.getByText("账号同步失败", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭错误提示", exact: true }).click();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();

  await page.evaluate(() => (window as unknown as { fixture: { set(patch: unknown): void } }).fixture.set({ locale: "en", error: undefined, busy: true, state: {
    status: "no_models", persistent: true, account: { id: 1, email: "fixture@example.com" }, products: [], memberships: [], rechargeCatalogAvailable: false,
  } }));
  await page.getByRole("heading", { name: "CheapBuddy account", exact: true }).waitFor();
  assert.equal(await page.getByText("Signed in, no available models", { exact: true }).count(), 1);
  assert.equal(await page.getByText("No active membership", { exact: true }).count(), 1);
  assert.equal(await page.getByText("This sign-in lasts for the current desktop session. You will need to sign in again after closing the app.", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Refresh account", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Buy on website", exact: true }).isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 700 });
  const box = await page.locator(".cheapbuddy-account").boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);

  await page.evaluate(() => (window as unknown as { fixture: { set(patch: unknown): void } }).fixture.set({state:{status:"no_models",persistent:true,products:[],memberships:[],rechargeCatalogAvailable:false,warning:"cheapbuddy_catalog_refresh_failed"}}));
  await page.getByText("Could not refresh plan information. Showing the last synced information. Please try again later.", {exact:true}).waitFor();
  assert.equal((await page.locator(".cheapbuddy-account").innerText()).includes("cheapbuddy_catalog_refresh_failed"), false);
  await page.evaluate(() => (window as unknown as { fixture: { set(patch: unknown): void } }).fixture.set({state:{status:"no_models",persistent:true,products:[],memberships:[],rechargeCatalogAvailable:false,warning:"NEVER_RENDER_WARNING_SECRET"}}));
  await page.getByText("Some account information has not synced. Please refresh to retry.", {exact:true}).waitFor();
  assert.equal((await page.locator(".cheapbuddy-account").innerText()).includes("NEVER_RENDER_WARNING_SECRET"), false);

  await page.evaluate(() => (window as unknown as { fixture: { set(patch: unknown): void } }).fixture.set({busy:false,state:{status:"session_expired",persistent:false,products:[],memberships:[],rechargeCatalogAvailable:false}}));
  await page.getByText("Your session has expired. Please sign in again.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "");
  const actions = await page.evaluate(() => (window as unknown as { fixture: { events: Array<{action: string}> } }).fixture.events.map((event) => event.action));
  assert.deepEqual(actions, ["purchase", "login", "verify", "purchase", "refresh", "refresh", "logout"]);
  assert.deepEqual(errors, []);
});
