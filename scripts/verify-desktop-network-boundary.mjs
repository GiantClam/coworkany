import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { collectDesktopBundleFiles } from "./verify-desktop-bundle-boundaries.mjs";
import { readFile } from "node:fs/promises";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const STATIC_REMOTE_URL = /\bhttps?:\/\/[a-z0-9][a-z0-9.-]*(?::\d+)?(?:[/?#'"`)]|$)/giu;

const DOCUMENTATION_URL = /^(?:https?:\/\/(?:example\.com(?:[/?#'"`)]|$)|www\.w3\.org\/|www\.ibm\.com\/|json-schema\.org\/)|https:\/\/(?:react\.dev|github\.com|radix-ui\.com)\/)/iu;
// Provider catalog defaults are displayed as configuration suggestions. They
// are not contacted by the bundled UI; actual requests still flow through the
// host/provider adapter and user configuration.
const APPROVED_PROVIDER_CATALOG_URLS = new Set([
  "https://api.siliconflow.cn/",
  "https://openrouter.ai/",
  "https://api.minimaxi.com/",
  "https://api.openai.com/",
  "https://api.pptoken.cc/",
  "https://ark.cn-beijing.volces.com/",
  "https://dashscope.aliyuncs.com/",
  "https://generativelanguage.googleapis.com/",
  "https://open.bigmodel.cn/",
  "https://www.runninghub.cn/",
  "https://www.runninghub.ai/",
]);

export function scanDesktopNetworkBoundary(files) {
  return files.flatMap(({ filePath, source }) => {
    STATIC_REMOTE_URL.lastIndex = 0;
    const urls = [...source.matchAll(STATIC_REMOTE_URL)].map((match) => match[0]);
    const external = urls.find((url) => {
      const normalizedUrl = url.replace(/[\\"'`)]/gu, "");
      const approvedProviderUrl = APPROVED_PROVIDER_CATALOG_URLS.has(normalizedUrl) || APPROVED_PROVIDER_CATALOG_URLS.has(`${normalizedUrl}/`);
      return !/^(?:https?:\/\/)(?:127\.0\.0\.1|localhost)(?::\d+)?(?:[/?#'"`)]|$)/iu.test(url) && !DOCUMENTATION_URL.test(url) && !approvedProviderUrl;
    });
    return external ? [{ filePath, label: "hardcoded external URL", url: external }] : [];
  });
}

export async function verifyDesktopNetworkBoundary(root = repoRoot) {
  const filePaths = await collectDesktopBundleFiles(root);
  if (!filePaths.length) throw new Error("desktop_bundle_missing_build_first");
  const files = [];
  for (const filePath of filePaths) files.push({ filePath, source: await readFile(filePath, "utf8") });
  const violations = scanDesktopNetworkBoundary(files);
  return {
    files: filePaths,
    checkedBytes: files.reduce((total, file) => total + Buffer.byteLength(file.source, "utf8"), 0),
    violations,
  };
}

async function main() {
  const result = await verifyDesktopNetworkBoundary();
  console.log(JSON.stringify(result, null, 2));
  if (result.violations.length) process.exitCode = 1;
}

if (pathToFileURL(resolve(process.argv[1] ?? "")).href === import.meta.url) await main();
