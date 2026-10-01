export const SUPPORTED_LOCALES = ["en", "zh"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "coworkany_site_locale";

const LANGUAGE_RANGE = /^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i;
const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

function localeForLanguageRange(range: string): Locale | undefined {
  const language = range.toLowerCase().split("-", 1)[0];
  return language === "en" || language === "zh" ? language : undefined;
}
/** Read the exact locale cookie, ignoring unrelated or malformed cookie values. */
export function localeFromCookie(cookieHeader: string | null): Locale | undefined {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name !== LOCALE_COOKIE) continue;
    return value === "en" || value === "zh" ? value : undefined;
  }

  return undefined;
}

/**
 * Select a supported locale from Accept-Language. Higher q values win; ties
 * preserve browser order. Invalid ranges and q values are ignored.
 */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  const candidates: Array<{ locale: Locale; quality: number; order: number }> = [];
  header.split(",").forEach((raw, order) => {
    const [rangePart, ...parameters] = raw.trim().split(";");
    const range = rangePart?.trim();
    if (!range || range === "*" || !LANGUAGE_RANGE.test(range)) return;

    let quality = 1;
    for (const parameter of parameters) {
      const [name, value, ...extra] = parameter.trim().split("=");
      if (name?.toLowerCase() !== "q" || !value || extra.length > 0 || !QUALITY.test(value)) return;
      quality = Number(value);
    }
    if (quality === 0) return;

    const locale = localeForLanguageRange(range);
    if (locale) candidates.push({ locale, quality, order });
  });

  candidates.sort((a, b) => b.quality - a.quality || a.order - b.order);
  return candidates[0]?.locale ?? DEFAULT_LOCALE;
}

export function localeFromRequest(request: Request): Locale {
  return (
    localeFromCookie(request.headers.get("Cookie")) ??
    localeFromAcceptLanguage(request.headers.get("Accept-Language"))
  );
}
