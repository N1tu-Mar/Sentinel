import { NextResponse } from "next/server";
import { z } from "zod";
import { errMsg } from "@/agent/idempotency";
import { runCase } from "@/agent/run";
import { getStore } from "@/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  chaosMode: z.enum(["none", "drop_submit_once", "stripe_500_once", "slack_timeout_once"]).default("none"),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const existing = await getStore().getCase(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.status === "running") return NextResponse.json({ error: "already running" }, { status: 409 });
  try {
    const c = await runCase(id, { chaosMode: parsed.data.chaosMode });
    return NextResponse.json({ case: c });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}
