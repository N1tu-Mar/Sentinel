import { tool } from "ai";
import type Stripe from "stripe";
import { z } from "zod";
import * as gmail from "@/adapters/gmail";
import { HttpError } from "@/adapters/logged-fetch";
import * as sf from "@/adapters/salesforce";
import * as slack from "@/adapters/slack";
import * as stripeApi from "@/adapters/stripe";
import type { ActionResult, EvidenceItem } from "@/domain/types";
import { CHAOS_TEXT } from "./chaos";
import type { RunContext } from "./context";
import { errMsg, runAction } from "./idempotency";
import { POLICY, requiresApproval } from "./policy";
import { caseUrl, RISK_MARKER, SUBJECT } from "./verify";

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);
export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

const safe =
  <I, O>(fn: (input: I) => Promise<O>) =>
  async (input: I) => {
    try {
      return await fn(input);
    } catch (e) {
      return { ok: false, verified: false, error: errMsg(e) };
    }
  };

/** Slack post through the ledger: look for this case's message first, post, read back. */
export function postToSlack(ctx: RunContext, kind: "disputes" | "risk" | "approvals", text: string): Promise<ActionResult> {
  const { c } = ctx;
  const channel = slack.channelName(kind);
  const marker = `/cases/${c.id}`;
  return runAction(ctx, {
    action: "slack.post",
    target: kind,
    guard: kind === "approvals" ? "request_approval" : undefined,
    expected: `exactly 1 message for this case in #${channel}`,
    checkBeforeWrite: true,
    perform: async () => {
      const body = `${text}\nCase: ${caseUrl(c.id)}`;
      if (ctx.chaos.fire("slack.post")) {
        await ctx.emit({ type: "chaos", mode: ctx.chaos.mode, text: CHAOS_TEXT.slack_timeout_once });
        slack.post(channel, body).catch(() => {}); // the request still goes out; we stop waiting for it
        await new Promise((r) => setTimeout(r, 100));
        throw new Error("Slack chat.postMessage timed out after 100 ms (injected)");
      }
      await slack.post(channel, body);
    },
    verify: async () => {
      const n = (await slack.findMessages(channel, marker)).length;
      return { passed: n === 1, observed: `${n} message(s) for this case in #${channel}` };
    },
  });
}

