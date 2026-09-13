import { Arga } from "arga-sdk";
import * as gmail from "@/adapters/gmail";
import { sleep } from "@/adapters/logged-fetch";
import * as sf from "@/adapters/salesforce";
import * as slack from "@/adapters/slack";
import { idOf, stripe } from "@/adapters/stripe";
import { MERCHANT_EMAIL, type ScenarioDef } from "@/domain/scenarios";

// Stripe test payment methods that make Stripe (and, if it emulates them, the twin) open a dispute on the charge.
const DISPUTE_PM: Record<string, string> = {
  product_not_received: "pm_card_createDisputeProductNotReceived",
};

async function waitForDispute(chargeId: string) {
  for (let i = 0; i < 30; i++) {
    const res = await stripe().disputes.list({ charge: chargeId, limit: 1 });
    if (res.data[0]) return res.data[0];
    await sleep(1000);
  }
  throw new Error(`no dispute appeared for charge ${chargeId} after 30 s (does this Stripe backend support dispute test cards?)`);
}

export interface Seeded {
  disputeId: string;
  customerId: string;
  email: string;
  dueBy: number | null;
  notes: string[];
}

/** Seeds one scenario through the providers' normal APIs. Emails get a run tag so reruns never collide. */
export async function seedScenario(s: ScenarioDef): Promise<Seeded> {
  const st = stripe();
  const notes: string[] = [];
  const tag = Date.now().toString(36);
  const email = s.customer.email.replace("@", `+${tag}@`);
  const name = `${s.customer.firstName} ${s.customer.lastName}`;

  for (const k of ["disputes", "approvals", "risk"] as const) await slack.ensureChannel(slack.channelName(k));

  const customer = await st.customers.create({ email, name, metadata: { scenario: s.key } });
  const pm = async (token: string) => (await st.paymentMethods.attach(token, { customer: customer.id })).id;
  const charge = async (amount: number, description: string, token: string) => {
    const pi = await st.paymentIntents.create({
      amount,
      currency: "usd",
      customer: customer.id,
      payment_method: await pm(token),
      payment_method_types: ["card"],
      confirm: true,
      description,
      receipt_email: email,
    });
    return idOf(pi.latest_charge);
  };

  for (let i = 0; i < (s.stripe.priorLostDisputes ?? 0); i++) {
    const d = await waitForDispute(await charge(4500 + i * 500, `Prior order ${i + 1}`, "pm_card_createDispute"));
    await st.disputes.close(d.id); // accepted by the merchant: status lost
  }
  for (const o of s.stripe.otherCharges ?? []) await charge(o.amount, o.description, "pm_card_visa");
  if (s.stripe.activeSubscription) {
    const price = await st.prices.create({
      unit_amount: s.amount,
      currency: "usd",
      recurring: { interval: "month" },
      product_data: { name: s.product },
    });
    await st.subscriptions.create({ customer: customer.id, items: [{ price: price.id }], default_payment_method: await pm("pm_card_visa") });
  }
  const dispute = await waitForDispute(await charge(s.amount, s.product, DISPUTE_PM[s.reason] ?? "pm_card_createDispute"));
  const dueBy = dispute.evidence_details?.due_by ? dispute.evidence_details.due_by * 1000 : null;
  if (s.stripe.deadlinePassed && (dueBy === null || dueBy > Date.now()))
    notes.push("Stripe backend does not allow a past evidence deadline to be seeded");
  if (dispute.reason !== s.reason) notes.push(`dispute reason is ${dispute.reason}; scenario represents ${s.reason}`);

  if (s.salesforce.contact) {
    const { id } = await sf.createContact({
      firstName: s.customer.firstName,
      lastName: s.customer.lastName,
      email,
      description: s.salesforce.contactDescription,
    });
    for (const k of s.salesforce.cases) await sf.createCase({ contactId: id, subject: k.subject, description: k.description });
  }

  for (const m of s.gmail)
    await gmail.insertMessage({
      from: m.fromCustomer ? `${name} <${email}>` : MERCHANT_EMAIL,
      to: m.fromCustomer ? MERCHANT_EMAIL : email,
      subject: m.subject,
      body: m.body,
      date: new Date(Date.now() - m.daysAgo * 86400_000),
    });

  return { disputeId: dispute.id, customerId: customer.id, email, dueBy, notes };
}

/** Restore every twin in the Arga run to its provisioned baseline. */
export async function resetTwins() {
  const apiKey = process.env.ARGA_API_KEY;
  const runId = process.env.ARGA_TWIN_RUN_ID;
  if (!apiKey || !runId) throw new Error("ARGA_API_KEY and ARGA_TWIN_RUN_ID are required to reset twins");
  const arga = new Arga({ apiKey, ...(process.env.ARGA_API_URL ? { baseUrl: process.env.ARGA_API_URL } : {}) });
  const res = await arga.twins.reset(runId);
  slack.clearChannelCache();
  return res;
}
