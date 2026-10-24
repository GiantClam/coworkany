import { useId, useRef, useState, type FormEvent } from "react";
import type { CheapBuddyAccountAction, CheapBuddyAccountState, CheapBuddyProduct } from "./cheapbuddy-contract";

export type CheapBuddyAccountPanelProps = {
  readonly locale: "zh" | "en";
  readonly state: CheapBuddyAccountState;
  readonly busy: boolean;
  readonly error?: string;
  readonly onAction: (action: CheapBuddyAccountAction, payload?: Record<string, unknown>) => Promise<void>;
  readonly onPurchase: () => Promise<void>;
};

const copy = {
  zh: {
    title: "CheapBuddy 账号", hint: "登录后同步可用模型与 Provider 配置。",
    email: "邮箱", password: "密码", login: "登录并配置", loginBusy: "正在登录…",
    code: "验证码", verify: "验证并登录", verifyBusy: "正在验证…",
    verificationHint: "请输入 CheapBuddy 账号的 6 位验证码。", cancelVerification: "返回登录",
    connected: "已连接", noModels: "账号已登录，暂无可用模型", signedOut: "未登录",
    expired: "登录已过期，请重新登录。", balance: "余额", membership: "当前会员",
    noMembership: "暂无有效会员", expires: "到期", refresh: "刷新账号", refreshBusy: "正在刷新…",
    logout: "退出登录", logoutBusy: "正在退出…", purchase: "前往官网购买", purchaseBusy: "正在打开官网…",
    recharge: "余额充值", membershipProducts: "会员套餐", priceUnavailable: "价格尚未同步，请在官网查看",
    rechargeMissing: "充值目录尚未同步，前往官网购买", noMembershipProducts: "暂无可展示的会员套餐，可前往官网查看。",
    sessionOnly: "登录仅在当前桌面会话中有效，关闭应用后需要重新登录。",
    refreshFailed: "账号刷新失败，显示上次同步的信息。请稍后重试。",
    catalogFailed: "套餐信息刷新失败，显示上次同步的信息。请稍后重试。",
    logoutUnconfirmed: "已在本机退出，服务端退出尚未确认。",
    syncFailed: "部分账号信息尚未同步，请刷新重试。",
    noModelsHint: "尚未完成模型配置。可刷新重试，或在官网检查账号权限与余额。",
    failed: "操作失败，请重试。", dismissError: "关闭错误提示", processing: "正在处理…",
  },
  en: {
    title: "CheapBuddy account", hint: "Sign in to sync available models and Provider settings.",
    email: "Email", password: "Password", login: "Sign in and configure", loginBusy: "Signing in…",
    code: "Verification code", verify: "Verify and sign in", verifyBusy: "Verifying…",
    verificationHint: "Enter the 6-digit verification code for your CheapBuddy account.", cancelVerification: "Back to sign in",
    connected: "Connected", noModels: "Signed in, no available models", signedOut: "Signed out",
    expired: "Your session has expired. Please sign in again.", balance: "Balance", membership: "Current membership",
    noMembership: "No active membership", expires: "Expires", refresh: "Refresh account", refreshBusy: "Refreshing…",
    logout: "Sign out", logoutBusy: "Signing out…", purchase: "Buy on website", purchaseBusy: "Opening website…",
    recharge: "Balance recharge", membershipProducts: "Membership plans", priceUnavailable: "Price has not synced. View it on the website.",
    rechargeMissing: "Recharge catalog has not synced. Buy on the website.", noMembershipProducts: "No membership plans available here. Check the website.",
    sessionOnly: "This sign-in lasts for the current desktop session. You will need to sign in again after closing the app.",
    refreshFailed: "Could not refresh your account. Showing the last synced information. Please try again later.",
    catalogFailed: "Could not refresh plan information. Showing the last synced information. Please try again later.",
    logoutUnconfirmed: "Signed out on this device. Server sign-out has not been confirmed.",
    syncFailed: "Some account information has not synced. Please refresh to retry.",
    noModelsHint: "Model setup is incomplete. Refresh to retry, or check your account access and balance on the website.",
    failed: "The action failed. Please try again.", dismissError: "Dismiss error", processing: "Working…",
  },
} as const;

function productPrice(product: CheapBuddyProduct, locale: "zh" | "en"): string | undefined {
  if (product.amount === undefined || !Number.isFinite(product.amount) || !product.currency?.trim()) return undefined;
  return `${new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en", { maximumFractionDigits: 4 }).format(product.amount)} ${product.currency}`;
}