export function buildTools(ctx: RunContext) {
  const { c } = ctx;

  async function addEvidence(e: Omit<EvidenceItem, "id" | "foundAt">) {
    const item: EvidenceItem = { ...e, id: `ev_${c.evidence.length + 1}`, foundAt: Date.now() };
    c.evidence.push(item);
    await ctx.emit({ type: "evidence", item });
    await ctx.save();
    return item;
  }

  async function syncDispute() {
    const d = await stripeApi.getDispute(c.id);
    c.dispute.status = d.status;
    c.dispute.dueBy = d.evidence_details?.due_by ? d.evidence_details.due_by * 1000 : null;
    return d;
  }
  const liveDispute = async () => {
    await syncDispute();
    return { disputeStatus: c.dispute.status, dueBy: c.dispute.dueBy };
  };

  async function readbackDispute() {
    if (ctx.chaos.fire("stripe.get_dispute_readback")) {
      await ctx.emit({ type: "chaos", mode: ctx.chaos.mode, text: CHAOS_TEXT.stripe_500_once });
      throw new HttpError(500, "stripe 500 on GET /v1/disputes (injected)");
    }
    return stripeApi.getDispute(c.id);
  }

  const contactId = () => {
    if (!c.customer?.sfContactId) throw new Error("No Salesforce contact on this case; call salesforce_lookup_customer first");
    return c.customer.sfContactId;
  };

  const sfCase = (target: string, subject: string, description: string, priority = "Medium") => {
    const id = contactId();
    return runAction(ctx, {
      action: "salesforce.create_case",
      target,
      expected: `exactly 1 Salesforce case "${subject}"`,
      checkBeforeWrite: true,
      perform: async () => {
        await sf.createCase({ contactId: id, subject, description, priority });
      },
      verify: async () => {
        const n = (await sf.findCases(id, subject)).length;
        return { passed: n === 1, observed: `${n} case(s) "${subject}"` };
      },
    });
  };

  function buildEvidence(rebuttal: string, ids: string[]): Stripe.DisputeUpdateParams.Evidence {
    const items = c.evidence.filter((e) => ids.includes(e.id));
    const text = (e: EvidenceItem) => {
      const r = e.raw as { text?: string; date?: string; from?: string; Description?: string } | undefined;
      return r?.text ? `${r.date} from ${r.from}: ${r.text}` : (r?.Description ?? e.summary);
    };
    const delivery = items.filter((e) => e.kind === "delivery_proof").map(text).join("\n");
    const comms = items.filter((e) => e.source === "gmail").map(text).join("\n\n");
    const charge = ctx.seen.get(c.dispute.chargeId) as Stripe.Charge | undefined;
    return {
      customer_name: c.customer?.name || undefined,
      customer_email_address: c.customer?.email || undefined,
      product_description: charge?.description ?? undefined,
      shipping_carrier: delivery.match(/\b(UPS|FedEx|USPS|DHL)\b/i)?.[0],
      shipping_tracking_number: delivery.match(/\b(1Z[0-9A-Z]{16}|\d{12,22})\b/)?.[0],
      shipping_date: delivery.match(/shipped (\d{4}-\d{2}-\d{2})/i)?.[1],
      customer_communication: comms || undefined,
      uncategorized_text: rebuttal,
    };
  }

  return {
    // ---------- read tools ----------
    stripe_get_dispute: tool({
      description: "Read the dispute under investigation from Stripe: status, reason, amount, evidence deadline.",
      inputSchema: z.object({}),
      execute: safe(async () => {
        const d = await syncDispute();
        ctx.seen.set(d.id, d);
        return {
          id: d.id,
          status: d.status,
          reason: d.reason,
          amount: d.amount,
          currency: d.currency,
          charge: stripeApi.idOf(d.charge),
          created: iso(d.created),
          due_by: iso(d.evidence_details?.due_by),
          is_past_due: c.dispute.dueBy !== null && c.dispute.dueBy <= Date.now(),
          submission_count: d.evidence_details?.submission_count ?? 0,
        };
      }),
    }),

    stripe_get_charge_and_customer: tool({
      description: "Read the disputed charge (product description, amount, date, card) and the Stripe customer.",
      inputSchema: z.object({}),
      execute: safe(async () => {
        const charge = await stripeApi.getCharge(c.dispute.chargeId);
        ctx.seen.set(charge.id, charge);
        const customer = await stripeApi.getCustomer(c.dispute.customerId || stripeApi.idOf(charge.customer));
        const cust = "deleted" in customer && customer.deleted ? null : (customer as Stripe.Customer);
        c.customer = {
          email: cust?.email ?? "",
          name: cust?.name ?? "",
          stripeId: customer.id,
          sfContactId: c.customer?.sfContactId,
        };
        await ctx.save();
        const card = charge.payment_method_details?.card;
        return {
          charge: {
            id: charge.id,
            amount: charge.amount,
            currency: charge.currency,
            created: iso(charge.created),
            description: charge.description,
            status: charge.status,
            refunded: charge.refunded,
            amount_refunded: charge.amount_refunded,
            card: card ? `${card.brand} ****${card.last4}` : null,
            shipping: charge.shipping ?? null,
          },
          customer: cust
            ? { id: cust.id, email: cust.email, name: cust.name, created: iso(cust.created) }
            : { id: customer.id, deleted: true },
        };
      }),
    }),

    stripe_customer_history: tool({
      description: "The customer's prior disputes (with outcomes), charges, refunds and subscriptions in Stripe.",
      inputSchema: z.object({ days: z.number().int().positive().max(365).optional() }),
      execute: safe(async ({ days }) => {
        const window = days ?? POLICY.repeatDisputerWindowDays;
        const customerId = c.dispute.customerId;
        const [disputes, charges, subs] = await Promise.all([
          stripeApi.listCustomerDisputes(customerId, window),
          stripeApi.listCustomerCharges(customerId),
          stripeApi.listSubscriptions(customerId),
        ]);
        const prior = disputes.filter((d) => d.id !== c.id);
        for (const x of [...charges.data, ...prior, ...subs.data]) ctx.seen.set(x.id, x);
        return {
          window_days: window,
          prior_disputes: {
            count: prior.length,
            items: prior.map((d) => ({ id: d.id, status: d.status, reason: d.reason, amount: d.amount, created: iso(d.created) })),
          },
          charges: charges.data.map((ch) => ({
            id: ch.id,
            amount: ch.amount,
            description: ch.description,
            created: iso(ch.created),
            refunded: ch.refunded,
            amount_refunded: ch.amount_refunded,
            disputed: ch.disputed,
          })),
          subscriptions: subs.data.map((s) => ({ id: s.id, status: s.status, created: iso(s.created), canceled_at: iso(s.canceled_at) })),
        };
      }),
    }),

    salesforce_lookup_customer: tool({
      description:
        "Find the customer's Salesforce contact by email, with their cases. Shipping/delivery notes in case descriptions are recorded as evidence automatically.",
      inputSchema: z.object({ email: z.string() }),
      execute: safe(async ({ email }) => {
        const contact = await sf.findContactByEmail(email);
        if (!contact) return { found: false, note: `No Salesforce contact with email ${email}` };
        c.customer = {
          email: c.customer?.email || email,
          name: c.customer?.name || contact.Name,
          stripeId: c.customer?.stripeId ?? c.dispute.customerId,
          sfContactId: contact.Id,
        };
        ctx.seen.set(contact.Id, contact);
        const cases = await sf.listCasesForContact(contact.Id);
        const recorded: string[] = [];
        for (const k of cases) {
          ctx.seen.set(k.Id, k);
          const ours = k.Subject === SUBJECT.risk || /^(Evidence needed|Dispute )/.test(k.Subject ?? "");
          const text = k.Description ?? "";
          const already = c.evidence.some((e) => (e.raw as { Id?: string })?.Id === k.Id);
          if (!ours && !already && /deliver|shipped|tracking|signed|signature/i.test(text)) {
            const item = await addEvidence({
              source: "salesforce",
              kind: "delivery_proof",
              summary: `${k.Subject}: ${text}`.slice(0, 240),
              raw: k,
              strength: /signed|signature/i.test(text) ? "strong" : "moderate",
            });
            recorded.push(item.id);
          }
        }
        await ctx.save();
        return {
          found: true,
          contact: { id: contact.Id, name: contact.Name, email: contact.Email, description: contact.Description, created: contact.CreatedDate },
          cases: cases.map((k) => ({ id: k.Id, subject: k.Subject, description: k.Description, status: k.Status, created: k.CreatedDate })),
          evidence_recorded: recorded,
        };
      }),
    }),

    gmail_search: tool({
      description:
        "Search the merchant mailbox with Gmail query syntax (e.g. from:x@example.com). Returns decoded messages. Call record_evidence for anything relevant, with ref = the message id.",
      inputSchema: z.object({ query: z.string(), maxResults: z.number().int().min(1).max(10).optional() }),
      execute: safe(async ({ query, maxResults }) => {
        const messages = await gmail.searchMessages(query, maxResults ?? 10);
        for (const m of messages) ctx.seen.set(m.id, m);
        return { count: messages.length, messages };
      }),
    }),

    record_evidence: tool({
      description:
        "Record evidence you found so it can be cited. ref must be the id of a record a tool returned in this run (Gmail message id, Stripe charge/dispute/subscription id, Salesforce case id).",
      inputSchema: z.object({
        source: z.enum(["stripe", "salesforce", "gmail"]),
        kind: z.enum(["delivery_proof", "customer_communication", "dispute_history", "cancellation_request", "order_record", "other"]),
        summary: z.string().max(300),
        strength: z.enum(["strong", "moderate", "weak"]),
        ref: z.string(),
      }),
      execute: safe(async ({ ref, ...e }) => {
        const raw = ctx.seen.get(ref);
        if (!raw) return { ok: false, error: `ref ${ref} was not returned by any tool in this run; cite only records you have read` };
        const item = await addEvidence({ ...e, raw });
        return { ok: true, id: item.id };
      }),
    }),

    // ---------- decision ----------
    record_decision: tool({
      description: "Record exactly one branch decision, citing evidence ids. Must be called before any action tool.",
      inputSchema: z.object({
        branch: z.enum(["FIGHT", "FIGHT_AND_FLAG", "ACCEPT", "ASK_HUMAN", "EXPIRED_OR_BLOCKED"]),
        confidence: z.number().min(0).max(1),
        rationale: z.string(),
        evidenceIds: z.array(z.string()),
        plannedActions: z.array(z.string()),
      }),
      execute: safe(async (input) => {
        if (c.decision) return { ok: false, error: `decision already recorded (${c.decision.branch})` };
        const unknown = input.evidenceIds.filter((id) => !c.evidence.some((e) => e.id === id));
        if (unknown.length) return { ok: false, error: `unknown evidence ids: ${unknown.join(", ")}` };
        c.decision = { ...input, requiresApproval: requiresApproval(input.branch, c.dispute.amount), decidedAt: Date.now() };
        await ctx.emit({ type: "decision", decision: c.decision });
        await ctx.save();
        return {
          ok: true,
          requiresApproval: c.decision.requiresApproval,
          note: c.decision.requiresApproval
            ? `Accepting ${money(c.dispute.amount)} is over ${money(POLICY.acceptApprovalThresholdCents)}: call request_approval and stop.`
            : undefined,
        };
      }),
    }),

    // ---------- actions ----------
    stripe_submit_evidence: tool({
      description: "Submit dispute evidence to Stripe (FIGHT branches). The tool reads the dispute back and reports verified.",
      inputSchema: z.object({ rebuttal: z.string(), includeEvidenceIds: z.array(z.string()) }),
      execute: safe(async ({ rebuttal, includeEvidenceIds }) =>
        runAction(ctx, {
          action: "stripe.submit_evidence",
          expected: "status under_review with evidence populated",
          live: liveDispute,
          perform: async (_n, idempotencyKey) => {
            const submit = !ctx.chaos.fire("stripe.submit_evidence");
            if (!submit) await ctx.emit({ type: "chaos", mode: ctx.chaos.mode, text: CHAOS_TEXT.drop_submit_once });
            await stripeApi.submitEvidence(c.id, buildEvidence(rebuttal, includeEvidenceIds), { idempotencyKey, submit });
          },
          verify: async () => {
            const d = await readbackDispute();
            const populated = !!(d.evidence?.customer_communication || d.evidence?.uncategorized_text);
            return {
              passed: d.status === "under_review" && populated,
              observed: `dispute status = ${d.status}, evidence ${populated ? "populated" : "empty"}`,
            };
          },
        }),
      ),
    }),

    stripe_accept_dispute: tool({
      description: "Accept (close) the dispute in Stripe. ACCEPT branch only; over $200 requires approval first.",
      inputSchema: z.object({}),
      execute: safe(async () =>
        runAction(ctx, {
          action: "stripe.accept_dispute",
          expected: "status lost",
          live: liveDispute,
          perform: async (_n, idempotencyKey) => {
            await stripeApi.acceptDispute(c.id, { idempotencyKey });
          },
          verify: async () => {
            const d = await readbackDispute();
            return { passed: d.status === "lost", observed: `dispute status = ${d.status}` };
          },
        }),
      ),
    }),

    stripe_cancel_subscription: tool({
      description: "Cancel the customer's still-active subscription (ACCEPT branch).",
      inputSchema: z.object({ subscriptionId: z.string() }),
      execute: safe(async ({ subscriptionId }) =>
        runAction(ctx, {
          action: "stripe.cancel_subscription",
          target: subscriptionId,
          expected: "subscription status canceled",
          live: async () => {
            const s = await stripeApi.getSubscription(subscriptionId);
            return { subscription: { customerId: stripeApi.idOf(s.customer), status: s.status } };
          },
          perform: async (_n, idempotencyKey) => {
            await stripeApi.cancelSubscription(subscriptionId, { idempotencyKey });
          },
          verify: async () => {
            const s = await stripeApi.getSubscription(subscriptionId);
            return { passed: s.status === "canceled", observed: `subscription status = ${s.status}` };
          },
        }),
      ),
    }),

    salesforce_create_case: tool({
      description: "Open a follow-up case on the customer's Salesforce contact (e.g. after accepting a dispute).",
      inputSchema: z.object({ subject: z.string(), description: z.string(), priority: z.enum(["Low", "Medium", "High"]) }),
      execute: safe(async ({ subject, description, priority }) =>
        sfCase("follow_up", SUBJECT.followUp(c.id, subject), description, priority),
      ),
    }),

    salesforce_flag_repeat_disputer: tool({
      description: "Flag the Salesforce contact as a repeat disputer and open the risk case (FIGHT_AND_FLAG only).",
      inputSchema: z.object({ note: z.string() }),
      execute: safe(async ({ note }) => {
        const id = contactId();
        return runAction(ctx, {
          action: "salesforce.flag_contact",
          expected: `contact Description contains ${RISK_MARKER} and exactly 1 "${SUBJECT.risk}" case`,
          checkBeforeWrite: true,
          live: async () => ({
            priorDisputes: (await stripeApi.listCustomerDisputes(c.dispute.customerId, POLICY.repeatDisputerWindowDays)).filter(
              (d) => d.id !== c.id,
            ).length,
          }),
          perform: async () => {
            const contact = await sf.getContact(id);
            if (!contact.Description?.includes(RISK_MARKER))
              await sf.updateContact(id, {
                Description: `${contact.Description ?? ""}\n${RISK_MARKER} repeat disputer flagged ${new Date().toISOString()}: ${note}`.trim(),
              });
            if ((await sf.findCases(id, SUBJECT.risk)).length === 0)
              await sf.createCase({ contactId: id, subject: SUBJECT.risk, description: `Dispute ${c.id}: ${note}`, priority: "High" });
          },
          verify: async () => {
            const [contact, cases] = await Promise.all([sf.getContact(id), sf.findCases(id, SUBJECT.risk)]);
            const flagged = !!contact.Description?.includes(RISK_MARKER);
            return { passed: flagged && cases.length === 1, observed: `contact ${flagged ? "flagged" : "not flagged"}, ${cases.length} risk case(s)` };
          },
        });
      }),
    }),

    slack_post_summary: tool({
      description: "Post a case summary to Slack: channel 'disputes' for every case, 'risk' for repeat disputers.",
      inputSchema: z.object({ channel: z.enum(["disputes", "risk"]), text: z.string() }),
      execute: safe(async ({ channel, text }) => postToSlack(ctx, channel, text)),
    }),

    request_approval: tool({
      description: "Ask a human to approve an ACCEPT over the threshold. Posts to #dispute-approvals. The run stops after this call.",
      inputSchema: z.object({ reason: z.string() }),
      execute: safe(async ({ reason }) => {
        if (c.approval?.outcome) return { ok: false, error: `approval already ${c.approval.outcome}` };
        const r = await postToSlack(
          ctx,
          "approvals",
          `Needs approval: accept ${money(c.dispute.amount)} dispute ${c.id}. ${reason}\nRationale: ${c.decision?.rationale ?? ""}`,
        );
        if (r.verified) {
          c.approval = { requiredFor: "ACCEPT", requestedAt: Date.now() };
          ctx.halted = true;
          await ctx.emit({ type: "approval_requested" });
          await ctx.save();
        }
        return { ...r, halted: ctx.halted };
      }),
    }),

    escalate_to_human: tool({
      description:
        "Hand the case to a human: opens a Salesforce 'Evidence needed' case and posts to #disputes. Use for ASK_HUMAN, and when an action fails verification twice.",
      inputSchema: z.object({ reason: z.string(), whatIsMissing: z.array(z.string()) }),
      execute: safe(async ({ reason, whatIsMissing }) => {
        const list = whatIsMissing.map((m) => `- ${m}`).join("\n");
        const due = c.dispute.dueBy ? new Date(c.dispute.dueBy).toISOString().slice(0, 10) : "unknown";
        const sfResult: ActionResult = c.customer?.sfContactId
          ? await sfCase("evidence_needed", SUBJECT.evidenceNeeded(c.id), `${reason}\nMissing:\n${list}\nEvidence due ${due}.`, "High")
          : { ok: false, verified: false, attempt: 0, observed: "no Salesforce contact; case not created" };
        const slackResult = await postToSlack(
          ctx,
          "disputes",
          `Needs a human: dispute ${c.id} (${money(c.dispute.amount)}), evidence due ${due}. ${reason}\nMissing:\n${list}`,
        );
        return {
          ok: sfResult.ok && slackResult.ok,
          verified: sfResult.verified && slackResult.verified,
          salesforce: sfResult,
          slack: slackResult,
        };
      }),
    }),
  };
}
