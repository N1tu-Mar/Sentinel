import "./_env";
import { readFile, writeFile } from "node:fs/promises";
import { providerEnvironment } from "@/agent/cases";
import { SCENARIOS } from "@/domain/scenarios";
import type { EvalResult, ProviderEnvironment } from "@/domain/types";
import { computeMetrics } from "@/eval/assertions";
import { runScenario } from "@/eval/harness";

// npm run eval [-- scenario_key ...]
// eval/results.json keeps one entry per environment; a run only replaces its own environment's scenarios.
const ENV_TEXT: Record<ProviderEnvironment, string> = {
  "arga-twins": "Stripe test mode + Arga twins (Salesforce, Gmail, Slack)",
  "local-sandbox": "Stripe test mode + Sentinel sandbox (Salesforce, Gmail, Slack)",
};
interface EnvRun {
  at: string;
  environment: ProviderEnvironment;
  description: string;
  model: string;
  metrics: ReturnType<typeof computeMetrics>;
  results: EvalResult[];
}

const keys = process.argv.slice(2).length ? process.argv.slice(2) : SCENARIOS.map((s) => s.key);
const environment = providerEnvironment();
const fresh: EvalResult[] = [];
for (const key of keys) {
  process.stdout.write(`${key} … `);
  const r = await runScenario(key);
  fresh.push(r);
  console.log(r.skipped ? `skipped (${r.skipped})` : `${r.passed ? "PASS" : "FAIL"} ${r.branch ?? "-"} ${r.wallMs}ms`);
  for (const f of r.failures) console.log(`    ${f}`);
}

const previous = JSON.parse(await readFile("eval/results.json", "utf8").catch(() => "{}"));
// Older files held a single run at the top level.
const runs: Partial<Record<ProviderEnvironment, EnvRun>> = previous.results
  ? { [previous.results[0]?.environment ?? "local-sandbox"]: previous }
  : (previous.environments ?? {});
const merged = new Map((runs[environment]?.results ?? []).map((r) => [r.scenario, r]));
for (const r of fresh) merged.set(r.scenario, r);
const results = [...merged.values()].sort((a, b) => a.scenario.localeCompare(b.scenario));
const at = new Date().toISOString();
runs[environment] = {
  at,
  environment,
  description: ENV_TEXT[environment],
  model: process.env.AGENT_MODEL ?? "claude-sonnet-5",
  metrics: computeMetrics(results),
  results,
};
await writeFile("eval/results.json", `${JSON.stringify({ updatedAt: at, environments: runs }, null, 2)}\n`);

const section = (env: ProviderEnvironment) => {
  const run = runs[env];
  if (!run) return [`## ${ENV_TEXT[env]}`, "", "Not run yet.", ""];
  const mt = run.metrics;
  return [
    `## ${ENV_TEXT[env]}`,
    "",
    `Last run ${run.at}, model ${run.model}.`,
    "",
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Task success rate | ${mt.taskSuccessRate}% (${run.results.filter((r) => r.passed).length}/${mt.scenariosRun}) |`,
    `| Decision accuracy | ${mt.decisionAccuracy}% |`,
    `| False-action rate | ${mt.falseActionRate}% |`,
    `| Constraint-violation rate | ${mt.constraintViolationRate}% |`,
    `| Recovery rate | ${mt.recoveryRate}% (${mt.chaosScenarios} chaos scenarios) |`,
    `| State consistency | ${mt.stateConsistency}% |`,
    `| Mean provider calls | ${mt.meanProviderCalls} |`,
    `| Mean wall time | ${(mt.meanWallMs / 1000).toFixed(1)} s |`,
    "",
    `| Scenario | Expected | Got | Chaos | Submit attempts | Provider calls | Result |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...run.results.map(
      (r) =>
        `| ${r.scenario} | ${r.expectedBranch} | ${r.branch ?? "-"} | ${r.chaos} | ${r.submitAttempts} | ${r.providerCalls} | ${r.skipped ? `skipped: ${r.skipped}` : r.passed ? "pass" : `fail: ${r.failures.join("; ")}`} |`,
    ),
    "",
  ];
};
const md = [
  "# Eval results",
  "",
  "Each scenario: reset → seed → run agent → assert provider state. Results are kept separately per environment.",
  "",
  ...section("arga-twins"),
  ...section("local-sandbox"),
].join("\n");
await writeFile("eval/results.md", md);
console.log(`\n${md}`);
