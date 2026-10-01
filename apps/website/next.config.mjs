import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Only the marketing routes below this app are compiled and published. */
export default {
  output: "export",
  trailingSlash: false,
  images: { unoptimized: true },
  outputFileTracingRoot: resolve(fileURLToPath(new URL(".", import.meta.url)), "../.."),
  poweredByHeader: false,
};
