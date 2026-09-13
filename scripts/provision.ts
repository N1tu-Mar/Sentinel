import "./_env";
import { writeFile } from "node:fs/promises";
import { SCENARIOS } from "@/domain/scenarios";
import { DEFAULT_TWINS, provisionTwins } from "@/eval/arga";

// npm run provision [-- --twins=gmail,slack,salesforce] [--together] [--with-scenario-prompts]
// Default: one run per twin (Arga Free plan: 1 twin per run, 10-minute TTL). --together needs the Team plan.
// Stripe stays on real Stripe test mode (Kill Check #1). Writes credentials to .env.twins (gitignored).
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const withPrompts = process.argv.includes("--with-scenario-prompts");

const { env, runIds, bases, expiresAt } = await provisionTwins({
  twins: arg("twins")?.split(",") ?? DEFAULT_TWINS,
  split: !process.argv.includes("--together"),
  ttlMinutes: Number(process.env.ARGA_TTL_MINUTES ?? 10),
  scenarioPrompt: withPrompts ? SCENARIOS.map((s) => `${s.key}: ${s.fixture.scenario_prompt}`).join("\n\n") : undefined,
});

const lines = [
  ...Object.entries(bases).map(([name, url]) => `# ${name}: ${url}`),
  ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
  ...(withPrompts ? ["EVAL_SEED_MODE=prompt"] : []),
];
await writeFile(".env.twins", `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`ready: ${runIds.length} run(s), first expiry ${expiresAt ?? "none reported"}. Wrote .env.twins (scripts load it; copy into .env.local for next dev).`);
console.log("Next: npm run twins:check -- --capture");
