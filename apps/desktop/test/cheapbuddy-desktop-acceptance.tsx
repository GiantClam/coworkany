import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import { createCheapBuddyProvider } from "../src/cheapbuddy";
import { SIGNED_OUT_CHEAPBUDDY_STATE, type CheapBuddyAccountState } from "../src/cheapbuddy-contract";
import type { DesktopProviderConfig } from "../src/provider-config";
import "../src/tailwind.css";
import "@coworkany/workbench-ui/styles.css";
import "../src/styles.css";
import "../src/cheapbuddy-account.css";
import "../src/native-questions.css";
import "../src/styles-macos.css";
import "../src/virtual-office/virtual-office.css";

// All data and native responses below are fixtures. No account, provider, or
// payment request leaves this page. Invocation logs intentionally omit secrets.
const PRIVATE_KEY = "fixture-model-key-never-render-or-log";
const PASSWORD = "fixture-password-never-render-or-log";
const provider: DesktopProviderConfig = {
  ...createCheapBuddyProvider(),
  model: "glm-5.3", models: ["glm-5.3", "kimi-k3", "grok-imagine-image-2.0", "gpt-image-2.5", "MiniMax-H3"],
  credentialRef: "cheapbuddy-desktop-fixture-session",
  // Deliberately simulate an accidental host field: the App merge must strip it.
  apiKey: PRIVATE_KEY,
  capabilityModels: {
    text: { model: "glm-5.3", models: ["glm-5.3", "kimi-k3"] },
    image: { model: "grok-imagine-image-2.0", models: ["grok-imagine-image-2.0", "gpt-image-2.5"] },
    video: { model: "MiniMax-H3", models: ["MiniMax-H3"] },
  },
};
const workText = { id: "work-text", source: "local", model: "local-text-fixture", models: ["local-text-fixture"], capabilities: ["text"] };
const localAudio = { id: "local-audio", source: "local", model: "local-audio-fixture", models: ["local-audio-fixture"], capabilities: ["audio"] };
let config = {
  schemaVersion: 1, locale: "zh", workspacePath: "/fixture/workspace", runtime: { source: "system" },
  provider: createCheapBuddyProvider(),
  providers: { cheapbuddy: createCheapBuddyProvider(), "work-text": workText, "local-audio": localAudio },
  defaults: { text: "cheapbuddy", image: "cheapbuddy", video: "cheapbuddy", audio: "local-audio" },
};
let signedIn = false;
let refreshCount = 0;
let writeCount = 0;
let writeFailuresRemaining = 0;
let failedWriteCount = 0;
let passwordMatched = false;
let unsafeWrite = false;
let unsafeDiagnostic = false;
const accountActions: string[] = [];
const nativeCommands: Array<{ command: string; argumentKeys: string[] }> = [];
const discoveries: Array<{ capability: string; credentialRef: boolean; apiKey: boolean }> = [];
const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

function accountState(): CheapBuddyAccountState {
  return signedIn ? {
    status: "connected", persistent: false, provider,
    account: { id: 101, email: "desktop-fixture@example.com", balance: 42.5 + refreshCount },
    products: [{ id: "recharge-fixture", kind: "recharge", name: "测试充值包", amount: 15, currency: "CNY" },
      { id: "membership-fixture", kind: "membership", name: "测试会员套餐", amount: 9, currency: "USD", period: "30 天" }],
    rechargeCatalogAvailable: true,
    memberships: [{ id: "member-fixture", name: "联调测试会员", expiresAt: "2026-11-13" }],
  } : SIGNED_OUT_CHEAPBUDDY_STATE;
}

function containsPrivate(value: unknown) {
  const text = JSON.stringify(value);
  return text?.includes(PRIVATE_KEY) || text?.includes(PASSWORD) || false;
}

function emit(frame: Record<string, unknown>) {
  const raw = JSON.stringify(frame);
  for (const listener of listeners.get("desktop://runtime-response") ?? []) listener({ payload: { raw: `${raw.length}:${raw}`, generation: 1 } });
}