export function CheapBuddyAccountPanel({ locale, state, busy, error, onAction, onPurchase }: CheapBuddyAccountPanelProps) {
  const ui = copy[locale];
  const titleId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<CheapBuddyAccountAction | "purchase" | null>(null);
  const [localError, setLocalError] = useState<string>();
  const [dismissedError, setDismissedError] = useState<string>();
  const inFlight = useRef(false);
  const working = busy || pending !== null;
  const accountVisible = state.status === "connected" || state.status === "no_models";
  const warning = state.warning === "cheapbuddy_refresh_failed" ? ui.refreshFailed
    : state.warning === "cheapbuddy_catalog_refresh_failed" ? ui.catalogFailed
      : state.warning === "cheapbuddy_remote_logout_failed" ? ui.logoutUnconfirmed
        : state.warning && !["cheapbuddy_credentials_session_only", "cheapbuddy_session_expired"].includes(state.warning) ? ui.syncFailed : undefined;
  const shownError = (error === dismissedError ? undefined : error) ?? localError;
  const rechargeProducts = state.products.filter((product) => product.kind === "recharge");
  const membershipProducts = state.products.filter((product) => product.kind === "membership");

  async function run(action: CheapBuddyAccountAction | "purchase", payload?: Record<string, unknown>) {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    setLocalError(undefined);
    setDismissedError(undefined);
    try {
      if (action === "purchase") await onPurchase();
      else await onAction(action, payload);
    } catch {
      // The host supplies a sanitized error; avoid rendering arbitrary callback errors.
      setLocalError(ui.failed);
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || !email.trim() || !password) return;
    const payload = { email: email.trim(), password };
    setPassword("");
    void run("login", payload);
  }

  function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || !/^\d{6}$/.test(code)) return;
    const payload = { code };
    setCode("");
    void run("verify", payload);
  }

  function products(items: readonly CheapBuddyProduct[]) {
    return <div className="cheapbuddy-products">{items.map((product) => {
      const price = productPrice(product, locale);
      return <article key={`${product.kind}-${product.id}`} className="cheapbuddy-product">
        <div><strong>{product.name}</strong>{product.description ? <p>{product.description}</p> : null}</div>
        <div className="cheapbuddy-product-price">{price ? <strong>{price}</strong> : <span>{ui.priceUnavailable}</span>}{product.period ? <span>{product.period}</span> : null}</div>
        <button type="button" className="ghost" disabled={working} onClick={() => void run("purchase")}>{ui.purchase}</button>
      </article>;
    })}</div>;
  }

  return <section className="cheapbuddy-account" aria-labelledby={titleId} aria-busy={working}>
    <header className="cheapbuddy-account-header"><div><h3 id={titleId}>{ui.title}</h3><p>{ui.hint}</p></div><span className="cheapbuddy-account-status">{accountVisible ? (state.status === "no_models" ? ui.noModels : ui.connected) : ui.signedOut}</span></header>
    {shownError ? <div className="cheapbuddy-account-error" role="alert"><p>{shownError}</p><button type="button" className="link-button" onClick={() => { setLocalError(undefined); setDismissedError(error); }}>{ui.dismissError}</button></div> : null}
    {state.status === "session_expired" ? <p className="cheapbuddy-account-note" role="status">{ui.expired}</p> : null}
    {warning ? <p className="cheapbuddy-account-note" role="status">{warning}</p> : null}
    {accountVisible ? <>
      <dl className="cheapbuddy-account-summary">
        <div><dt>{ui.email}</dt><dd>{state.account?.email ?? "—"}</dd></div>
        <div><dt>{ui.balance}</dt><dd>{state.account?.balance !== undefined && Number.isFinite(state.account.balance) ? new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en", { maximumFractionDigits: 4 }).format(state.account.balance) : "—"}</dd></div>
        <div><dt>{ui.membership}</dt><dd>{state.memberships.length ? state.memberships.map((membership) => <div key={membership.id}><span>{membership.name}</span>{membership.expiresAt ? <small>{ui.expires}: {membership.expiresAt}</small> : null}</div>) : ui.noMembership}</dd></div>
      </dl>
      {state.status === "no_models" ? <p className="cheapbuddy-account-note" role="status">{ui.noModelsHint}</p> : null}
      <div className="cheapbuddy-account-actions"><button type="button" className="ghost" disabled={working} onClick={() => void run("refresh")}>{pending === "refresh" ? ui.refreshBusy : ui.refresh}</button><button type="button" className="ghost" disabled={working} onClick={() => void run("logout")}>{pending === "logout" ? ui.logoutBusy : ui.logout}</button></div>
    </> : state.status === "verification_required" ? <form className="cheapbuddy-account-form" onSubmit={submitVerification}>
      <p>{ui.verificationHint}</p><label>{ui.code}<input name="code" type="text" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={working} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label>
      <div className="cheapbuddy-account-actions"><button type="submit" className="primary" disabled={working || !/^\d{6}$/.test(code)}>{pending === "verify" ? ui.verifyBusy : ui.verify}</button><button type="button" className="ghost" disabled={working} onClick={() => { setCode(""); void run("logout"); }}>{ui.cancelVerification}</button></div>
    </form> : <form className="cheapbuddy-account-form" onSubmit={submitLogin}>
      <label>{ui.email}<input name="email" type="email" autoComplete="username" required value={email} disabled={working} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>{ui.password}<input name="password" type="password" autoComplete="current-password" required value={password} disabled={working} onChange={(event) => setPassword(event.target.value)} /></label>
      <button type="submit" className="primary" disabled={working || !email.trim() || !password}>{pending === "login" ? ui.loginBusy : ui.login}</button>
    </form>}
    {accountVisible && !state.persistent ? <p className="cheapbuddy-account-note">{ui.sessionOnly}</p> : null}
    <section className="cheapbuddy-product-section" aria-label={ui.recharge}><h4>{ui.recharge}</h4>{state.rechargeCatalogAvailable && rechargeProducts.length ? products(rechargeProducts) : <p className="cheapbuddy-account-note">{ui.rechargeMissing}</p>}</section>
    <section className="cheapbuddy-product-section" aria-label={ui.membershipProducts}><h4>{ui.membershipProducts}</h4>{membershipProducts.length ? products(membershipProducts) : <p className="cheapbuddy-account-note">{ui.noMembershipProducts}</p>}</section>
    <div className="cheapbuddy-account-actions"><button type="button" className="ghost" disabled={working} onClick={() => void run("purchase")}>{pending === "purchase" ? ui.purchaseBusy : ui.purchase}</button>{working && pending === null ? <span role="status">{ui.processing}</span> : null}</div>
  </section>;
}
