import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { chromium, type Page } from "playwright";

// Explicit full-App browser acceptance; all native/API responses are fixtures.
// pnpm exec tsx --test test/cheapbuddy-desktop-acceptance.browser.ts
type Snapshot = {
  defaults: { text: string; image: string; video: string; audio: string };
  writeCount: number; failedWriteCount: number; refreshCount: number; passwordMatched: boolean; unsafeWrite: boolean; unsafeDiagnostic: boolean;
  accountActions: string[]; nativeCommands: Array<{command: string; argumentKeys: string[]}>;
  primary: {id?:string;model?:string;hasApiKey:boolean;credentialRef:boolean};
  cheapbuddy: {id?:string;model?:string;models?:string[];credentialRef?:string;apiKey?:string;capabilityModels?:Record<string,{model?:string;models:string[]}>};
  workText: {model:string}; localAudio: {model:string};
  nativePurchaseCount: number; purchaseArguments: string[][];
  discoveries: Array<{capability:string;credentialRef:boolean;apiKey:boolean}>;
};
const snapshot = (page: Page) => page.evaluate(() => (window as unknown as { cheapBuddyDesktopAcceptance: {snapshot(): Snapshot} }).cheapBuddyDesktopAcceptance.snapshot());
const privateRendered = (page: Page) => page.evaluate(() => {
  const values = [...document.querySelectorAll("input, textarea")].map((element) => (element as HTMLInputElement).value).join("\n");
  return `${document.body.innerText}\n${values}`.includes("fixture-model-key-never-render-or-log") || `${document.body.innerText}\n${values}`.includes("fixture-password-never-render-or-log");
});

