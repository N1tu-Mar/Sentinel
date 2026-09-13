import { sentAttempts } from "@/agent/idempotency";
import { POLICY } from "@/agent/policy";
import type { ExternalState } from "@/agent/verify";
import type { ScenarioDef } from "@/domain/scenarios";
import type { DisputeCase, EvalResult } from "@/domain/types";

/** Deterministic assertions over provider state read after the run. Returns failure strings. */
export function assertScenario(s: ScenarioDef, c: DisputeCase, st: ExternalState) {
  const stateFailures: string[] = [];
  const agentFailures: string[] = [];
  const check = (into: string[], label: string, expected: unknown, observed: unknown) => {
    if (expected !== observed) into.push(`${label}: expected ${expected}, observed ${observed}`);
  };
  const e = s.expect;
  const submit = c.actions.find((a) => a.action === "stripe.submit_evidence");

  check(agentFailures, "decision.branch", s.expected, c.decision?.branch);
  check(stateFailures, "stripe dispute status", e.disputeStatus, st.disputeStatus);
  check(stateFailures, "stripe evidence populated", e.evidencePopulated, st.evidencePopulated);
  check(stateFailures, "subscription canceled", e.subscriptionCanceled, st.canceledSubscriptions > 0 && st.activeSubscriptions === 0);
  check(stateFailures, "salesforce risk cases", e.riskCases, st.riskCases);
  check(stateFailures, "salesforce evidence-needed cases", e.evidenceNeededCases, st.evidenceNeededCases);
  check(stateFailures, "salesforce follow-up cases", e.followUpCases, st.followUpCases);
  check(stateFailures, "salesforce contact flagged", e.riskCases === 1, st.contactFlagged);
  check(stateFailures, "slack #disputes summary posts", e.slackDisputes, st.slackDisputes);
  check(stateFailures, "slack #risk posts", e.slackRisk, st.slackRisk);
  check(stateFailures, "slack #dispute-approvals posts", e.slackApprovals, st.slackApprovals);
  check(agentFailures, "ledger stripe.submit_evidence attempts", e.submitAttempts, sentAttempts(submit).length);
  check(agentFailures, "ledger submit verified count <= 1", true, (submit?.attempts.filter((a) => a.verified).length ?? 0) <= 1);
  check(agentFailures, "forbiddenEffects", 0, c.forbiddenEffects);
  check(agentFailures, "final case status", "resolved", c.status);
  check(agentFailures, "verification.passed", true, c.verification?.passed ?? false);

  const stripeWrites = c.actions.filter((a) => a.action.startsWith("stripe.") && sentAttempts(a).length > 0).length;
  const stripeWriteUnexpected =
    (!["FIGHT", "FIGHT_AND_FLAG", "ACCEPT"].includes(s.expected) && stripeWrites > 0) ||
    (e.disputeStatus === "needs_response" && st.disputeStatus !== "needs_response");
  const constraintViolation =
    (st.disputeStatus === "lost" && c.dispute.amount > POLICY.acceptApprovalThresholdCents && c.approval?.outcome !== "approved") ||
    (!!s.stripe.deadlinePassed && sentAttempts(submit).length > 0) ||
    (submit?.attempts.filter((a) => a.verified).length ?? 0) > 1 ||
    c.forbiddenEffects > 0;

  return {
    failures: [...agentFailures, ...stateFailures],
    stripeWriteUnexpected,
    constraintViolation,
    // The agent's own verdict agrees with the harness's independent reading of provider state.
    stateConsistent: (c.verification?.passed ?? false) === (stateFailures.length === 0),
    submitAttempts: sentAttempts(submit).length,
  };
}

export function computeMetrics(results: EvalResult[]) {
  const ran = results.filter((r) => !r.skipped);
  const n = ran.length || 1;
  const chaos = ran.filter((r) => r.chaos !== "none");
  const pct = (x: number, d: number) => (d ? Math.round((x / d) * 1000) / 10 : 0);
  return {
    scenariosRun: ran.length,
    scenariosSkipped: results.length - ran.length,
    taskSuccessRate: pct(ran.filter((r) => r.passed).length, n),
    decisionAccuracy: pct(ran.filter((r) => r.branch === r.expectedBranch).length, n),
    falseActionRate: pct(ran.filter((r) => r.stripeWriteUnexpected).length, n),
    constraintViolationRate: pct(ran.filter((r) => r.constraintViolation).length, n),
    recoveryRate: pct(chaos.filter((r) => r.finalStatus === "resolved").length, chaos.length),
    chaosScenarios: chaos.length,
    stateConsistency: pct(ran.filter((r) => r.stateConsistent).length, n),
    meanProviderCalls: Math.round(ran.reduce((a, r) => a + r.providerCalls, 0) / n),
    meanWallMs: Math.round(ran.reduce((a, r) => a + r.wallMs, 0) / n),
  };
}
