import { tool } from "ai";
import type Stripe from "stripe";
import { z } from "zod";
import * as gmail from "@/adapters/gmail";
import { HttpError, sleep } from "@/adapters/logged-fetch";
import * as sf from "@/adapters/salesforce";
import * as slack from "@/adapters/slack";
import * as stripeApi from "@/adapters/stripe";
import type { ActionResult, EvidenceItem } from "@/domain/types";
import { CHAOS_TEXT } from "./chaos";
import type { RunContext } from "./context";
import { errMsg, runAction } from "./idempotency";
import { ACCEPTED_STATUSES, POLICY, requiresApproval, stripeWriteBlocker, SUBMITTED_STATUSES } from "./policy";
import { caseUrl, RISK_FLAG, SUBJECT } from "./verify";

const DAY = 86400_000;
const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);
export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

const FIELD_MAX = 20_000;
const TOTAL_MAX = 150_000;

/** Stripe limits: 20,000 chars per text field, 150,000 combined. The narrative absorbs any cut. */
export function fitEvidence(fields: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v) out[k] = v.length > FIELD_MAX ? `${v.slice(0, FIELD_MAX - 1)}…` : v;
  const over = Object.values(out).reduce((n, v) => n + v.length, 0) - TOTAL_MAX;
  if (over > 0 && out.uncategorized_text) out.uncategorized_text = `${out.uncategorized_text.slice(0, out.uncategorized_text.length - over - 1)}…`;
  return out;
}

const safe =
  <I, O>(fn: (input: I) => Promise<O>) =>
  async (input: I) => {
    try {
      return await fn(input);
    } catch (e) {
      return { ok: false, verified: false, error: errMsg(e) };
    }
  };