test("full desktop settings recover failed CheapBuddy persistence and integrate login, managed models, purchase return and logout", async () => {
  const evidence = fileURLToPath(new URL("../../../.artifacts/cheapbuddy-implementation-20261013/", import.meta.url));
  await mkdir(evidence, { recursive: true });
  const vite = await createServer({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../", import.meta.url)), logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: { ignored: ["**/*"] } },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const blockedExternal: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.route("https://**", async (route) => { blockedExternal.push(new URL(route.request().url()).hostname); await route.abort(); });
  try {
    await page.goto(`http://127.0.0.1:${address.port}/test/cheapbuddy-desktop-acceptance.html`);
    const account = page.locator(".cheapbuddy-account");
    await account.getByRole("heading", { name: "CheapBuddy 账号", exact: true }).waitFor();
    await account.getByRole("button", { name: "登录并配置", exact: true }).waitFor();
    await page.waitForFunction(() => (window as unknown as {cheapBuddyDesktopAcceptance:{snapshot():Snapshot}}).cheapBuddyDesktopAcceptance.snapshot().accountActions.includes("status"));
    assert.equal(await account.getByText("未登录", { exact: true }).count(), 1);
    const initial = await snapshot(page);
    assert.deepEqual(initial.defaults, { text: "cheapbuddy", image: "cheapbuddy", video: "cheapbuddy", audio: "local-audio" });
    assert.equal(initial.primary.id, "cheapbuddy");
    assert.equal(initial.primary.credentialRef, false);
    assert.equal(initial.primary.hasApiKey, false);

    await account.getByRole("textbox", { name: "邮箱", exact: true }).fill("desktop-fixture@example.com");
    await account.getByLabel("密码", { exact: true }).fill("fixture-password-never-render-or-log");
    await page.evaluate(() => (window as unknown as {cheapBuddyDesktopAcceptance:{failNextConfigWrite():void}}).cheapBuddyDesktopAcceptance.failNextConfigWrite());
    await account.getByRole("button", { name: "登录并配置", exact: true }).click();
    await account.getByRole("alert").waitFor();
    await account.getByText("fixture_write_config_failed", { exact: true }).waitFor();
    assert.equal(await account.getByText("已连接", { exact: true }).count(), 0);
    assert.equal(await account.getByText("未登录", { exact: true }).count(), 1);
    assert.equal(await account.getByLabel("密码", { exact: true }).inputValue(), "");
    const failedLogin = await snapshot(page);
    assert.equal(failedLogin.failedWriteCount, 1);
    assert.equal(failedLogin.writeCount, initial.writeCount);
    assert.equal(failedLogin.passwordMatched, true);
    assert.equal(failedLogin.primary.credentialRef, false);
    assert.equal(failedLogin.unsafeWrite, false);
    assert.equal(failedLogin.unsafeDiagnostic, false);
    assert.equal(await privateRendered(page), false);
    await account.screenshot({ path: `${evidence}desktop-settings-persistence-error.png` });
    // A failed save does not retain the password. The user can enter it again
    // and retry the same account; only successful persistence reports connected.
    await account.getByLabel("密码", { exact: true }).fill("fixture-password-never-render-or-log");
    assert.equal(await account.getByRole("button", { name: "登录并配置", exact: true }).isDisabled(), false);
    await account.getByRole("button", { name: "登录并配置", exact: true }).click();
    await account.getByText("已连接", { exact: true }).waitFor();
    assert.equal(await account.getByLabel("密码", { exact: true }).count(), 0);
    assert.equal(await account.getByText("desktop-fixture@example.com", { exact: true }).count(), 1);
    assert.equal(await account.getByRole("region", { name: "余额充值", exact: true }).getByText("15 CNY", { exact: true }).count(), 1);
    assert.equal(await account.getByRole("region", { name: "会员套餐", exact: true }).getByText("9 USD", { exact: true }).count(), 1);
    const connected = await snapshot(page);
    assert.equal(connected.passwordMatched, true);
    assert.equal(connected.primary.credentialRef, true);
    assert.equal(connected.primary.hasApiKey, false);
    assert.equal(connected.failedWriteCount, 1);
    assert.ok(connected.writeCount > failedLogin.writeCount);
    assert.equal(await account.getByRole("alert").count(), 0);
    assert.equal(connected.unsafeWrite, false);
    assert.equal(connected.unsafeDiagnostic, false);
    assert.equal(await privateRendered(page), false);
    assert.deepEqual(connected.defaults, initial.defaults);
    assert.deepEqual(connected.cheapbuddy.capabilityModels?.image?.models, ["grok-imagine-image-2.0", "gpt-image-2.5"]);
    await account.screenshot({ path: `${evidence}desktop-settings-connected.png` });
    await page.locator(".settings-panel > .section-title").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}desktop-settings-shell.png` });

    await account.getByRole("button", { name: "前往官网购买", exact: true }).last().click();
    const purchased = await snapshot(page);
    assert.equal(purchased.nativePurchaseCount, 1);
    assert.deepEqual(purchased.purchaseArguments, [[]]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await account.getByText("43.5", { exact: true }).waitFor();
    assert.equal((await snapshot(page)).refreshCount, 1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    assert.equal((await snapshot(page)).refreshCount, 1);

    const imageSection = page.locator(".settings-provider-capability-section").filter({ has: page.getByText("图片模型", { exact: true }) });
    const cheapImageRow = imageSection.getByRole("listitem").filter({ has: page.getByText("cheapbuddy", { exact: true }) });
    await cheapImageRow.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑 Provider", exact: true });
    await editor.waitFor();
    assert.equal(await editor.getByRole("textbox", { name: "Provider 标识", exact: true }).isDisabled(), true);
    assert.equal(await editor.getByRole("combobox", { name: "接入平台", exact: true }).isDisabled(), true);
    assert.equal(await editor.getByRole("textbox", { name: "Base URL", exact: true }).isDisabled(), true);
    assert.equal(await editor.getByLabel("API Key", { exact: true }).count(), 0);
    await editor.locator(".settings-provider-model-dropdown > summary").click();
    const choices = await editor.getByRole("checkbox").evaluateAll((elements) => elements.map((element) => element.closest("label")?.textContent?.trim()));
    assert.deepEqual(choices, ["grok-imagine-image-2.0", "gpt-image-2.5"]);
    assert.equal(await editor.getByText("glm-5.3", { exact: true }).count(), 0);
    assert.equal(await editor.getByText("MiniMax-H3", { exact: true }).count(), 0);
    await editor.locator(".settings-provider-model-dropdown > summary").click();
    await editor.getByRole("button", { name: "从 Provider 获取模型", exact: true }).click();
    await editor.getByText("已获取 2 个账号模型，请选择后保存", { exact: true }).waitFor();
    const discovered = await snapshot(page);
    assert.ok(discovered.discoveries.length >= 1);
    assert.ok(discovered.discoveries.every((item) => item.capability === "image" && item.credentialRef && !item.apiKey));
    assert.equal(await privateRendered(page), false);
    await editor.locator(".settings-provider-model-dropdown > summary").click();
    await editor.screenshot({ path: `${evidence}desktop-image-provider-managed.png` });
    await editor.getByRole("button", { name: "取消", exact: true }).click();

    const textSection = page.locator(".settings-provider-capability-section").filter({ has: page.getByText("文本模型", { exact: true }) });
    await textSection.getByRole("combobox", { name: "默认 Provider", exact: true }).selectOption("work-text");
    await page.waitForFunction(() => (window as unknown as {cheapBuddyDesktopAcceptance:{snapshot():Snapshot}}).cheapBuddyDesktopAcceptance.snapshot().defaults.text === "work-text");
    await account.getByRole("button", { name: "退出登录", exact: true }).click();
    await account.getByRole("button", { name: "登录并配置", exact: true }).waitFor();
    const loggedOut = await snapshot(page);
    assert.equal(loggedOut.cheapbuddy.credentialRef, undefined);
    assert.deepEqual(loggedOut.cheapbuddy.capabilityModels?.image?.models, []);
    assert.deepEqual(loggedOut.defaults, { ...initial.defaults, text: "work-text" });
    assert.equal(loggedOut.workText.model, "local-text-fixture");
    assert.equal(loggedOut.localAudio.model, "local-audio-fixture");
    assert.equal(loggedOut.unsafeWrite, false);
    assert.equal(loggedOut.unsafeDiagnostic, false);
    const anyPrivateRendered = await privateRendered(page);
    assert.equal(anyPrivateRendered, false);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    await writeFile(`${evidence}desktop-acceptance.json`, JSON.stringify({
      verifiedOn: "2026-10-13", fixtureOnly: true, status: "passed", pageErrors, consoleErrors,
      blockedExternalHosts: [...new Set(blockedExternal)], initialDefaults: initial.defaults,
      loginPersistenceFailure: { failedWrites: failedLogin.failedWriteCount, connectedBeforeSave: false, errorShown: true, passwordCleared: true, retryConnected: connected.primary.credentialRef, retryErrorCleared: true },
      loginConfigured: connected.primary.credentialRef, noPortableApiKey: !connected.primary.hasApiKey && !loggedOut.unsafeWrite,
      nativePurchaseArguments: purchased.purchaseArguments, purchaseReturnRefreshes: loggedOut.refreshCount,
      imageCatalog: choices, managedFieldsDisabled: true, discoveryUsesReference: discovered.discoveries,
      logoutPreservedDefaults: loggedOut.defaults, noPrivateRendering: !anyPrivateRendered, noPrivateDiagnostics: !loggedOut.unsafeDiagnostic,
      actions: loggedOut.accountActions,
      screenshots: ["desktop-settings-shell.png", "desktop-settings-connected.png", "desktop-image-provider-managed.png", "desktop-settings-persistence-error.png"],
    }, null, 2));
    await Promise.all(["desktop-acceptance-failure.json", "desktop-acceptance-failure.png"].map((file) => unlink(`${evidence}${file}`).catch(() => undefined)));
  } catch (error) {
    await page.screenshot({ path: `${evidence}desktop-acceptance-failure.png` }).catch(() => undefined);
    const safe = String(error).replaceAll("fixture-model-key-never-render-or-log", "[redacted]").replaceAll("fixture-password-never-render-or-log", "[redacted]");
    await writeFile(`${evidence}desktop-acceptance-failure.json`, JSON.stringify({ status: "failed", error: safe, pageErrors, consoleErrors, snapshot: await snapshot(page).catch(() => undefined) }, null, 2));
    throw error;
  } finally {
    await browser.close();
    await vite.close();
  }
});
