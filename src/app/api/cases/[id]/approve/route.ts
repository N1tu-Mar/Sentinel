import { NextResponse } from "next/server";
import { z } from "zod";
import { errMsg } from "@/agent/idempotency";
import { decideApproval } from "@/agent/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ outcome: z.enum(["approved", "rejected"]), by: z.string().min(1).max(100) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const c = await decideApproval(id, parsed.data.outcome, parsed.data.by);
    return NextResponse.json({ case: c });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 409 });
  }
}
