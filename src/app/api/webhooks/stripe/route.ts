import { after, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/adapters/stripe";
import { ingestDispute } from "@/agent/cases";
import { errMsg } from "@/agent/idempotency";
import { runCase } from "@/agent/run";
import { getStore } from "@/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Optional path: charge.dispute.created → case (→ run if AUTO_RUN=true). Sync from Stripe remains the primary ingestion. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not configured" }, { status: 503 });
  const body = await req.text(); // signature is over the raw body
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch (e) {
    return NextResponse.json({ error: `invalid signature: ${errMsg(e)}` }, { status: 400 });
  }
  const store = getStore();
  if (!(await store.markEvent(event.id))) return NextResponse.json({ received: true, duplicate: true });

  if (event.type === "charge.dispute.created") {
    const d = event.data.object as Stripe.Dispute;
    if (!(await store.getCase(d.id))) await ingestDispute(d.id);
    if (process.env.AUTO_RUN === "true") after(() => runCase(d.id).then(() => undefined));
  }
  return NextResponse.json({ received: true });
}