/** Slack post through the ledger: look for this dispute's message first, post, then prove it by ts readback. */
export function postToSlack(ctx: RunContext, kind: "disputes" | "risk" | "approvals", text: string): Promise<ActionResult> {
  const { c } = ctx;
  const channel = slack.channelName(kind);
  const body = `${text}\nDispute ${c.id}${c.customer?.email ? ` · ${c.customer.email}` : ""} · ${caseUrl(c.id)}`;
  let posted: { channel: string; ts: string } | undefined;
  return runAction(ctx, {
    action: "slack.post",
    target: kind,
    guard: kind === "approvals" ? "request_approval" : undefined,
    expected: `exactly 1 message for dispute ${c.id} in #${channel}`,
    checkBeforeWrite: true,
    perform: async () => {
      if (ctx.chaos.fire("slack.post")) {
        await ctx.emit({ type: "chaos", mode: ctx.chaos.mode, text: CHAOS_TEXT.slack_timeout_once });
        slack.post(channel, body).catch(() => {}); // the request still goes out; we stop waiting for it
        await sleep(100);
        throw new Error("Slack chat.postMessage timed out after 100 ms (injected)");
      }
      posted = await slack.post(channel, body);
    },
    verify: async () => {
      if (posted) {
        const r = await slack.readback(posted.channel, posted.ts);
        if (!r.found) return { passed: false, observed: `message ts ${posted.ts} not found in #${channel}` };
      }
      const n = (await slack.findMessages(channel, c.id)).length;
      return { passed: n === 1, observed: `${n} message(s) for dispute ${c.id} in #${channel}${posted ? `, ts ${posted.ts} read back` : ""}` };
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
    ctx.seen.set(d.id, d);
    return d;
  }
  const liveDispute = async () => {
    const d = await syncDispute();
    return {
      disputeStatus: d.status,
      dueBy: c.dispute.dueBy,
      pastDue: d.evidence_details?.past_due ?? false,
      submissionCount: d.evidence_details?.submission_count ?? 0,
    };
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
      checkBeforeWrite: true, // dedupe: query Case by ContactId + Subject first
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
    const charge = ctx.seen.get(c.dispute.chargeId) as Stripe.Charge | undefined;
    const delivery = items.filter((e) => e.kind === "delivery_proof").map((e) => (e.raw as { Description?: string })?.Description ?? e.summary).join("\n");
    const line = (key: string) => sf.descriptionLine(delivery, key);
    const addr = (a?: Stripe.Address | null) => (a ? [a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(", ") : undefined);
    // customer_communication is a file field, so quoted emails go into the narrative.
    const emails = items
      .filter((e) => e.source === "gmail")
      .map((e) => e.raw as gmail.GmailMessage)
      .filter((m) => m?.text)
      .map((m) => `On ${m.date.slice(0, 10)}, ${m.from} wrote: "${m.text}"`);
    const tracking = charge?.shipping?.tracking_number ?? line("TRACKING");
    const records = [`dispute ${c.id}`, `charge ${c.dispute.chargeId}`, line("ORDER") && `order ${line("ORDER")}`, tracking && `tracking ${tracking}`].filter(Boolean);
    return fitEvidence({
      customer_name: c.customer?.name || charge?.billing_details?.name,
      customer_email_address: c.customer?.email,
      product_description: charge?.description ?? line("ITEM"),
      billing_address: addr(charge?.billing_details?.address),
      shipping_address: addr(charge?.shipping?.address),
      shipping_carrier: charge?.shipping?.carrier ?? line("CARRIER"),
      shipping_tracking_number: tracking,
      shipping_date: line("SHIPPED"),
      uncategorized_text: [rebuttal, emails.length ? `Customer communication:\n${emails.join("\n")}` : "", `Records: ${records.join(", ")}.`]
        .filter(Boolean)
        .join("\n\n"),
    });
  }

  return {
    // ---------- read tools ----------
    stripe_get_dispute: tool({
      description: "Read the dispute under investigation from Stripe: status, reason, amount, deadline, submission count.",
      inputSchema: z.object({}),
      execute: safe(async () => {
        const d = await syncDispute();
        const blocked = stripeWriteBlocker({ status: d.status, dueBy: c.dispute.dueBy, pastDue: d.evidence_details?.past_due });
        return {
          id: d.id,
          status: d.status,
          reason: d.reason,
          amount: d.amount,
          currency: d.currency,
          charge: stripeApi.idOf(d.charge),
          created: iso(d.created),
          due_by: iso(d.evidence_details?.due_by),
          past_due: d.evidence_details?.past_due ?? false,
          submission_count: d.evidence_details?.submission_count ?? 0,
          has_evidence: d.evidence_details?.has_evidence ?? false,
          can_respond: blocked === null,
          blocked_reason: blocked,
        };
      }),
    }),

    stripe_get_charge_and_customer: tool({
      description: "Read the disputed charge (description, amount, date, shipping, billing, card checks) and the Stripe customer.",
      inputSchema: z.object({}),
      execute: safe(async () => {
        const charge = await stripeApi.getCharge(c.dispute.chargeId);
        ctx.seen.set(charge.id, charge);
        const customerId = c.dispute.customerId || stripeApi.idOf(charge.customer);
        const customer = customerId ? await stripeApi.getCustomer(customerId) : null;
        const cust = customer && !("deleted" in customer && customer.deleted) ? (customer as Stripe.Customer) : null;
        const email = cust?.email || charge.billing_details?.email || charge.receipt_email || "";
        c.customer = { email, name: cust?.name || charge.billing_details?.name || "", stripeId: customerId, sfContactId: c.customer?.sfContactId };
        await ctx.save();
        const card = charge.payment_method_details?.card;
        return {
          charge: {
            id: charge.id,
            amount: charge.amount,
            currency: charge.currency,
            created: iso(charge.created),
            description: charge.description,
            refunded: charge.refunded,
            amount_refunded: charge.amount_refunded,
            receipt_email: charge.receipt_email,
            billing_details: charge.billing_details,
            shipping: charge.shipping ?? null,
            outcome: charge.outcome ? { network_status: charge.outcome.network_status, risk_level: charge.outcome.risk_level } : null,
            card: card ? { brand: card.brand, last4: card.last4, checks: card.checks } : null,
            metadata: charge.metadata,
          },
          customer: cust ? { id: cust.id, email: cust.email, name: cust.name, created: iso(cust.created) } : null,
          customer_email: email,
        };
      }),
    }),

    stripe_customer_history: tool({
      description: "This customer's other disputes in the window (joined via charge.customer), refunds on the disputed charge, charges and subscriptions.",
      inputSchema: z.object({ days: z.number().int().positive().max(365).optional() }),
      execute: safe(async ({ days }) => {
        const window = days ?? POLICY.repeatDisputerWindowDays;
        const customerId = c.dispute.customerId;
        const [prior, refunds, charges, subs] = await Promise.all([
          customerId ? stripeApi.listCustomerDisputes(customerId, window, c.id) : Promise.resolve([]),
          stripeApi.listRefunds(c.dispute.chargeId),
          customerId ? stripeApi.listCustomerCharges(customerId).then((r) => r.data) : Promise.resolve([]),
          customerId ? stripeApi.listSubscriptions(customerId).then((r) => r.data) : Promise.resolve([]),
        ]);
        for (const x of [...prior, ...refunds.data, ...charges, ...subs]) ctx.seen.set(x.id, x);
        return {
          window_days: window,
          other_disputes: {
            count: prior.length,
            items: prior.map((d) => ({ id: d.id, status: d.status, reason: d.reason, amount: d.amount, created: iso(d.created) })),
          },
          refunds_on_disputed_charge: refunds.data
            .filter((r) => r.status === "succeeded")
            .map((r) => ({ id: r.id, amount: r.amount, created: iso(r.created), reason: r.reason })),
          charges: charges.map((ch) => ({ id: ch.id, amount: ch.amount, description: ch.description, created: iso(ch.created), disputed: ch.disputed })),
          subscriptions: subs.map((s) => ({ id: s.id, status: s.status, created: iso(s.created), canceled_at: iso(s.canceled_at) })),
        };
      }),
    }),

    salesforce_lookup_customer: tool({
      description:
        "Find the customer's Salesforce contact by email (Description lines LTV_CENTS, PRIOR_DISPUTES_90D, RISK_FLAG) and their cases from the last 180 days. Delivery records (TRACKING + DELIVERED lines) are recorded as evidence automatically.",
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
          const already = c.evidence.some((e) => (e.raw as { Id?: string })?.Id === k.Id);
          if (!ours && !already && sf.isDeliveryRecord(k.Description)) {
            const l = (key: string) => sf.descriptionLine(k.Description, key);
            const item = await addEvidence({
              source: "salesforce",
              kind: "delivery_proof",
              summary: `${k.Subject}: ${l("CARRIER") ?? "carrier"} ${l("TRACKING")}, shipped ${l("SHIPPED") ?? "?"}, delivered ${l("DELIVERED")}${l("SIGNATURE") ? `, signed ${l("SIGNATURE")}` : ""}`,
              raw: k,
              strength: "strong",
            });
            recorded.push(item.id);
          }
        }
        await ctx.save();
        const line = (key: string) => sf.descriptionLine(contact.Description, key);
        return {
          found: true,
          contact: {
            id: contact.Id,
            name: contact.Name,
            email: contact.Email,
            ltv_cents: line("LTV_CENTS"),
            prior_disputes_90d: line("PRIOR_DISPUTES_90D"),
            risk_flag: line(RISK_FLAG.key),
            description: contact.Description,
          },
          cases: cases.map((k) => ({ id: k.Id, number: k.CaseNumber, subject: k.Subject, description: k.Description, status: k.Status, created: k.CreatedDate })),
          evidence_recorded: recorded,
        };
      }),
    }),

    gmail_search_threads: tool({
      description:
        "Search the merchant mailbox for threads to or from the customer since a date (default: 180 days ago). Returns decoded messages with quoted replies stripped. Call record_evidence for relevant messages, with ref = the message id.",
      inputSchema: z.object({ email: z.string(), afterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
      execute: safe(async ({ email, afterDate }) => {
        const after = afterDate ?? new Date(Date.now() - 180 * DAY).toISOString().slice(0, 10);
        const threads = await gmail.searchThreads(email, after.replaceAll("-", "/"));
        const out = [];
        for (const t of threads.slice(0, 10)) {
          const messages = await gmail.getThread(t.id);
          for (const m of messages) ctx.seen.set(m.id, m);
          out.push({ threadId: t.id, messages });
        }
        return { count: out.length, threads: out, note: out.length ? undefined : `No email threads with ${email} since ${after}` };
      }),
    }),

    record_evidence: tool({
      description:
        "Record evidence you found so it can be cited. ref must be the id of a record a tool returned in this run (Gmail message id, Stripe charge/dispute/refund id, Salesforce case id).",
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
      description:
        "Submit dispute evidence to Stripe (FIGHT branches). Submission is final. Shipping fields, customer details and quoted customer emails from the cited evidence are attached automatically; you write the rebuttal. The tool reads the dispute back and reports verified.",
      inputSchema: z.object({ rebuttal: z.string().max(15000), includeEvidenceIds: z.array(z.string()) }),
      execute: safe(async ({ rebuttal, includeEvidenceIds }) =>
        runAction(ctx, {
          action: "stripe.submit_evidence",
          expected: "status under_review, submission_count = 1, evidence populated",
          live: liveDispute,
          perform: async (_n, idempotencyKey) => {
            const submit = !ctx.chaos.fire("stripe.submit_evidence");
            if (!submit) await ctx.emit({ type: "chaos", mode: ctx.chaos.mode, text: CHAOS_TEXT.drop_submit_once });
            await stripeApi.submitEvidence(c.id, buildEvidence(rebuttal, includeEvidenceIds), { idempotencyKey, submit });
          },
          verify: async () => {
            const d = await readbackDispute();
            const count = d.evidence_details?.submission_count ?? 0;
            const populated = !!d.evidence?.uncategorized_text;
            return {
              passed: SUBMITTED_STATUSES.includes(d.status) && count === 1 && populated,
              observed: `dispute status = ${d.status}, submission_count = ${count}, evidence ${populated ? "populated" : "empty"}`,
            };
          },
        }),
      ),
    }),

    stripe_accept_dispute: tool({
      description: "Accept (close) the dispute in Stripe. Irreversible. ACCEPT branch only; over $200 requires recorded approval first.",
      inputSchema: z.object({}),
      execute: safe(async () =>
        runAction(ctx, {
          action: "stripe.accept_dispute",
          expected: "status lost",
          live: liveDispute,
          perform: async (_n, idempotencyKey) => {
            await stripeApi.closeDispute(c.id, { idempotencyKey });
          },
          verify: async () => {
            const d = await readbackDispute();
            return { passed: ACCEPTED_STATUSES.includes(d.status), observed: `dispute status = ${d.status}` };
          },
        }),
      ),
    }),

    stripe_cancel_subscription: tool({
      description: "Cancel the customer's still-active Stripe subscription (ACCEPT branch), if one exists.",
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
      description: "Open a follow-up case on the customer's Salesforce contact. For ACCEPT the subject is always 'Dispute accepted: <dispute id>'.",
      inputSchema: z.object({ subject: z.string(), description: z.string(), priority: z.enum(["Low", "Medium", "High"]) }),
      execute: safe(async ({ subject, description, priority }) =>
        sfCase("follow_up", c.decision?.branch === "ACCEPT" ? SUBJECT.accepted(c.id) : SUBJECT.followUp(c.id, subject), description, priority),
      ),
    }),

    salesforce_flag_repeat_disputer: tool({
      description: "Set RISK_FLAG: friendly_fraud on the Salesforce contact and open the 'Chargeback risk: repeat disputer' case (FIGHT_AND_FLAG only).",
      inputSchema: z.object({ note: z.string() }),
      execute: safe(async ({ note }) => {
        const id = contactId();
        return runAction(ctx, {
          action: "salesforce.flag_contact",
          expected: `RISK_FLAG: ${RISK_FLAG.flagged} and exactly 1 "${SUBJECT.risk}" case`,
          checkBeforeWrite: true,
          live: async () => ({
            priorDisputes: (await stripeApi.listCustomerDisputes(c.dispute.customerId, POLICY.repeatDisputerWindowDays, c.id)).length,
          }),
          perform: async () => {
            const contact = await sf.getContact(id); // PATCH replaces Description whole: rewrite only the flag line
            if (sf.descriptionLine(contact.Description, RISK_FLAG.key) !== RISK_FLAG.flagged)
              await sf.updateContact(id, { Description: sf.setDescriptionLine(contact.Description, RISK_FLAG.key, RISK_FLAG.flagged) });
            if ((await sf.findCases(id, SUBJECT.risk)).length === 0)
              await sf.createCase({ contactId: id, subject: SUBJECT.risk, description: `Dispute ${c.id}: ${note}`, priority: "High" });
          },
          verify: async () => {
            const [contact, cases] = await Promise.all([sf.getContact(id), sf.findCases(id, SUBJECT.risk)]);
            const flag = sf.descriptionLine(contact.Description, RISK_FLAG.key) ?? "missing";
            return { passed: flag === RISK_FLAG.flagged && cases.length === 1, observed: `RISK_FLAG: ${flag}, ${cases.length} risk case(s)` };
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
          `Needs approval: accept ${money(c.dispute.amount)} dispute. ${reason}\nRationale: ${c.decision?.rationale ?? ""}\nApprove or reject in Sentinel.`,
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
        "Hand the case to a human: opens a Salesforce 'Evidence needed: <dispute id>' case listing exact gaps and posts to #disputes with the due date. Use for ASK_HUMAN, and when an action fails verification twice.",
      inputSchema: z.object({ reason: z.string(), whatIsMissing: z.array(z.string()) }),
      execute: safe(async ({ reason, whatIsMissing }) => {
        const list = whatIsMissing.map((m) => `- ${m}`).join("\n");
        const due = c.dispute.dueBy ? new Date(c.dispute.dueBy).toISOString().slice(0, 10) : "unknown";
        const sfResult: ActionResult = c.customer?.sfContactId
          ? await sfCase("evidence_needed", SUBJECT.evidenceNeeded(c.id), `${reason}\nMissing:\n${list}\nEvidence due ${due}.`, "High")
          : { ok: false, verified: false, attempt: 0, observed: "no Salesforce contact; case not created" };
        const slackResult = await postToSlack(ctx, "disputes", `Needs a human: ${money(c.dispute.amount)} dispute, evidence due ${due}. ${reason}\nMissing:\n${list}`);
        return { ok: sfResult.ok && slackResult.ok, verified: sfResult.verified && slackResult.verified, salesforce: sfResult, slack: slackResult };
      }),
    }),
  };
}