const fixtureWindow = window as unknown as Window & {
  __TAURI__: {
    core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
    event: { listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> };
  };
  cheapBuddyDesktopAcceptance: { snapshot(): Record<string, unknown>; failNextConfigWrite(): void };
};

fixtureWindow.__TAURI__ = {
  core: {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      nativeCommands.push({ command, argumentKeys: Object.keys(args ?? {}) });
      let result: unknown = null;
      if (command === "health") result = { status: "ok" };
      else if (command === "local_state_status") result = { integrity: true, interruptedRuns: 0 };
      else if (command === "read_config") result = structuredClone(config);
      else if (command === "write_config") {
        unsafeWrite ||= containsPrivate(args?.value);
        if (writeFailuresRemaining > 0) {
          writeFailuresRemaining -= 1;
          failedWriteCount += 1;
          throw new Error("fixture_write_config_failed");
        }
        config = structuredClone(args?.value) as typeof config;
        writeCount += 1;
      } else if (command === "runtime_status") result = { ready: true, development: true, skills: true, paths: {} };
      else if (command === "host_start") result = 1;
      else if (command === "list_local_skill_catalog") result = { schemaVersion: 1, skills: [] };
      else if (command === "usage_summary") result = { input_tokens: 0, output_tokens: 0 };
      else if (command.startsWith("list_")) result = [];
      else if (command === "append_diagnostic_log") unsafeDiagnostic ||= containsPrivate(args);
      else if (command === "host_send") {
        const frame = args?.message as { requestId: string; type: string; payload?: Record<string, unknown> };
        if (frame.type === "cheapbuddy.account") {
          const action = String(frame.payload?.action);
          accountActions.push(action);
          if (action === "login") {
            passwordMatched = frame.payload?.password === PASSWORD && frame.payload?.email === "desktop-fixture@example.com";
            signedIn = passwordMatched;
          } else if (action === "refresh" && signedIn) refreshCount += 1;
          else if (action === "logout") signedIn = false;
          emit({ requestId: frame.requestId, ok: true, data: { state: accountState() } });
        } else if (frame.type === "provider.models") {
          const descriptor = frame.payload?.provider as Record<string, unknown>;
          const capability = String(frame.payload?.capability);
          discoveries.push({ capability, credentialRef: Boolean(descriptor?.credentialRef), apiKey: Object.hasOwn(descriptor ?? {}, "apiKey") });
          emit({ requestId: frame.requestId, ok: true, data: { models: provider.capabilityModels?.[capability as "text" | "image" | "video"]?.models ?? [] } });
        } else emit({ requestId: frame.requestId, ok: true, data: {} });
      }
      return result as T;
    },
  },
  event: {
    async listen<T>(event: string, handler: (event: { payload: T }) => void) {
      const group = listeners.get(event) ?? new Set();
      const listener = handler as (event: { payload: unknown }) => void;
      group.add(listener);
      listeners.set(event, group);
      return () => { group.delete(listener); };
    },
  },
};

fixtureWindow.cheapBuddyDesktopAcceptance = {
  failNextConfigWrite: () => { writeFailuresRemaining += 1; },
  snapshot: () => ({
    defaults: { ...config.defaults }, writeCount, failedWriteCount, refreshCount, passwordMatched, unsafeWrite, unsafeDiagnostic,
    accountActions: [...accountActions], nativeCommands: [...nativeCommands], discoveries: [...discoveries],
    primary: { id: config.provider.id, model: config.provider.model, hasApiKey: Boolean(config.provider.apiKey), credentialRef: Boolean(config.provider.credentialRef) },
    cheapbuddy: { ...config.providers.cheapbuddy, apiKey: undefined },
    workText: config.providers["work-text"], localAudio: config.providers["local-audio"],
    nativePurchaseCount: nativeCommands.filter(({ command }) => command === "open_cheapbuddy_purchase").length,
    purchaseArguments: nativeCommands.filter(({ command }) => command === "open_cheapbuddy_purchase").map(({ argumentKeys }) => argumentKeys),
  }),
};

window.history.replaceState({}, "", "/dashboard/settings");
document.documentElement.dataset.desktopPlatform = "macos";
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
