import Stripe from "stripe";
import { env, loggedFetch, requireEnv } from "./logged-fetch";

let client: Stripe | undefined;

/** Twin: STRIPE_API_BASE_URL (or Arga's STRIPE_TWIN_BASE_URL). Real Stripe test mode: leave both empty. */
export function stripe(): Stripe {
  if (client) return client;
  const base = env("STRIPE_API_BASE_URL", "STRIPE_TWIN_BASE_URL");
  const u = base ? new URL(base) : undefined;
  client = new Stripe(requireEnv("STRIPE_SECRET_KEY", "STRIPE_API_KEY"), {
    host: u?.hostname,
    port: u ? u.port || (u.protocol === "https:" ? 443 : 80) : undefined,
    protocol: u ? (u.protocol.replace(":", "") as "http" | "https") : undefined,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient((input, init) => loggedFetch("stripe", input, init)),
  });
  return client;
}

export const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? "");

export const getDispute = (id: string) => stripe().disputes.retrieve(id);
export const getCharge = (id: string) => stripe().charges.retrieve(id);
export const getCustomer = (id: string) => stripe().customers.retrieve(id);
export const getSubscription = (id: string) => stripe().subscriptions.retrieve(id);
export const listRefunds = (chargeId: string) => stripe().refunds.list({ charge: chargeId, limit: 100 });
export const listCustomerCharges = (customerId: string) => stripe().charges.list({ customer: customerId, limit: 100 });
export const listSubscriptions = (customerId: string) =>
  stripe().subscriptions.list({ customer: customerId, status: "all", limit: 100 });

export async function listDisputes(opts: { status?: string } = {}) {
  const res = await stripe().disputes.list({ limit: 100 });
  return res.data.filter((d) => !opts.status || d.status === opts.status);
}

/** Stripe's disputes.list has no customer filter: match disputes to this customer's charges. */
export async function listCustomerDisputes(customerId: string, sinceDays = 90) {
  const [charges, disputes] = await Promise.all([listCustomerCharges(customerId), stripe().disputes.list({ limit: 100 })]);
  const chargeIds = new Set(charges.data.map((c) => c.id));
  const since = Date.now() / 1000 - sinceDays * 86400;
  return disputes.data.filter((d) => chargeIds.has(idOf(d.charge)) && d.created >= since);
}

export const submitEvidence = (
  id: string,
  evidence: Stripe.DisputeUpdateParams.Evidence,
  opts: { idempotencyKey: string; submit: boolean },
) => stripe().disputes.update(id, { evidence, submit: opts.submit }, { idempotencyKey: opts.idempotencyKey });

export const acceptDispute = (id: string, opts: { idempotencyKey: string }) =>
  stripe().disputes.close(id, {}, { idempotencyKey: opts.idempotencyKey });

export const cancelSubscription = (id: string, opts: { idempotencyKey: string }) =>
  stripe().subscriptions.cancel(id, {}, { idempotencyKey: opts.idempotencyKey });
