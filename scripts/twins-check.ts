import "./_env";
import * as gmail from "@/adapters/gmail";
import * as sf from "@/adapters/salesforce";
import * as slack from "@/adapters/slack";
import { stripe } from "@/adapters/stripe";

const checks: [string, () => Promise<unknown>][] = [
  ["stripe   disputes.list", () => stripe().disputes.list({ limit: 1 })],
  ["salesforce GET /services/data", async () => {
    const res = await sf.listVersions();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }],
  ["gmail    users/me/profile", () => gmail.getProfile()],
  ["slack    auth.test", () => slack.authTest()],
];

let failed = 0;
for (const [name, fn] of checks) {
  const t = Date.now();
  try {
    await fn();
    console.log(`✓ ${name}  ${Date.now() - t} ms`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}  ${Date.now() - t} ms  ${e instanceof Error ? e.message : e}`);
  }
}
for (const v of ["ANTHROPIC_API_KEY", "LEMMA_API_KEY", "LEMMA_PROJECT_ID", "ARGA_API_KEY", "ARGA_TWIN_RUN_ID", "UPSTASH_REDIS_REST_URL"])
  console.log(`${process.env[v] ? "✓" : "·"} env ${v}${process.env[v] ? "" : " (unset)"}`);
process.exit(failed ? 1 : 0);
