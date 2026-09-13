// Offline check of the reliability core: policy, ledger/idempotency, chaos recovery, postconditions, assertions.
// No providers or LLM involved. Run: npm test
import assert from "node:assert/strict";
import { Chaos } from "@/agent/chaos";
import { createContext } from "@/agent/context";
import { runAction } from "@/agent/idempotency";
import { assertAllowed, PolicyViolation } from "@/agent/policy";
import { postconditionChecks, type ExternalState } from "@/agent/verify";
import { scenarioByKey } from "@/domain/scenarios";
import type { Decision, DisputeCase } from "@/domain/types";
import { assertScenario, computeMetrics } from "@/eval/assertions";
import { getStore } from "@/store";

delete process.env.UPSTASH_REDIS_REST_URL;
const DAY = 86400_000;

const mkCase = (over: Partial<DisputeCase> = {}, decision?: Partial<Decision>): DisputeCase => ({
  id: "dp_test",
  status: "running",
  chaosMode: "none",
  dispute: {
    id: "dp_test",
    chargeId: "ch_1",
    customerId: "cus_1",
    amount: 34000,
    currency: "usd",
    reason: "product_not_received",
    status: "needs_response",
    dueBy: Date.now() + 5 * DAY,
    createdAt: Date.now(),
  },
  evidence: [],
  actions: [],
  providerCalls: 0,
  forbiddenEffects: 0,
  createdAt: 0,
  updatedAt: 0,
  decision: decision
    ? { branch: "FIGHT", confidence: 0.9, rationale: "", evidenceIds: [], requiresApproval: false, plannedActions: [], decidedAt: 0, ...decision }
    : undefined,
  ...over,
});
const blocked = (fn: () => void, re: RegExp) => assert.throws(fn, (e) => e instanceof PolicyViolation && re.test(e.message));

// --- policy ---
blocked(() => assertAllowed("stripe.submit_evidence", mkCase()), /record_decision/);
blocked(() => assertAllowed("stripe.submit_evidence", mkCase({}, { branch: "ASK_HUMAN" })), /requires FIGHT/);
blocked(() => assertAllowed("stripe.submit_evidence", mkCase({}, {}), { disputeStatus: "needs_response", dueBy: Date.now() - DAY }), /deadline passed/);
blocked(() => assertAllowed("stripe.submit_evidence", mkCase({}, {}), { disputeStatus: "under_review" }), /not needs_response/);
blocked(() => assertAllowed("stripe.accept_dispute", mkCase({}, { branch: "ACCEPT", requiresApproval: true })), /approval/);
assert.doesNotThrow(() =>
  assertAllowed("stripe.accept_dispute", mkCase({ approval: { requiredFor: "ACCEPT", requestedAt: 1, outcome: "approved" } }, { branch: "ACCEPT", requiresApproval: true })),
);
blocked(() => assertAllowed("salesforce.flag_contact", mkCase({}, { branch: "FIGHT_AND_FLAG" }), { priorDisputes: 1 }), /prior disputes/);
blocked(() => assertAllowed("stripe.cancel_subscription", mkCase({}, { branch: "ACCEPT" }), { subscription: { customerId: "cus_other", status: "active" } }), /belong/);
assert.doesNotThrow(() => assertAllowed("slack.post", mkCase({}, { branch: "EXPIRED_OR_BLOCKED" })));

// --- ledger + chaos: dropped submit is caught by readback, retried once, then never re-sent ---
{
  const c = mkCase({ chaosMode: "drop_submit_once" }, { branch: "FIGHT_AND_FLAG" });
  const ctx = createContext(c, getStore(), new Chaos("drop_submit_once"), { readbackDelayMs: 0, readbackIntervalMs: 0 });
  const provider = { status: "needs_response", sends: 0 };
  const spec = {
    action: "stripe.submit_evidence" as const,
    expected: "status under_review",
    live: async () => ({ disputeStatus: provider.status, dueBy: c.dispute.dueBy }),
    perform: async () => {
      provider.sends++;
      if (!ctx.chaos.fire("stripe.submit_evidence")) provider.status = "under_review";
    },
    verify: async () => ({ passed: provider.status === "under_review", observed: `dispute status = ${provider.status}` }),
  };
  const r1 = await runAction(ctx, spec);
  assert.equal(r1.verified, false);
  assert.match(r1.observed, /needs_response, expected status under_review/);
  const r2 = await runAction(ctx, spec);
  assert.equal(r2.verified, true);
  assert.equal(r2.attempt, 2);
  const r3 = await runAction(ctx, spec);
  assert.equal(r3.note, "already done and verified; no call made");
  assert.equal(provider.sends, 2);
  const rec = c.actions[0];
  assert.deepEqual(rec.attempts.map((a) => a.idempotencyKey), ["dp_test:stripe.submit_evidence:attempt1", "dp_test:stripe.submit_evidence:attempt2"]);
  assert.equal(rec.state, "succeeded_verified");
}

