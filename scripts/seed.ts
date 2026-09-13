import "./_env";
import { SCENARIOS, scenarioByKey } from "@/domain/scenarios";
import { seedScenario } from "@/eval/seed";

// npm run seed -- 07 04   (no args = all eight fixture scenarios)
const keys = process.argv.slice(2);
for (const key of keys.length ? keys : SCENARIOS.map((s) => s.key)) {
  const s = scenarioByKey(key);
  if (!s) throw new Error(`unknown scenario ${key}`);
  const r = await seedScenario(s);
  console.log(`${s.key}: dispute ${r.disputeId} customer ${r.customerId} <${r.email}>  ${r.notes.join("; ")}`);
}
