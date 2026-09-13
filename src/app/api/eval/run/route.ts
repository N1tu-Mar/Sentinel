import { NextResponse } from "next/server";
import { z } from "zod";
import { SCENARIOS } from "@/domain/scenarios";
import { runScenario } from "@/eval/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ scenario: z.enum(SCENARIOS.map((s) => s.key) as [string, ...string[]]) });

/** One scenario per request, so each stays under the function time limit. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  return NextResponse.json({ result: await runScenario(parsed.data.scenario) });
}
