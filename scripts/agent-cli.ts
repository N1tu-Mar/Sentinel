import "./_env";
import { parseArgs } from "node:util";
import { ingestDispute } from "@/agent/cases";
import { decideApproval, runCase } from "@/agent/run";
import { scenarioByKey } from "@/domain/scenarios";
import type { ChaosMode, TimelineEvent } from "@/domain/types";
import { seedScenario } from "@/eval/seed";
import { getStore } from "@/store";

// npm run agent -- --case dp_123 [--chaos drop_submit_once] [--approve]
// npm run agent -- --scenario 07          (seeds the fixture scenario first)
const { values } = parseArgs({
  options: {
    case: { type: "string" },
    scenario: { type: "string" },
    chaos: { type: "string" },
    approve: { type: "boolean" },
  },
});

const scenario = values.scenario ? scenarioByKey(values.scenario) : undefined;
if (values.scenario && !scenario) throw new Error(`unknown scenario ${values.scenario}`);
let disputeId = values.case;
if (scenario) {
  const seeded = await seedScenario(scenario);
  console.log(`seeded ${scenario.key}: ${seeded.disputeId}`, seeded.notes);
  disputeId = seeded.disputeId;
}
if (!disputeId) throw new Error("pass --case <dispute id> or --scenario <key>");

const store = getStore();
if (!(await store.getCase(disputeId))) await ingestDispute(disputeId, scenario?.key);

const fmt = (e: TimelineEvent): string => {
  const time = new Date(e.t).toISOString().slice(11, 19);
  switch (e.type) {
    case "provider_call":
      return `${time}   · ${e.system} ${e.method} ${e.path} ${e.status} ${e.ms}ms`;
    case "thought":
      return `${time} … ${e.text}`;
    case "tool_call":
      return `${time} → ${e.tool} ${JSON.stringify(e.input).slice(0, 160)}`;
    case "tool_result":
      return `${time} ${e.ok ? "←" : "✗"} ${e.tool}: ${e.summary}`;
    case "evidence":
      return `${time} ◆ evidence ${e.item.id} [${e.item.source}/${e.item.kind}] ${e.item.summary}`;
    case "decision":
      return `${time} ■ DECISION ${e.decision.branch} (${e.decision.confidence}) ${e.decision.rationale}`;
    case "verify":
      return `${time} ${e.passed ? "✓" : "✗"} verify ${e.action}: expected ${e.expected}; observed ${e.observed}`;
    case "action":
      return `${time} ▶ ${e.action} attempt ${e.attempt} key=${e.idempotencyKey}`;
    default:
      return `${time} ${e.type} ${JSON.stringify(e).slice(0, 200)}`;
  }
};

let c = await runCase(disputeId, { chaosMode: (values.chaos ?? scenario?.chaos ?? "none") as ChaosMode });
if (c.status === "awaiting_approval" && (values.approve || scenario?.needsApproval)) c = await decideApproval(c.id, "approved", "cli");

for (const e of await store.getEvents(c.id)) console.log(fmt(e));
console.log("\nstatus:", c.status, "| branch:", c.decision?.branch, "| provider calls:", c.providerCalls, "| forbidden:", c.forbiddenEffects);
for (const x of c.verification?.checks ?? []) console.log(`${x.passed ? "✓" : "✗"} [${x.system}] ${x.check}: expected ${x.expected}, observed ${x.observed}`);
console.log("\n" + (c.finalSummary ?? ""));
if (c.lemmaTraceId) console.log(`Lemma trace ${c.lemmaTraceId}`);
process.exit(c.status === "resolved" || c.status === "awaiting_approval" ? 0 : 1);
