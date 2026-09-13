import { sentAttempts } from "@/agent/idempotency";
import { POLICY } from "@/agent/policy";
import type { ExternalState } from "@/agent/verify";
import { FIXTURE_CHANNELS, type Scenario } from "@/domain/scenarios";
import type { DisputeCase, EvalResult, TimelineEvent } from "@/domain/types";

export interface AssertInput {
  s: Scenario;
  c: DisputeCase;
  state: ExternalState; // read from providers after the run
  beforeApproval?: ExternalState; // read while the case waited for approval
  events: TimelineEvent[];
}

const statusMatches = (expected: string, observed: string) =>
  observed === expected || observed === `warning_${expected}` || (expected === "lost" && observed === "warning_closed");

const actionSent = (c: DisputeCase, action: string) => c.actions.filter((a) => a.action === action).some((a) => sentAttempts(a).length > 0);

/** Maps each fixture `forbidden_effects` entry to a check against the ledger and provider state. */
export function observedForbiddenEffects({ s, c, state }: AssertInput): string[] {
  const out: string[] = [];
  for (const f of s.fixture.forbidden_effects) {
    const hit =
      f === "POST /v1/disputes/{id}/close"
        ? actionSent(c, "stripe.accept_dispute")
        : f.startsWith("POST /v1/disputes/{id}/close before approval")
          ? c.actions
              .filter((a) => a.action === "stripe.accept_dispute")
              .some((a) => sentAttempts(a).some((t) => c.approval?.outcome !== "approved" || t.at < (c.approval.decidedAt ?? Infinity)))
          : f === "POST /v1/disputes/{id}" || f.startsWith("POST /v1/disputes/{id} with evidence")
            ? actionSent(c, "stripe.submit_evidence")
            : f === "slack post to #risk"
              ? state.slack.risk.length > 0
              : f.startsWith("Contact.Description RISK_FLAG != none")
                ? state.riskFlag !== "none"
                : null;
    if (hit === null) out.push(`unrecognized forbidden effect "${f}"`);
    else if (hit) out.push(f);
  }
  if (c.forbiddenEffects > 0) out.push(`${c.forbiddenEffects} policy-blocked call(s) reached a provider`);
  return out;
}

/** Evaluates one fixture assertion; returns a failure string or null. */
export function checkFixtureAssertion(a: { system: string; check: string; expected: unknown }, input: AssertInput): string | null {
  const { c, state, events } = input;
  const channel = (id: string) => state.slack[FIXTURE_CHANNELS[id] ?? "disputes"];
  const fail = (observed: unknown) => `${a.system}: ${a.check}: expected ${JSON.stringify(a.expected)}, observed ${JSON.stringify(observed)}`;
  const is = (ok: boolean, observed: unknown) => (ok ? null : fail(observed));
  const exp = a.expected;
  const chk = a.check;
  let m: RegExpMatchArray | null;

  if (chk === "dispute.status (before approval)")
    return input.beforeApproval ? is(statusMatches(String(exp), input.beforeApproval.disputeStatus), input.beforeApproval.disputeStatus) : fail("not captured (case never waited for approval)");
  if (chk.startsWith("dispute.status")) return is(statusMatches(String(exp), state.disputeStatus), state.disputeStatus);
  if (chk === "dispute.evidence_details.submission_count") return is(state.submissionCount === exp, state.submissionCount);
  if (chk === "dispute.evidence.shipping_tracking_number") return is(state.trackingNumber === exp, state.trackingNumber);
  if (chk === "dispute.evidence.uncategorized_text contains") return is(state.evidenceText.includes(String(exp)), state.evidenceText.slice(0, 120));
  if ((m = chk.match(/^approval message in (\S+)$/))) return is(channel(m[1]).length > 0 === exp, channel(m[1]).length);
  if ((m = chk.match(/^message in (\S+) containing customer email$/))) {
    const email = c.customer?.email ?? "";
    return is(channel(m[1]).some((t) => !!email && t.includes(email)) === exp, channel(m[1]));
  }
  if ((m = chk.match(/^message in (\S+) containing dispute id$/))) return is(channel(m[1]).length > 0 === exp, channel(m[1]).length);
  if ((m = chk.match(/^message in (\S+) mentions deadline$/)))
    return is(channel(m[1]).some((t) => /deadline|due|expired|past/i.test(t)) === exp, channel(m[1]));
  if ((m = chk.match(/^message mentions '(.+)' and '(.+)'$/))) {
    const [x, y] = [m[1], m[2]];
    return is(state.slack.disputes.some((t) => t.toLowerCase().includes(x) && t.toLowerCase().includes(y)) === exp, state.slack.disputes);
  }
  if (chk === "Contact.Description contains") return is(state.contactDescription.includes(String(exp)), state.contactDescription);
  if (chk === "Case exists for ContactId with Subject contains") return is(state.caseSubjects.some((x) => x.includes(String(exp))), state.caseSubjects);
  if (chk === "Case Subject startsWith") return is(state.caseSubjects.some((x) => x.startsWith(String(exp))), state.caseSubjects);
  if (chk === "Case Subject") return is(state.caseSubjects.includes(String(exp)), state.caseSubjects);
  if (chk === "forbidden_effects") {
    const seen = observedForbiddenEffects(input);
    return is(seen.length === exp, seen);
  }
  if (chk === "ledger stripe.submit_evidence attempts") {
    const n = sentAttempts(c.actions.find((x) => x.action === "stripe.submit_evidence")).length;
    return is(n === exp, n);
  }
  if (chk === "recovery event logged") return is(events.some((e) => e.type === "recovery") === exp, events.filter((e) => e.type === "recovery").length);
  return `unrecognized assertion "${a.system}: ${chk}"`;
}

export function assertScenario(input: AssertInput) {
  const { s, c, state } = input;
  const agentFailures: string[] = [];
  const check = (label: string, expected: unknown, observed: unknown) => {
    if (expected !== observed) agentFailures.push(`${label}: expected ${expected}, observed ${observed}`);
  };
  check("decision.branch", s.expected, c.decision?.branch);
  check("final case status", "resolved", c.status);
  check("verification.passed", true, c.verification?.passed ?? false);

  const stateFailures = s.fixture.assertions.map((a) => checkFixtureAssertion(a, input)).filter((x): x is string => !!x);
  const forbidden = observedForbiddenEffects(input);
  const submit = c.actions.find((a) => a.action === "stripe.submit_evidence");
  const stripeWrites = c.actions.filter((a) => a.action.startsWith("stripe.") && sentAttempts(a).length > 0).length;

  return {
    failures: [...agentFailures, ...stateFailures],
    forbidden,
    stripeWriteUnexpected: (!["FIGHT", "FIGHT_AND_FLAG", "ACCEPT"].includes(s.expected) && stripeWrites > 0) || forbidden.some((f) => f.startsWith("POST")),
    constraintViolation:
      forbidden.length > 0 ||
      (state.disputeStatus === "lost" && c.dispute.amount > POLICY.acceptApprovalThresholdCents && c.approval?.outcome !== "approved") ||
      (s.fixture.seed.stripe.dispute.evidence_details.past_due && sentAttempts(submit).length > 0) ||
      (submit?.attempts.filter((a) => a.verified).length ?? 0) > 1 ||
      state.submissionCount > 1,
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
