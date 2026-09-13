import { freshState, handleSandbox, memoryStore, type SandboxState, type SandboxStore, type SandboxSystem } from "@/sandbox/server";
import { redisClient } from "@/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hosted sandbox: Salesforce, Gmail and Slack stand-ins served by the deployed app, state in Upstash Redis
// (serverless instances share nothing in memory). Requires SANDBOX_TOKEN as the bearer token when it is set.
const SYSTEMS: SandboxSystem[] = ["salesforce", "gmail", "slack"];

function store(): SandboxStore {
  const redis = redisClient();
  if (!redis) {
    const g = globalThis as unknown as { __sentinelSandbox?: SandboxStore };
    return (g.__sentinelSandbox ??= memoryStore());
  }
  return {
    load: async <K extends SandboxSystem>(system: K) => (await redis.get<SandboxState[K]>(`sandbox:${system}`)) ?? freshState[system](),
    save: async (system, state) => {
      await redis.set(`sandbox:${system}`, state);
    },
    reset: async () => {
      await redis.del(...SYSTEMS.map((s) => `sandbox:${s}`));
    },
  };
}

async function handler(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(req.url);
  const r = await handleSandbox(
    store(),
    {
      method: req.method,
      pathname: `/${path.join("/")}`,
      url,
      authorization: req.headers.get("authorization"),
      contentType: req.headers.get("content-type") ?? "",
      body: req.method === "GET" || req.method === "HEAD" ? "" : await req.text(),
    },
    process.env.SANDBOX_TOKEN,
  );
  return r.body === undefined ? new Response(null, { status: r.status }) : Response.json(r.body, { status: r.status });
}

export { handler as GET, handler as PATCH, handler as POST };
