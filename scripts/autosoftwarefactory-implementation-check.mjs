import { access } from "node:fs/promises";
import { resolve } from "node:path";

const required = [
  "pnpm-lock.yaml",
  "scripts/desktop-release-entry-regression.mjs",
  "scripts/verify-desktop-network-boundary.mjs",
  "apps/desktop/src/App.tsx",
  "docs/superpowers/assets/drafts/2026-10-10-virtual-studio/complete-studio-background-v1.png",
  "docs/superpowers/assets/drafts/2026-10-10-virtual-studio/rig-animation-data-v1.json"
];
for (const file of required) await access(resolve(process.cwd(), file));
console.log(JSON.stringify({ status: "passed", implementation: "autosoftwarefactory-coworkany-release", required }));
