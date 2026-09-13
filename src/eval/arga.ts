import { Arga, type TwinProvisionStatus } from "arga-sdk";
import { sleep } from "@/adapters/logged-fetch";
import * as slack from "@/adapters/slack";

// Stripe runs on real Stripe test mode: the Stripe twin cannot create disputes (Kill Check #1, arga/README.md).
export const DEFAULT_TWINS = ["gmail", "slack", "salesforce"];

export function argaClient() {
  const apiKey = process.env.ARGA_API_KEY;
  if (!apiKey) throw new Error("ARGA_API_KEY is required");
  // arga-sdk defaults to app.argalabs.com, which serves the web app (HTML); the API lives on api.argalabs.com.
  return new Arga({ apiKey, baseUrl: process.env.ARGA_API_URL || "https://api.argalabs.com" });
}

async function waitReady(arga: Arga, runId: string): Promise<TwinProvisionStatus> {
  for (;;) {
    const s = await arga.twins.getStatus(runId);
    if (s.status === "ready") return s;
    if (["failed", "expired", "cancelled"].includes(s.status)) throw new Error(`twin run ${runId} ${s.status}: ${s.error ?? ""}`);
    await sleep(3000);
  }
}

/**
 * Provisions twins and returns the env they need. split=true puts each twin in its own run, which is what Arga's
 * Free plan allows (1 twin per run, 10-minute TTL; separate runs can be live at the same time).
 */
export async function provisionTwins(opts: { twins?: string[]; split?: boolean; ttlMinutes?: number; scenarioPrompt?: string } = {}) {
  const arga = argaClient();
  const twins = opts.twins ?? DEFAULT_TWINS;
  const groups = opts.split === false ? [twins] : twins.map((t) => [t]);
  const runIds = await Promise.all(
    groups.map(async (g) =>
      (
        await arga.twins.provision({
          twins: g,
          ttlMinutes: opts.ttlMinutes ?? 10,
          ...(opts.scenarioPrompt ? { scenarioPrompt: opts.scenarioPrompt, scenarioGenerationMode: "thorough" as const } : {}),
        })
      ).runId,
    ),
  );
  const statuses = await Promise.all(runIds.map((id) => waitReady(arga, id)));
  const env: Record<string, string> = { ARGA_TWIN_RUN_IDS: runIds.join(",") };
  const bases: Record<string, string> = {};
  for (const s of statuses)
    for (const [name, twin] of Object.entries(s.twins)) {
      Object.assign(env, twin.envVars);
      bases[name] = twin.baseUrl.replace(/\/$/, "");
    }
  if (bases.gmail && !env.GMAIL_API_BASE_URL) env.GMAIL_API_BASE_URL = bases.gmail;
  if (bases.slack && !env.SLACK_API_URL && !env.SLACK_TWIN_BASE_URL) env.SLACK_API_URL = `${bases.slack}/api`;
  if (bases.stripe && !env.STRIPE_API_BASE_URL && !env.STRIPE_TWIN_BASE_URL) env.STRIPE_API_BASE_URL = bases.stripe;
  const expiresAt = statuses.map((s) => s.expiresAt).filter(Boolean).sort()[0];
  return { env, runIds, bases, expiresAt };
}

/** Point this process's adapters at freshly provisioned twins. */
export function applyTwinEnv(env: Record<string, string>) {
  Object.assign(process.env, env);
  slack.clearChannelCache();
}

const runIds = () => (process.env.ARGA_TWIN_RUN_IDS || process.env.ARGA_TWIN_RUN_ID || "").split(",").filter(Boolean);

export const hasTwinRuns = () => runIds().length > 0;

/** Restore every twin run to its provisioned baseline. */
export async function resetTwins() {
  const ids = runIds();
  if (!ids.length) throw new Error("ARGA_TWIN_RUN_IDS (or ARGA_TWIN_RUN_ID) is required to reset twins");
  const arga = argaClient();
  const res = await Promise.all(ids.map((id) => arga.twins.reset(id)));
  slack.clearChannelCache();
  return res;
}
