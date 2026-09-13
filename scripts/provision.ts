import "./_env";
import { writeFile } from "node:fs/promises";
import { sleep } from "@/adapters/logged-fetch";
import { SCENARIOS } from "@/domain/scenarios";
import { argaClient } from "@/eval/seed";

// npm run provision [-- --with-scenario-prompts]
// Four twins in one run needs Arga's Team plan (Free = 1 twin, 10-minute TTL). Writes credentials to .env.twins (gitignored).
const withPrompts = process.argv.includes("--with-scenario-prompts");
const arga = argaClient();
const { runId } = await arga.twins.provision({
  twins: ["stripe", "gmail", "slack", "salesforce"],
  ttlMinutes: Number(process.env.ARGA_TTL_MINUTES ?? 480),
  ...(withPrompts
    ? { scenarioPrompt: SCENARIOS.map((s) => `${s.key}: ${s.fixture.scenario_prompt}`).join("\n\n"), scenarioGenerationMode: "thorough" as const }
    : {}),
});
console.log(`provisioning twin run ${runId}…`);

let status = await arga.twins.getStatus(runId);
while (status.status !== "ready") {
  if (["failed", "expired", "cancelled"].includes(status.status)) throw new Error(`twin run ${status.status}: ${status.error ?? ""}`);
  await sleep(5000);
  status = await arga.twins.getStatus(runId);
}

const lines = [`ARGA_TWIN_RUN_ID=${runId}`];
for (const [name, twin] of Object.entries(status.twins)) {
  lines.push(`# ${name}: ${twin.baseUrl}`);
  for (const [k, v] of Object.entries(twin.envVars)) lines.push(`${k}=${v}`);
  if (name === "gmail" && !twin.envVars.GMAIL_API_BASE_URL) lines.push(`GMAIL_API_BASE_URL=${twin.baseUrl}`);
  if (name === "stripe" && !twin.envVars.STRIPE_TWIN_BASE_URL && !twin.envVars.STRIPE_API_BASE_URL) lines.push(`STRIPE_API_BASE_URL=${twin.baseUrl}`);
  if (name === "slack" && !twin.envVars.SLACK_TWIN_BASE_URL && !twin.envVars.SLACK_API_URL) lines.push(`SLACK_API_URL=${twin.baseUrl}`);
}
if (withPrompts) lines.push("EVAL_SEED_MODE=prompt");
await writeFile(".env.twins", `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`ready; expires ${status.expiresAt}. Wrote .env.twins — scripts load it automatically; for next dev, copy it into .env.local.`);
console.log("Next: npm run twins:check -- --capture");
