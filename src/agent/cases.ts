import type Stripe from "stripe";
import * as stripeApi from "@/adapters/stripe";
import type { DisputeCase, ProviderEnvironment } from "@/domain/types";
import { getStore } from "@/store";
import { OPEN_STATUSES } from "./policy";

export const providerEnvironment = (): ProviderEnvironment => (process.env.SANDBOX_URL ? "local-sandbox" : "arga-twins");

export async function caseFromDispute(d: Stripe.Dispute, scenario?: string): Promise<DisputeCase> {
  const chargeId = stripeApi.idOf(d.charge);
  const charge = await stripeApi.getCharge(chargeId);
  const now = Date.now();
  return {
    id: d.id,
    status: "new",
    scenario,
    environment: providerEnvironment(),
    chaosMode: "none",
    dispute: {
      id: d.id,
      chargeId,
      customerId: stripeApi.idOf(charge.customer),
      amount: d.amount,
      currency: d.currency,
      reason: d.reason,
      status: d.status,
      dueBy: d.evidence_details?.due_by ? d.evidence_details.due_by * 1000 : null,
      createdAt: d.created * 1000,
    },
    customer: charge.billing_details?.email
      ? { email: charge.billing_details.email, name: charge.billing_details.name ?? "", stripeId: stripeApi.idOf(charge.customer) }
      : undefined,
    evidence: [],
    actions: [],
    providerCalls: 0,
    forbiddenEffects: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Customer name/email for the queue, read once at ingestion. */
async function withCustomer(c: DisputeCase): Promise<DisputeCase> {
  if (c.customer || !c.dispute.customerId) return c;
  const cust = await stripeApi.getCustomer(c.dispute.customerId);
  if (!("deleted" in cust && cust.deleted)) {
    const x = cust as Stripe.Customer;
    c.customer = { email: x.email ?? "", name: x.name ?? "", stripeId: x.id };
  }
  return c;
}

export async function ingestDispute(disputeId: string, scenario?: string): Promise<DisputeCase> {
  const store = getStore();
  const c = await withCustomer(await caseFromDispute(await stripeApi.getDispute(disputeId), scenario));
  await store.putCase(c);
  return c;
}

/** Primary ingestion path: pull every needs_response dispute not already in the store. */
export async function syncFromStripe(): Promise<{ created: string[] }> {
  const store = getStore();
  const created: string[] = [];
  for (const d of await stripeApi.listDisputes({ statuses: OPEN_STATUSES })) {
    if (await store.getCase(d.id)) continue;
    await store.putCase(await withCustomer(await caseFromDispute(d)));
    created.push(d.id);
  }
  return { created };
}
