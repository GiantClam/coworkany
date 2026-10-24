// The app origin stays separate from the public marketing site.
export const siteUrl = new URL(process.env.WEBSITE_ORIGIN || "https://coworkany.com");
export const startHref = process.env.WEBSITE_START_URL || "https://www.aimarketingsite.com/register";
if (!["https:", "http:"].includes(new URL(startHref).protocol)) throw new Error("Invalid WEBSITE_START_URL");
