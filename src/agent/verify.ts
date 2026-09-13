import type Stripe from "stripe";
import * as sf from "@/adapters/salesforce";
import * as slack from "@/adapters/slack";
import * as stripeApi from "@/adapters/stripe";
import type { DisputeCase, VerificationCheck } from "@/domain/types";
import { ACCEPTED_STATUSES, OPEN_STATUSES, SUBMITTED_STATUSES } from "./policy";

export const SUBJECT = {
  risk: "Chargeback risk: repeat disputer",
  evidenceNeeded: (disputeId: string) => `Evidence needed: ${disputeId}`,
  accepted: (disputeId: string) => `Dispute accepted: ${disputeId}`,
  followUp: (disputeId: string, subject: string) => `Dispute ${disputeId}: ${subject}`,
};
export const RISK_FLAG = { key: "RISK_FLAG", flagged: "friendly_fraud", none: "none" };
export const caseUrl = (id: string) => `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${id}`;

/** End state across Stripe, Salesforce and Slack, read directly from the providers (never from the case store). */
export interface ExternalState {
  disputeStatus: string;
  submissionCount: number;
  evidenceText: string;
  trackingNumber: string | null;
  activeSubscriptions: number;
  contactFound: boolean;
  contactDescription: string;
  riskFlag: string;
  caseSubjects: string[];
  riskCases: number;
  evidenceNeededCases: number;
  followUpCases: number;
  slack: { disputes: string[]; risk: string[]; approvals: string[] };
}

async function customerEmail(c: DisputeCase): Promise<string> {
  if (c.customer?.email) return c.customer.email;
  const cust = c.dispute.customerId ? await stripeApi.getCustomer(c.dispute.customerId) : null;
  const email = cust && !("deleted" in cust && cust.deleted) ? (cust as Stripe.Customer).email : null;
  if (email) return email;
  const charge = await stripeApi.getCharge(c.dispute.chargeId);
  return charge.billing_details?.email ?? charge.receipt_email ?? "";
}

export async function readExternalState(c: DisputeCase): Promise<ExternalState> {
  const dispute = await stripeApi.getDispute(c.id);
  const email = await customerEmail(c);
  const [subs, contact, disputes, risk, approvals] = await Promise.all([
    c.dispute.customerId ? stripeApi.listSubscriptions(c.dispute.customerId) : Promise.resolve({ data: [] as Stripe.Subscription[] }),
    c.customer?.sfContactId ? sf.getContact(c.customer.sfContactId) : email ? sf.findContactByEmail(email) : Promise.resolve(null),
    slack.findMessages(slack.channelName("disputes"), c.id),
    slack.findMessages(slack.channelName("risk"), c.id),
    slack.findMessages(slack.channelName("approvals"), c.id),
  ]);
  const subjects = (contact ? await sf.listCasesForContact(contact.Id) : []).map((x) => x.Subject ?? "");
  return {
    disputeStatus: dispute.status,
    submissionCount: dispute.evidence_details?.submission_count ?? 0,
    evidenceText: dispute.evidence?.uncategorized_text ?? "",
    trackingNumber: dispute.evidence?.shipping_tracking_number ?? null,
    activeSubscriptions: subs.data.filter((s) => s.status === "active" || s.status === "trialing").length,
    contactFound: !!contact,
    contactDescription: contact?.Description ?? "",
    riskFlag: sf.descriptionLine(contact?.Description, RISK_FLAG.key) ?? RISK_FLAG.none,
    caseSubjects: subjects,
    riskCases: subjects.filter((s) => s === SUBJECT.risk).length,
    evidenceNeededCases: subjects.filter((s) => s === SUBJECT.evidenceNeeded(c.id)).length,
    followUpCases: subjects.filter((s) => s === SUBJECT.accepted(c.id) || s.startsWith(`Dispute ${c.id}:`)).length,
    slack: { disputes: disputes.map((m) => m.text), risk: risk.map((m) => m.text), approvals: approvals.map((m) => m.text) },
  };
}

/** Pure: given the recorded decision, what must be true in every system. */
export function postconditionChecks(c: DisputeCase, s: ExternalState): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const eq = (system: VerificationCheck["system"], check: string, expected: unknown, observed: unknown) =>
    checks.push({ system, check, expected: String(expected), observed: String(observed), passed: expected === observed });
  const oneOf = (system: VerificationCheck["system"], check: string, allowed: readonly string[], observed: string) =>
    checks.push({ system, check, expected: allowed.join(" or "), observed, passed: allowed.includes(observed) });

  const d = c.decision;
  if (!d) {
    eq("sentinel", "Decision recorded", true, false);
    return checks;
  }
  eq("sentinel", "Forbidden provider effects", 0, c.forbiddenEffects);
  const stripeWrites = c.actions.filter((a) => a.action.startsWith("stripe.") && a.attempts.some((t) => t.httpStatus !== undefined || t.note)).length;

  switch (d.branch) {
    case "FIGHT":
    case "FIGHT_AND_FLAG":
      oneOf("stripe", "Dispute status", SUBMITTED_STATUSES, s.disputeStatus);
      eq("stripe", "Evidence submissions", 1, s.submissionCount);
      eq("stripe", "Evidence narrative present", true, s.evidenceText.length > 0);
      eq("slack", "Summary posts in #disputes", 1, s.slack.disputes.length);
      if (d.branch === "FIGHT") {
        eq("salesforce", "Contact risk flag", RISK_FLAG.none, s.riskFlag);
        eq("salesforce", "Risk cases", 0, s.riskCases);
      } else {
        eq("salesforce", "Contact risk flag", RISK_FLAG.flagged, s.riskFlag);
        eq("salesforce", "Risk cases", 1, s.riskCases);
        eq("slack", "Posts in #risk", 1, s.slack.risk.length);
      }
      break;
    case "ACCEPT":
      eq("stripe", "Evidence submissions", 0, s.submissionCount);
      if (d.requiresApproval && c.approval?.outcome !== "approved") {
        oneOf("stripe", "Dispute status (unchanged)", OPEN_STATUSES, s.disputeStatus);
        if (c.approval?.outcome === "rejected") eq("slack", "Summary posts in #disputes", 1, s.slack.disputes.length);
        else {
          eq("sentinel", "Approval requested", true, !!c.approval?.requestedAt);
          eq("slack", "Posts in #dispute-approvals", 1, s.slack.approvals.length);
        }
      } else {
        oneOf("stripe", "Dispute status", ACCEPTED_STATUSES, s.disputeStatus);
        eq("stripe", "Active subscriptions", 0, s.activeSubscriptions);
        eq("salesforce", "Follow-up cases", 1, s.followUpCases);
        eq("slack", "Summary posts in #disputes", 1, s.slack.disputes.length);
      }
      break;
    case "ASK_HUMAN":
    case "EXPIRED_OR_BLOCKED":
      eq("stripe", "Stripe writes attempted", 0, stripeWrites);
      eq("stripe", "Evidence submissions", 0, s.submissionCount);
      if (d.branch === "ASK_HUMAN") eq("salesforce", "Evidence needed cases", 1, s.evidenceNeededCases);
      eq("slack", "Summary posts in #disputes", 1, s.slack.disputes.length);
      break;
  }
  return checks;
}

export async function verifyPostconditions(c: DisputeCase) {
  const state = await readExternalState(c);
  const checks = postconditionChecks(c, state);
  return { passed: checks.every((x) => x.passed), checks, at: Date.now(), state };
}
