import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestDispute, syncFromStripe } from "@/agent/cases";
import { errMsg } from "@/agent/idempotency";
import { SCENARIOS, scenarioByKey } from "@/domain/scenarios";
import { seedScenario } from "@/eval/seed";
import { getStore } from "@/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const cases = await getStore().listCases();
  return NextResponse.json({ cases: cases.sort((a, b) => b.createdAt - a.createdAt) });
}

const Body = z.discriminatedUnion("source", [
  z.object({ source: z.literal("stripe") }),
  z.object({ source: z.literal("scenario"), scenario: z.enum(SCENARIOS.map((s) => s.key) as [string, ...string[]]) }),
]);

/** Sync needs_response disputes from Stripe, or seed a scenario into the providers and ingest its dispute. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    if (parsed.data.source === "stripe") return NextResponse.json(await syncFromStripe());
    const s = scenarioByKey(parsed.data.scenario)!;
    const seeded = await seedScenario(s);
    const c = await ingestDispute(seeded.disputeId, s.key);
    return NextResponse.json({ created: [c.id], notes: seeded.notes });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 502 });
  }
}
