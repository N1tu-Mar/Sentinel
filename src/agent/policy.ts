import type { ActionName, DisputeCase } from "@/domain/types";

export const POLICY = {
  acceptApprovalThresholdCents: 20000,
  repeatDisputerWindowDays: 90,
  repeatDisputerMinCount: 2,
  maxAttemptsPerAction: 2,
} as const;

export class PolicyViolation extends Error {}

export type GuardedAction = ActionName | "request_approval" | "escalate_to_human";

/** Live provider state read immediately before the write (never trusted from the LLM). */
export interface LiveState {
  disputeStatus?: string;
  dueBy?: number | null; // ms epoch
  priorDisputes?: number;
  subscription?: { customerId: string; status: string };
}

export const requiresApproval = (branch: string, amountCents: number) =>
  branch === "ACCEPT" && amountCents > POLICY.acceptApprovalThresholdCents;

/** Throws PolicyViolation with a plain-English reason. Called at the top of every action tool. */
export function assertAllowed(action: GuardedAction, c: DisputeCase, live: LiveState = {}, now = Date.now()): void {
  const d = c.decision;
  const deny = (reason: string) => {
    throw new PolicyViolation(reason);
  };
  if (!d) deny("record_decision must be called before any action");
  const branch = d!.branch;

  const disputeOpen = () => {
    const status = live.disputeStatus ?? c.dispute.status;
    if (status !== "needs_response") deny(`dispute status is ${status}, not needs_response`);
    const dueBy = live.dueBy !== undefined ? live.dueBy : c.dispute.dueBy;
    if (dueBy !== null && dueBy <= now) deny(`evidence deadline passed at ${new Date(dueBy).toISOString()}`);
  };
  const approvedIfNeeded = () => {
    if (d!.requiresApproval && c.approval?.outcome !== "approved")
      deny(`accepting $${(c.dispute.amount / 100).toFixed(2)} requires human approval first`);
  };

  switch (action) {
    case "stripe.submit_evidence":
      if (branch !== "FIGHT" && branch !== "FIGHT_AND_FLAG") deny(`decision is ${branch}; submitting evidence requires FIGHT`);
      disputeOpen();
      return;
    case "stripe.accept_dispute":
      if (branch !== "ACCEPT") deny(`decision is ${branch}; accepting requires ACCEPT`);
      approvedIfNeeded();
      disputeOpen();
      return;
    case "stripe.cancel_subscription":
      if (branch !== "ACCEPT") deny(`decision is ${branch}; canceling a subscription requires ACCEPT`);
      approvedIfNeeded();
      if (live.subscription && live.subscription.customerId !== c.dispute.customerId)
        deny("subscription does not belong to this customer");
      if (live.subscription && live.subscription.status !== "active" && live.subscription.status !== "trialing")
        deny(`subscription is ${live.subscription.status}, not active`);
      return;
    case "salesforce.flag_contact":
      if (branch !== "FIGHT_AND_FLAG") deny(`decision is ${branch}; flagging requires FIGHT_AND_FLAG`);
      if (live.priorDisputes !== undefined && live.priorDisputes < POLICY.repeatDisputerMinCount)
        deny(
          `customer has ${live.priorDisputes} prior disputes in ${POLICY.repeatDisputerWindowDays} days; flag needs ${POLICY.repeatDisputerMinCount}`,
        );
      return;
    case "request_approval":
      if (!d!.requiresApproval) deny("this decision does not require approval");
      return;
    case "salesforce.create_case":
    case "slack.post":
    case "escalate_to_human":
      return;
  }
}
