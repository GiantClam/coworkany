import type { Metadata } from "next"

import { getRequestLocale } from "@/lib/i18n/request-locale"
import { getHomeMetadata, renderHomePage } from "@/lib/seo/localized-public-pages"

export async function generateMetadata(): Promise<Metadata> {
  return getHomeMetadata(await getRequestLocale())
}

export default async function HomePage() {
  const locale = await getRequestLocale()
  return await renderHomePage(locale)
}
