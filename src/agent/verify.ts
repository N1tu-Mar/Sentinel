import * as sf from "@/adapters/salesforce";
import * as slack from "@/adapters/slack";
import * as stripeApi from "@/adapters/stripe";
import type { DisputeCase, VerificationCheck } from "@/domain/types";

export const SUBJECT = {
  risk: "Chargeback risk: repeat disputer",
  evidenceNeeded: (disputeId: string) => `Evidence needed: ${disputeId}`,
  followUp: (disputeId: string, subject: string) => `Dispute ${disputeId}: ${subject}`,
};
export const RISK_MARKER = "[CHARGEBACK RISK]";
export const caseUrl = (id: string) => `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${id}`;

/** End state across Stripe, Salesforce and Slack, read directly from the providers (never from the case store). */
export interface ExternalState {
  disputeStatus: string;
  evidencePopulated: boolean;
  activeSubscriptions: number;
  canceledSubscriptions: number;
  contactFound: boolean;
  contactFlagged: boolean;
  riskCases: number;
  evidenceNeededCases: number;
  followUpCases: number;
  slackDisputes: number;
  slackRisk: number;
  slackApprovals: number;
}

export async function readExternalState(c: DisputeCase): Promise<ExternalState> {
  const dispute = await stripeApi.getDispute(c.id);
  const ev = dispute.evidence;
  const customerId = c.dispute.customerId;
  const email =
    c.customer?.email ?? ((await stripeApi.getCustomer(customerId)) as { email?: string | null }).email ?? "";
  const [subs, contact, disputes, risk, approvals] = await Promise.all([
    stripeApi.listSubscriptions(customerId),
    c.customer?.sfContactId ? sf.getContact(c.customer.sfContactId) : sf.findContactByEmail(email),
    slack.findMessages(slack.channelName("disputes"), `/cases/${c.id}`),
    slack.findMessages(slack.channelName("risk"), `/cases/${c.id}`),
    slack.findMessages(slack.channelName("approvals"), `/cases/${c.id}`),
  ]);
  const cases = contact ? await sf.listCasesForContact(contact.Id) : [];
  return {
    disputeStatus: dispute.status,
    evidencePopulated: !!(ev?.uncategorized_text || ev?.customer_communication),
    activeSubscriptions: subs.data.filter((s) => s.status === "active" || s.status === "trialing").length,
    canceledSubscriptions: subs.data.filter((s) => s.status === "canceled").length,
    contactFound: !!contact,
    contactFlagged: !!contact?.Description?.includes(RISK_MARKER),
    riskCases: cases.filter((x) => x.Subject === SUBJECT.risk).length,
    evidenceNeededCases: cases.filter((x) => x.Subject === SUBJECT.evidenceNeeded(c.id)).length,
    followUpCases: cases.filter((x) => x.Subject?.startsWith(`Dispute ${c.id}:`)).length,
    slackDisputes: disputes.length,
    slackRisk: risk.length,
    slackApprovals: approvals.length,
  };
}

/** Pure: given the recorded decision, what must be true in every system. */
export function postconditionChecks(c: DisputeCase, s: ExternalState): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const eq = (system: VerificationCheck["system"], check: string, expected: unknown, observed: unknown) =>
    checks.push({ system, check, expected: String(expected), observed: String(observed), passed: expected === observed });

  const d = c.decision;
  if (!d) {
    eq("sentinel", "Decision recorded", true, false);
    return checks;
  }
  eq("sentinel", "Forbidden provider effects", 0, c.forbiddenEffects);
  const stripeWrites = c.actions.filter((a) => a.action.startsWith("stripe.") && a.attempts.some((t) => t.httpStatus)).length;

  switch (d.branch) {
    case "FIGHT":
    case "FIGHT_AND_FLAG":
      eq("stripe", "Dispute status", "under_review", s.disputeStatus);
      eq("stripe", "Evidence populated", true, s.evidencePopulated);
      eq("slack", "Summary posts in #disputes", 1, s.slackDisputes);
      if (d.branch === "FIGHT") eq("salesforce", "Risk cases", 0, s.riskCases);
      else {
        eq("salesforce", "Risk cases", 1, s.riskCases);
        eq("salesforce", "Contact flagged", true, s.contactFlagged);
        eq("slack", "Posts in #risk", 1, s.slackRisk);
      }
      break;
    case "ACCEPT":
      if (d.requiresApproval && c.approval?.outcome !== "approved") {
        eq("stripe", "Dispute status (unchanged)", "needs_response", s.disputeStatus);
        if (c.approval?.outcome === "rejected") eq("slack", "Summary posts in #disputes", 1, s.slackDisputes);
        else {
          eq("sentinel", "Approval requested", true, !!c.approval?.requestedAt);
          eq("slack", "Posts in #dispute-approvals", 1, s.slackApprovals);
        }
      } else {
        eq("stripe", "Dispute status", "lost", s.disputeStatus);
        eq("stripe", "Active subscriptions", 0, s.activeSubscriptions);
        eq("salesforce", "Follow-up cases", 1, s.followUpCases);
        eq("slack", "Summary posts in #disputes", 1, s.slackDisputes);
      }
      break;
    case "ASK_HUMAN":
    case "EXPIRED_OR_BLOCKED":
      eq("stripe", "Stripe writes attempted", 0, stripeWrites);
      eq("stripe", "Evidence populated", false, s.evidencePopulated);
      if (d.branch === "ASK_HUMAN") eq("salesforce", "Evidence needed cases", 1, s.evidenceNeededCases);
      eq("slack", "Summary posts in #disputes", 1, s.slackDisputes);
      break;
  }
  return checks;
}

export async function verifyPostconditions(c: DisputeCase) {
  const state = await readExternalState(c);
  const checks = postconditionChecks(c, state);
  return { passed: checks.every((x) => x.passed), checks, at: Date.now(), state };
}
