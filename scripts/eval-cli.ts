import "./_env";
import { writeFile } from "node:fs/promises";
import { SCENARIOS } from "@/domain/scenarios";
import type { EvalResult } from "@/domain/types";
import { computeMetrics } from "@/eval/assertions";
import { runScenario } from "@/eval/harness";

// npm run eval [-- scenario_key ...]
const keys = process.argv.slice(2).length ? process.argv.slice(2) : SCENARIOS.map((s) => s.key);
const results: EvalResult[] = [];
for (const key of keys) {
  process.stdout.write(`${key} … `);
  const r = await runScenario(key);
  results.push(r);
  console.log(r.skipped ? `skipped (${r.skipped})` : `${r.passed ? "PASS" : "FAIL"} ${r.branch ?? "-"} ${r.wallMs}ms`);
  for (const f of r.failures) console.log(`    ${f}`);
}

const metrics = computeMetrics(results);
const at = new Date().toISOString();
await writeFile("eval/results.json", JSON.stringify({ at, model: process.env.AGENT_MODEL ?? "claude-sonnet-5", metrics, results }, null, 2) + "\n");

const md = [
  `# Eval results`,
  ``,
  `Run at ${at}. Each scenario: reset twins → seed → run agent → assert provider state.`,
  ``,
  `| Metric | Value |`,
  `| --- | --- |`,
  `| Task success rate | ${metrics.taskSuccessRate}% (${results.filter((r) => r.passed).length}/${metrics.scenariosRun}) |`,
  `| Decision accuracy | ${metrics.decisionAccuracy}% |`,
  `| False-action rate | ${metrics.falseActionRate}% |`,
  `| Constraint-violation rate | ${metrics.constraintViolationRate}% |`,
  `| Recovery rate | ${metrics.recoveryRate}% (${metrics.chaosScenarios} chaos scenarios) |`,
  `| State consistency | ${metrics.stateConsistency}% |`,
  `| Mean provider calls | ${metrics.meanProviderCalls} |`,
  `| Mean wall time | ${(metrics.meanWallMs / 1000).toFixed(1)} s |`,
  ``,
  `| Scenario | Expected | Got | Chaos | Submit attempts | Provider calls | Result |`,
  `| --- | --- | --- | --- | --- | --- | --- |`,
  ...results.map(
    (r) =>
      `| ${r.scenario} | ${r.expectedBranch} | ${r.branch ?? "-"} | ${r.chaos} | ${r.submitAttempts} | ${r.providerCalls} | ${r.skipped ? `skipped: ${r.skipped}` : r.passed ? "pass" : `fail: ${r.failures.join("; ")}`} |`,
  ),
  ``,
].join("\n");
await writeFile("eval/results.md", md);
console.log(`\n${md}`);