// --- policy block never reaches the provider; max attempts enforced ---
{
  const c = mkCase({}, { branch: "ASK_HUMAN" });
  const ctx = createContext(c, getStore(), new Chaos("none"), { readbackDelayMs: 0, readbackIntervalMs: 0 });
  let sends = 0;
  const r = await runAction(ctx, {
    action: "stripe.submit_evidence",
    expected: "under_review",
    perform: async () => void sends++,
    verify: async () => ({ passed: false, observed: "x" }),
  });
  assert.match(r.observed, /^blocked:/);
  assert.equal(sends, 0);

  const c2 = mkCase({}, { branch: "FIGHT" });
  const ctx2 = createContext(c2, getStore(), new Chaos("none"), { readbackDelayMs: 0, readbackIntervalMs: 0 });
  const failing = { action: "slack.post" as const, target: "disputes", expected: "1", perform: async () => void sends++, verify: async () => ({ passed: false, observed: "0 messages" }) };
  await runAction(ctx2, failing);
  await runAction(ctx2, failing);
  const r3 = await runAction(ctx2, failing);
  assert.match(r3.observed, /already attempted 2 times/);
  assert.equal(sends, 2);
}

// --- slack timeout: readback-before-write finds the delivered message instead of posting twice ---
{
  const c = mkCase({}, { branch: "FIGHT" });
  const ctx = createContext(c, getStore(), new Chaos("slack_timeout_once"), { readbackDelayMs: 0, readbackIntervalMs: 0 });
  let delivered = 0;
  const spec = {
    action: "slack.post" as const,
    target: "disputes",
    expected: "exactly 1",
    checkBeforeWrite: true,
    perform: async () => {
      delivered++;
      if (ctx.chaos.fire("slack.post")) throw new Error("timed out");
    },
    verify: async () => ({ passed: delivered === 1, observed: `${delivered} message(s)` }),
  };
  const r1 = await runAction(ctx, spec);
  assert.equal(r1.verified, true); // timed out, but readback shows it landed
  assert.equal(r1.ok, false);
  await runAction(ctx, spec);
  assert.equal(delivered, 1);
}

// --- postconditions ---
const state = (over: Partial<ExternalState> = {}): ExternalState => ({
  disputeStatus: "under_review",
  evidencePopulated: true,
  activeSubscriptions: 0,
  canceledSubscriptions: 0,
  contactFound: true,
  contactFlagged: true,
  riskCases: 1,
  evidenceNeededCases: 0,
  followUpCases: 0,
  slackDisputes: 1,
  slackRisk: 1,
  slackApprovals: 0,
  ...over,
});
assert.ok(postconditionChecks(mkCase({}, { branch: "FIGHT_AND_FLAG" }), state()).every((x) => x.passed));
assert.ok(!postconditionChecks(mkCase({}, { branch: "FIGHT_AND_FLAG" }), state({ disputeStatus: "needs_response" })).every((x) => x.passed));
assert.ok(!postconditionChecks(mkCase({}, { branch: "FIGHT" }), state()).every((x) => x.passed)); // risk case must not exist for plain FIGHT
const awaiting = mkCase({ approval: { requiredFor: "ACCEPT", requestedAt: 1 } }, { branch: "ACCEPT", requiresApproval: true });
assert.ok(postconditionChecks(awaiting, state({ disputeStatus: "needs_response", evidencePopulated: false, slackApprovals: 1 })).every((x) => x.passed));

// --- eval assertions + metrics ---
{
  const s = scenarioByKey("chaos_drop_submit")!;
  const c = mkCase({ status: "resolved", verification: { passed: true, checks: [], at: 0 } }, { branch: "FIGHT_AND_FLAG" });
  c.actions.push({
    key: "k",
    action: "stripe.submit_evidence",
    state: "succeeded_verified",
    attempts: [
      { n: 1, idempotencyKey: "a1", at: 0, verified: false, httpStatus: 200 },
      { n: 2, idempotencyKey: "a2", at: 0, verified: true, httpStatus: 200 },
    ],
  });
  const a = assertScenario(s, c, state());
  assert.deepEqual(a.failures, []);
  assert.equal(a.stateConsistent, true);
  const bad = assertScenario(s, c, state({ slackDisputes: 2 }));
  assert.equal(bad.stateConsistent, false); // agent said verified, harness sees a duplicate post
  const m = computeMetrics([
    { scenario: s.key, passed: true, failures: [], expectedBranch: "FIGHT_AND_FLAG", branch: "FIGHT_AND_FLAG", finalStatus: "resolved", submitAttempts: 2, providerCalls: 20, forbiddenEffects: 0, stripeWriteUnexpected: false, constraintViolation: false, chaos: "drop_submit_once", stateConsistent: true, wallMs: 1000, at: 0 },
  ]);
  assert.equal(m.recoveryRate, 100);
  assert.equal(m.taskSuccessRate, 100);
}

console.log("selftest: all checks passed");
