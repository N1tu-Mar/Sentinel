import "./_env";
import { mkdir, writeFile } from "node:fs/promises";
import * as gmail from "@/adapters/gmail";
import * as sf from "@/adapters/salesforce";
import * as slack from "@/adapters/slack";
import { stripe } from "@/adapters/stripe";

// npm run twins:check [-- --capture]   --capture saves each live response to fixtures/live/ (they override doc-based fixtures)
const capture = process.argv.includes("--capture");

const checks: [string, string, () => Promise<unknown>][] = [
  ["stripe", "GET /v1/disputes", () => stripe().disputes.list({ limit: 10 })],
  [
    "salesforce",
    "GET /services/data",
    async () => {
      const res = await sf.listVersions();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  ],
  ["gmail", "GET users/me/profile", () => gmail.getProfile()],
  ["slack", "auth.test", () => slack.authTest()],
];

if (capture) await mkdir("fixtures/live", { recursive: true });
let failed = 0;
for (const [system, name, fn] of checks) {
  const t = Date.now();
  try {
    const body = await fn();
    console.log(`✓ ${system.padEnd(10)} ${name}  ${Date.now() - t} ms`);
    if (capture) await writeFile(`fixtures/live/${system}.check.json`, `${JSON.stringify(body, null, 2)}\n`);
  } catch (e) {
    failed++;
    console.log(`✗ ${system.padEnd(10)} ${name}  ${Date.now() - t} ms  ${e instanceof Error ? e.message : e}`);
  }
}
for (const v of ["ANTHROPIC_API_KEY", "LEMMA_API_KEY", "LEMMA_PROJECT_ID", "ARGA_API_KEY", "ARGA_TWIN_RUN_ID", "UPSTASH_REDIS_REST_URL"])
  console.log(`${process.env[v] ? "✓" : "·"} env ${v}${process.env[v] ? "" : " (unset)"}`);
process.exit(failed ? 1 : 0);
