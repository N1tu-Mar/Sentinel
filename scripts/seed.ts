import "./_env";
import { SCENARIOS, scenarioByKey } from "@/domain/scenarios";
import { seedScenario } from "@/eval/seed";

// npm run seed -- receipt_confirmed_repeat canceled_before_charge_large   (no args = all scenarios)
const keys = process.argv.slice(2);
const list = keys.length ? keys.map((k) => scenarioByKey(k) ?? Promise.reject(new Error(`unknown scenario ${k}`))) : SCENARIOS;
for (const s of await Promise.all(list)) {
  const r = await seedScenario(s);
  console.log(`${s.key}: dispute ${r.disputeId} customer ${r.customerId} <${r.email}>${r.notes.length ? `  notes: ${r.notes.join("; ")}` : ""}`);
}
