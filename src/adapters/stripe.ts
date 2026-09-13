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
    // The SDK retries 409/429 lock_timeout and network errors when Stripe says Stripe-Should-Retry, adding its own
    // idempotency key to POSTs (our action writes pass explicit keys). 5xx retries also happen in loggedFetch.
    maxNetworkRetries: 2,
    httpClient: Stripe.createFetchHttpClient((input, init) => loggedFetch("stripe", input, init)),
  });
  return client;
}

export const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : (x?.id ?? ""));

export const getDispute = (id: string) => stripe().disputes.retrieve(id);
export const getCharge = (id: string) => stripe().charges.retrieve(id);
export const getCustomer = (id: string) => stripe().customers.retrieve(id);
export const getSubscription = (id: string) => stripe().subscriptions.retrieve(id);
export const listRefunds = (chargeId: string) => stripe().refunds.list({ charge: chargeId, limit: 100 });
export const listCustomerCharges = (customerId: string) => stripe().charges.list({ customer: customerId, limit: 100 });
export const listSubscriptions = (customerId: string) =>
  stripe().subscriptions.list({ customer: customerId, status: "all", limit: 100 });

/** Paginates /v1/disputes (charge expanded so callers can join on charge.customer). */
export async function listDisputes(opts: { statuses?: readonly string[]; createdGte?: number } = {}): Promise<Stripe.Dispute[]> {
  const out: Stripe.Dispute[] = [];
  const params: Stripe.DisputeListParams = { limit: 100, expand: ["data.charge"] };
  if (opts.createdGte) params.created = { gte: opts.createdGte };
  for await (const d of stripe().disputes.list(params)) {
    if (!opts.statuses || opts.statuses.includes(d.status)) out.push(d);
    if (out.length >= 1000) break; // ponytail: hard cap, page by created window if a merchant ever has more
  }
  return out;
}

/** No customer filter on /v1/disputes: list the window, join on charge.customer, exclude the current dispute. */
export async function listCustomerDisputes(customerId: string, sinceDays: number, excludeId?: string) {
  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const out: Stripe.Dispute[] = [];
  for (const d of await listDisputes({ createdGte: since })) {
    if (d.id === excludeId) continue;
    const customer = typeof d.charge === "string" ? (await getCharge(d.charge)).customer : d.charge?.customer;
    if (idOf(customer) === customerId) out.push(d);
  }
  return out;
}

export const submitEvidence = (
  id: string,
  evidence: Stripe.DisputeUpdateParams.Evidence,
  opts: { idempotencyKey: string; submit: boolean },
) => stripe().disputes.update(id, { evidence, submit: opts.submit }, { idempotencyKey: opts.idempotencyKey });

/** Accepting a dispute. Irreversible: needs_response → lost. */
export const closeDispute = (id: string, opts: { idempotencyKey: string }) =>
  stripe().disputes.close(id, {}, { idempotencyKey: opts.idempotencyKey });

export const cancelSubscription = (id: string, opts: { idempotencyKey: string }) =>
  stripe().subscriptions.cancel(id, {}, { idempotencyKey: opts.idempotencyKey });
