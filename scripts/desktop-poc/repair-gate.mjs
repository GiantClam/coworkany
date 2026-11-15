import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const MAX_REPAIR_ROUNDS = 2;

function fail(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

export function validateRepairAttempt({ round, failureCard, phase = "repair", manifest, testResult } = {}) {
  if (!Number.isInteger(round) || round < 1 || round > MAX_REPAIR_ROUNDS) return fail("repair_round_limit_exceeded", `repair round must be between 1 and ${MAX_REPAIR_ROUNDS}`, { round, maxRounds: MAX_REPAIR_ROUNDS });
  if (!failureCard || typeof failureCard !== "object") return fail("failure_card_required", "a failure card is required before changing code");
  if (failureCard.category === "environment") return fail("environment_failure_not_code_repair", "environment failures require an environment fix or manual gate, not a code repair");
  if (failureCard.eligibleForRepair !== true) return fail("failure_not_eligible_for_repair", "the failure card does not authorize a bounded code repair");
  if (failureCard.reproducible === false) return fail("failure_not_reproducible", "the failure must be reproducible before a code repair");
  if (phase === "repair") return { ok: true, phase, round, maxRounds: MAX_REPAIR_ROUNDS, action: "repair" };
  if (phase !== "verify") return fail("repair_phase_invalid", `unsupported repair phase: ${phase}`);
  if (!manifest || manifest.status !== "passed") return fail("verification_manifest_not_passed", "verification requires a passed run manifest");
  if (manifest.cleanup?.completed !== true) return fail("verification_cleanup_incomplete", "verification requires completed cleanup");
  if (!testResult || testResult.ok !== true) return fail("verification_tests_not_passed", "verification requires a passing test result");
  return { ok: true, phase, round, maxRounds: MAX_REPAIR_ROUNDS, action: "publish_candidate" };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const failurePath = value("--failure-card");
  const manifestPath = value("--manifest");
  const testPath = value("--test-result");
  const round = Number(value("--round"));
  const phase = args.includes("--verify") ? "verify" : "repair";
  if (!failurePath) throw new Error("repair_failure_card_required");
  const failureCard = await readJson(failurePath);
  const manifest = manifestPath ? await readJson(manifestPath) : undefined;
  const testResult = testPath ? await readJson(testPath) : undefined;
  const result = validateRepairAttempt({ round, failureCard, phase, manifest, testResult });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (manifestPath) {
    const output = resolve(dirname(manifestPath), `repair-round-${round}.json`);
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
