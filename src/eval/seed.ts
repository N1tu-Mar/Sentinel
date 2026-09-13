import { Arga } from "arga-sdk";
import type Stripe from "stripe";
import * as gmail from "@/adapters/gmail";
import { sleep } from "@/adapters/logged-fetch";
import * as sf from "@/adapters/salesforce";
import * as slack from "@/adapters/slack";
import { idOf, stripe } from "@/adapters/stripe";
import { errMsg } from "@/agent/idempotency";
import { MERCHANT, type Scenario } from "@/domain/scenarios";

// How the Stripe twin creates disputes is undocumented (Kill Check #1). Try, per reason, the Stripe test
// payment methods and then the raw dispute test cards; record which one worked.
const DISPUTE_METHODS: Record<string, string[]> = {
  product_not_received: ["pm_card_createDisputeProductNotReceived", "4000000000002685", "pm_card_createDispute"],
  fraudulent: ["pm_card_createDispute", "4000000000000259"],
};
const DEFAULT_METHODS = ["pm_card_createDispute", "4000000000000259"];

export interface Seeded {
  disputeId: string;
  customerId: string;
  email: string;
  dueBy: number | null;
  notes: string[];
}

async function waitForDispute(chargeId: string, seconds = 15) {
  for (let i = 0; i < seconds; i++) {
    const res = await stripe().disputes.list({ charge: chargeId, limit: 1 });
    if (res.data[0]) return res.data[0];
    await sleep(1000);
  }
  return null;
}

const noNulls = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? undefined])) as { [K in keyof T]: Exclude<T[K], null> | undefined };

/** Seeds one fixture through the providers' normal APIs. The customer email gets a run tag so reruns never collide. */
export async function seedScenario(s: Scenario): Promise<Seeded> {
  const f = s.fixture.seed;
  const st = stripe();
  const notes: string[] = [];
  const tag = Date.now().toString(36);
  const email = s.email.replace("@", `+${tag}@`);
  const retag = (text: string) => text.replaceAll(s.email, email);

  for (const k of ["disputes", "approvals", "risk"] as const) await slack.ensureChannel(slack.channelName(k));

  const customer = await st.customers.create({ email, name: f.stripe.customer.name, metadata: { scenario: s.key } });

  const paymentMethod = async (method: string) => {
    const pm = method.startsWith("pm_")
      ? method
      : (await st.paymentMethods.create({ type: "card", card: { number: method, exp_month: 12, exp_year: 2030, cvc: "123" } })).id;
    return (await st.paymentMethods.attach(pm, { customer: customer.id })).id;
  };

  async function disputedCharge(amount: number, description: string, reason: string, extra: Partial<Stripe.PaymentIntentCreateParams> = {}) {
    for (const method of DISPUTE_METHODS[reason] ?? DEFAULT_METHODS) {
      try {
        const pi = await st.paymentIntents.create({
          amount,
          currency: "usd",
          customer: customer.id,
          payment_method: await paymentMethod(method),
          payment_method_types: ["card"],
          confirm: true,
          description,
          receipt_email: email,
          ...extra,
        });
        const d = await waitForDispute(idOf(pi.latest_charge));
        if (d) {
          notes.push(`dispute via ${method}`);
          return d;
        }
        notes.push(`${method}: no dispute appeared`);
      } catch (e) {
        notes.push(`${method}: ${errMsg(e)}`);
      }
    }
    throw new Error(`could not create a dispute on this Stripe backend (${notes.join("; ")})`);
  }

  for (const prior of f.stripe.prior_disputes.data) {
    const d = await disputedCharge(prior.amount, `Earlier order (${prior.id})`, prior.reason);
    if (prior.status === "lost") await st.disputes.close(d.id);
  }

  const ch = f.stripe.charge;
  const dispute = await disputedCharge(ch.amount, ch.description, f.stripe.dispute.reason, {
    metadata: ch.metadata,
    shipping: ch.shipping
      ? { name: ch.shipping.name, carrier: ch.shipping.carrier ?? undefined, tracking_number: ch.shipping.tracking_number ?? undefined, address: noNulls(ch.shipping.address) }
      : undefined,
  });
  for (const r of f.stripe.refunds.data) await st.refunds.create({ charge: idOf(dispute.charge), amount: r.amount });

  const dueBy = dispute.evidence_details?.due_by ? dispute.evidence_details.due_by * 1000 : null;
  if (f.stripe.dispute.evidence_details.past_due && dueBy !== null && dueBy > Date.now())
    notes.push("this Stripe backend cannot seed a past evidence deadline");
  if (dispute.reason !== f.stripe.dispute.reason) notes.push(`dispute reason is ${dispute.reason}; fixture has ${f.stripe.dispute.reason}`);

  const contact = f.salesforce.contact;
  if (contact) {
    const { id } = await sf.createContact({ firstName: contact.FirstName, lastName: contact.LastName, email, description: contact.Description });
    for (const k of f.salesforce.cases?.records ?? []) await sf.createCase({ contactId: id, subject: k.Subject, description: k.Description ?? "" });
  }

  for (const thread of f.gmail.threads) {
    let threadId: string | undefined;
    for (const raw of thread.messages) {
      const m = gmail.decodeMessage(raw);
      const res = await gmail.insertMessage({
        from: retag(m.from),
        to: retag(m.to),
        subject: m.subject,
        body: retag(m.text),
        date: new Date(m.date || Date.now()),
        threadId,
      });
      threadId ??= res.threadId;
    }
  }

  return { disputeId: dispute.id, customerId: customer.id, email, dueBy, notes };
}

/** Prompt-seeded twins (scenario_prompt at provision time): find the scenario's dispute by customer email. */
export async function locateScenario(s: Scenario): Promise<Seeded> {
  const st = stripe();
  const found: Stripe.Dispute[] = [];
  let customerId = "";
  for (const cust of (await st.customers.list({ email: s.email, limit: 10 })).data) {
    customerId ||= cust.id;
    for (const ch of (await st.charges.list({ customer: cust.id, limit: 100 })).data)
      found.push(...(await st.disputes.list({ charge: ch.id, limit: 10 })).data);
  }
  const dispute = found.sort((a, b) => b.created - a.created)[0];
  if (!dispute) throw new Error(`no dispute found for ${s.email}; was the twin provisioned with this scenario's prompt?`);
  const notes = found.length > 1 ? [`${found.length} disputes for ${s.email}; using the newest`] : [];
  return { disputeId: dispute.id, customerId, email: s.email, dueBy: dispute.evidence_details?.due_by ? dispute.evidence_details.due_by * 1000 : null, notes };
}

export function argaClient() {
  const apiKey = process.env.ARGA_API_KEY;
  if (!apiKey) throw new Error("ARGA_API_KEY is required");
  return new Arga({ apiKey, ...(process.env.ARGA_API_URL ? { baseUrl: process.env.ARGA_API_URL } : {}) });
}

/** Restore every twin in the Arga run to its provisioned baseline. */
export async function resetTwins() {
  const runId = process.env.ARGA_TWIN_RUN_ID;
  if (!runId) throw new Error("ARGA_TWIN_RUN_ID is required to reset twins");
  const res = await argaClient().twins.reset(runId);
  slack.clearChannelCache();
  return res;
}

export { MERCHANT };
