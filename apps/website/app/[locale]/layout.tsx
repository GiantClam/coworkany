import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import "../styles.css";

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }];
}

export const dynamicParams = false;

export default async function WebsiteLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return <html lang={locale === "zh" ? "zh-CN" : "en"}><body>{children}</body></html>;
}
