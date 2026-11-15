import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateScenarioPlan } from "./contracts";

async function main() {
  const scenarioPath = process.argv.find((arg) => arg.endsWith(".json")) ?? resolve("scripts/desktop-poc/scenarios/workflow-persistence.json");
  const plan = validateScenarioPlan(JSON.parse(await readFile(scenarioPath, "utf8")));
  const desktopActions = plan.steps.filter((step) => step.actor === "desktop-agent").length;
  process.stdout.write(`${JSON.stringify({ ok: true, scenarioId: plan.scenarioId, steps: plan.steps.length, desktopActions, cleanupSteps: plan.cleanup.length }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
