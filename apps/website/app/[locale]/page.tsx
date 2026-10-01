import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WebsiteHome } from "../../components/website-home";
import { siteUrl, startHref } from "../site-config";

type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const title = locale === "zh" ? "Coworkany｜你的个人 AI 智能体工作台" : "Coworkany | Your Personal AI Agent Workspace";
  const description = locale === "zh"
    ? "你的个人 AI 智能体。把调研、写作、设计与日常工作，推进到真正的交付。"
    : "Your personal AI agent. Turn research, writing, design, and everyday work into real deliverables.";
  const imageAlt = locale === "zh"
    ? "Coworkany，你的个人 AI 智能体工作台"
    : "Coworkany, your personal AI agent workspace";
  return {
    metadataBase: siteUrl,
    title, description,
    alternates: { canonical: `/${locale}`, languages: { en: "/en", "zh-CN": "/zh", "x-default": "/en" } },
    icons: { icon: "/icon.png", apple: "/apple-icon.png" },
    openGraph: {
      title,
      description,
      siteName: "Coworkany",
      type: "website",
      url: `/${locale}`,
      locale: locale === "zh" ? "zh_CN" : "en_US",
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: imageAlt, type: "image/png" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: "/og-image.png", alt: imageAlt }],
    },
  };
}

export default async function WebsitePage({ params }: Props) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return <WebsiteHome locale={locale} startHref={startHref} />;
}
