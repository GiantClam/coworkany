"use client";

import { CoworkanyHomePage } from "@/components/seo/coworkany-home";
import { LOCALE_COOKIE } from "../worker/locale";
import type { AppLocale } from "@/lib/i18n/config";

export function WebsiteHome({ locale, startHref }: { locale: AppLocale; startHref: string }) {
  function selectLocale(nextLocale: AppLocale) {
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  return <CoworkanyHomePage locale={locale} startHref={startHref} onLocaleChange={selectLocale} />;
}
