import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

const cli = process.env.PLAYWRIGHT_CLI_PATH ?? resolve(homedir(), ".codex/skills/playwright/scripts/playwright_cli.sh");
const session = "message-visual-contract";
const base = process.env.MESSAGE_VISUAL_BASE_URL ?? "http://127.0.0.1:1427";
mkdirSync("output/playwright", { recursive: true });
const invoke = (args) => {
  const result = spawnSync(cli, [`-s=${session}`, ...args], { encoding: "utf8", timeout: 240_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0 || result.stdout.includes("### Error")) {
    throw new Error(result.error?.message ?? `${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
};
try {
  invoke(["open", `${base}/test/fixtures/assistant-turn-acceptance.html?step=3`]);
  const code = readFileSync(new URL("./message-visual-acceptance.code.js", import.meta.url), "utf8").replaceAll("__BASE_URL__", base);
  const output = invoke(["run-code", code]);
  writeFileSync("output/playwright/message-visual-acceptance.log", output);
  const result = invoke(["eval", "() => window.MESSAGE_VISUAL_REPORT"]);
  const report = result.match(/### Result\n([\s\S]*?)\n### Ran/)?.[1];
  if (!report) throw new Error(`Acceptance returned no report:\n${output.slice(-3000)}`);
  writeFileSync("output/playwright/message-visual-acceptance.json", `${JSON.stringify(JSON.parse(report), null, 2)}\n`);
  console.log(`Message visual acceptance passed; report: output/playwright/message-visual-acceptance.json`);
} finally {
  invoke(["close"]);
}
