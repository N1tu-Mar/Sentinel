// Offline check of the reliability core against the research fixtures: adapter parsing, policy, ledger/idempotency,
// chaos recovery, postconditions and eval assertions. No providers or LLM involved. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeMessage, stripQuoted, type RawMessage } from "@/adapters/gmail";
import { descriptionLine, isDeliveryRecord, setDescriptionLine } from "@/adapters/salesforce";
import { Chaos } from "@/agent/chaos";
import { createContext } from "@/agent/context";
import { runAction } from "@/agent/idempotency";
import { assertAllowed, PolicyViolation, stripeWriteBlocker } from "@/agent/policy";
import { fitEvidence } from "@/agent/tools";
import { postconditionChecks, type ExternalState } from "@/agent/verify";
import { SCENARIOS, scenarioByKey } from "@/domain/scenarios";
import type { Decision, DisputeCase, EvalResult, TimelineEvent } from "@/domain/types";
import { assertScenario, checkFixtureAssertion, computeMetrics, observedForbiddenEffects } from "@/eval/assertions";
import { getStore } from "@/store";

delete process.env.UPSTASH_REDIS_REST_URL;
const DAY = 86400_000;
const FIXTURE_NOW = Date.parse("2026-09-13T12:00:00Z");
const fixture = (path: string) => JSON.parse(readFileSync(`fixtures/${path}`, "utf8"));
const fast = { readbackDelayMs: 0, readbackIntervalMs: 0 };

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

// --- adapters on fixture payloads ---
{
  const msgs = (fixture("gmail/thread.receipt_confirmed.json").messages as RawMessage[]).map(decodeMessage);
  assert.match(msgs.at(-1)!.text, /thanks/i);
  assert.match(msgs[0].date, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(msgs.every((m) => m.from && m.subject));
  assert.equal(stripQuoted("Got it, thanks!\n\nOn Tue, 1 Sep 2026 at 12:00, Shop wrote:\n> Your order shipped"), "Got it, thanks!");

  const desc = fixture("salesforce/contact.json").Description as string;
  assert.equal(descriptionLine(desc, "RISK_FLAG"), "none");
  const flagged = setDescriptionLine(desc, "RISK_FLAG", "friendly_fraud");
  assert.equal(descriptionLine(flagged, "RISK_FLAG"), "friendly_fraud");
  assert.equal(descriptionLine(flagged, "LTV_CENTS"), "48200"); // other lines survive the rewrite
  assert.equal(setDescriptionLine(null, "RISK_FLAG", "friendly_fraud"), "RISK_FLAG: friendly_fraud");
  assert.ok(isDeliveryRecord(scenarioByKey("07")!.fixture.seed.salesforce.cases!.records[0].Description));
  assert.ok(!isDeliveryRecord(scenarioByKey("04")!.fixture.seed.salesforce.cases!.records[0].Description));

  const gate = (name: string) => {
    const d = fixture(`stripe/${name}.json`);
    return stripeWriteBlocker({ status: d.status, dueBy: d.evidence_details.due_by * 1000, pastDue: d.evidence_details.past_due }, FIXTURE_NOW);
  };
  assert.equal(gate("dispute.needs_response"), null);
  assert.equal(gate("dispute.warning_needs_response"), null);
  assert.match(gate("dispute.under_review")!, /not needs_response/);
  const late = scenarioByKey("08")!.fixture.seed.stripe.dispute;
  assert.match(stripeWriteBlocker({ status: late.status, dueBy: late.evidence_details.due_by * 1000, pastDue: late.evidence_details.past_due }, FIXTURE_NOW)!, /past_due/);

  const fitted = fitEvidence({ uncategorized_text: "x".repeat(25_000), product_description: "y".repeat(20_000), shipping_carrier: null });
  assert.ok(fitted.uncategorized_text.length <= 20_000 && !("shipping_carrier" in fitted));
  const many = fitEvidence(Object.fromEntries(["a", "b", "c", "d", "e", "f", "g", "uncategorized_text"].map((k) => [k, "z".repeat(20_000)])));
  assert.ok(Object.values(many).reduce((n, v) => n + v.length, 0) <= 150_000);
}

// --- policy ---
blocked(() => assertAllowed("stripe.submit_evidence", mkCase()), /record_decision/);
blocked(() => assertAllowed("stripe.submit_evidence", mkCase({}, { branch: "ASK_HUMAN" })), /requires FIGHT/);
blocked(() => assertAllowed("stripe.submit_evidence", mkCase({}, {}), { disputeStatus: "needs_response", dueBy: Date.now() - DAY }), /deadline passed/);
blocked(() => assertAllowed("stripe.submit_evidence", mkCase({}, {}), { disputeStatus: "needs_response", pastDue: true }), /past_due/);
blocked(() => assertAllowed("stripe.submit_evidence", mkCase({}, {}), { disputeStatus: "under_review" }), /not needs_response/);
blocked(() => assertAllowed("stripe.submit_evidence", mkCase({}, {}), { disputeStatus: "needs_response", submissionCount: 1 }), /already submitted/);
assert.doesNotThrow(() => assertAllowed("stripe.submit_evidence", mkCase({}, {}), { disputeStatus: "warning_needs_response", submissionCount: 0 }));
blocked(() => assertAllowed("stripe.accept_dispute", mkCase({}, { branch: "ACCEPT", requiresApproval: true })), /approval/);
assert.doesNotThrow(() =>
  assertAllowed("stripe.accept_dispute", mkCase({ approval: { requiredFor: "ACCEPT", requestedAt: 1, outcome: "approved" } }, { branch: "ACCEPT", requiresApproval: true })),
);
blocked(() => assertAllowed("salesforce.flag_contact", mkCase({}, { branch: "FIGHT_AND_FLAG" }), { priorDisputes: 1 }), /other disputes/);
blocked(() => assertAllowed("stripe.cancel_subscription", mkCase({}, { branch: "ACCEPT" }), { subscription: { customerId: "cus_other", status: "active" } }), /belong/);
assert.doesNotThrow(() => assertAllowed("slack.post", mkCase({}, { branch: "EXPIRED_OR_BLOCKED" })));

// --- ledger + chaos: dropped submit is caught by readback, retried once with a new key, then never re-sent ---
{
  const c = mkCase({ chaosMode: "drop_submit_once" }, { branch: "FIGHT" });
  const ctx = createContext(c, getStore(), new Chaos("drop_submit_once"), fast);
  const provider = { status: "needs_response", submissions: 0, sends: 0 };
  const spec = {
    action: "stripe.submit_evidence" as const,
    expected: "status under_review, submission_count = 1",
    live: async () => ({ disputeStatus: provider.status, dueBy: c.dispute.dueBy, submissionCount: provider.submissions }),
    perform: async () => {
      provider.sends++;
      if (!ctx.chaos.fire("stripe.submit_evidence")) Object.assign(provider, { status: "under_review", submissions: 1 });
    },
    verify: async () => ({
      passed: provider.status === "under_review" && provider.submissions === 1,
      observed: `dispute status = ${provider.status}, submission_count = ${provider.submissions}`,
    }),
  };
  const r1 = await runAction(ctx, spec);
  assert.equal(r1.verified, false);
  assert.match(r1.observed, /needs_response, submission_count = 0, expected status under_review/);
  const r2 = await runAction(ctx, spec);
  assert.equal(r2.verified, true);
  assert.equal(r2.attempt, 2);
  const r3 = await runAction(ctx, spec);
  assert.equal(r3.note, "already done and verified; no call made");
  assert.equal(provider.sends, 2);
  assert.deepEqual(
    c.actions[0].attempts.map((a) => a.idempotencyKey),
    ["sentinel:dp_test:submit_evidence:1", "sentinel:dp_test:submit_evidence:2"],
  );
  assert.equal(c.actions[0].state, "succeeded_verified");
  assert.ok((await getStore().getEvents(c.id)).some((e) => e.type === "recovery"));
}

// --- policy block never reaches the provider; max attempts enforced ---
{
  let sends = 0;
  const ctx = createContext(mkCase({}, { branch: "ASK_HUMAN" }), getStore(), new Chaos("none"), fast);
  const r = await runAction(ctx, { action: "stripe.submit_evidence", expected: "x", perform: async () => void sends++, verify: async () => ({ passed: false, observed: "x" }) });
  assert.match(r.observed, /^blocked:/);
  assert.equal(sends, 0);

  const ctx2 = createContext(mkCase({ id: "dp_two" }, { branch: "FIGHT" }), getStore(), new Chaos("none"), fast);
  const failing = { action: "slack.post" as const, target: "disputes", expected: "1", perform: async () => void sends++, verify: async () => ({ passed: false, observed: "0 messages" }) };
  await runAction(ctx2, failing);
  await runAction(ctx2, failing);
  assert.match((await runAction(ctx2, failing)).observed, /already attempted 2 times/);
  assert.equal(sends, 2);
}

// --- slack timeout: readback finds the delivered message instead of posting twice ---
{
  const ctx = createContext(mkCase({ id: "dp_three" }, { branch: "FIGHT" }), getStore(), new Chaos("slack_timeout_once"), fast);
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
  assert.equal(r1.verified, true);
  assert.equal(r1.ok, false);
  await runAction(ctx, spec);
  assert.equal(delivered, 1);
}

// --- postconditions ---
const state = (over: Partial<ExternalState> = {}): ExternalState => ({
  disputeStatus: "under_review",
  submissionCount: 1,
  evidenceText: "Customer communication: Got it, thanks!",
  trackingNumber: "1Z999AA10123450778",
  activeSubscriptions: 0,
  contactFound: true,
  contactDescription: "LTV_CENTS: 28800\nPRIOR_DISPUTES_90D: 0\nRISK_FLAG: none",
  riskFlag: "none",
  caseSubjects: ["Order JP-10407 delivered"],
  riskCases: 0,
  evidenceNeededCases: 0,
  followUpCases: 0,
  slack: { disputes: ["Fought the dispute"], risk: [], approvals: [] },
  ...over,
});
const allPass = (c: DisputeCase, s: ExternalState) => postconditionChecks(c, s).every((x) => x.passed);
assert.ok(allPass(mkCase({}, { branch: "FIGHT" }), state()));
assert.ok(allPass(mkCase({}, { branch: "FIGHT" }), state({ disputeStatus: "warning_under_review" })));
assert.ok(!allPass(mkCase({}, { branch: "FIGHT" }), state({ disputeStatus: "needs_response", submissionCount: 0 })));
assert.ok(!allPass(mkCase({}, { branch: "FIGHT_AND_FLAG" }), state())); // flag and risk case missing
const awaiting = mkCase({ approval: { requiredFor: "ACCEPT", requestedAt: 1 } }, { branch: "ACCEPT", requiresApproval: true });
assert.ok(allPass(awaiting, state({ disputeStatus: "needs_response", submissionCount: 0, slack: { disputes: [], risk: [], approvals: ["Needs approval"] } })));

// --- eval assertions from fixtures ---
{
  assert.equal(SCENARIOS.length, 8);
  assert.equal(scenarioByKey("04")!.needsApproval, true);
  assert.equal(scenarioByKey("03")!.needsApproval, false);
  const s7 = scenarioByKey("scenario-07")!;
  assert.equal(s7.expected, "FIGHT");
  assert.equal(s7.chaos, "drop_submit_once");

  const c = mkCase(
    { status: "resolved", verification: { passed: true, checks: [], at: 0 }, customer: { email: "alex.rivera@example.com", name: "Alex Rivera", stripeId: "cus_1" } },
    { branch: "FIGHT" },
  );
  c.actions.push({
    key: "k",
    action: "stripe.submit_evidence",
    state: "succeeded_verified",
    attempts: [
      { n: 1, idempotencyKey: "a1", at: 0, verified: false, httpStatus: 200 },
      { n: 2, idempotencyKey: "a2", at: 0, verified: true, httpStatus: 200 },
    ],
  });
  const events: TimelineEvent[] = [{ t: 0, type: "recovery", text: "retry" }];
  const good = assertScenario({ s: s7, c, state: state(), events });
  assert.deepEqual(good.failures, []);
  assert.equal(good.stateConsistent, true);

  const bad = assertScenario({ s: s7, c, state: state({ riskFlag: "friendly_fraud", slack: { disputes: ["x"], risk: ["y"], approvals: [] } }), events });
  assert.ok(bad.forbidden.includes("slack post to #risk") && bad.forbidden.some((f) => f.startsWith("Contact.Description")));
  assert.equal(bad.stateConsistent, false); // agent said verified, harness sees forbidden effects

  const s6 = scenarioByKey("06")!;
  const mention = s6.fixture.assertions.find((a) => a.check.startsWith("message mentions"))!;
  const askState = state({ slack: { disputes: ["Needs a human.\n- no delivery record in Salesforce\n- no email thread in Gmail"], risk: [], approvals: [] } });
  assert.equal(checkFixtureAssertion(mention, { s: s6, c, state: askState, events }), null);

  // every fixture assertion and forbidden effect maps to a real check
  for (const s of SCENARIOS) {
    for (const a of s.fixture.assertions) assert.ok(!checkFixtureAssertion(a, { s, c, state: state(), events })?.startsWith("unrecognized"), `${s.key}: ${a.check}`);
    assert.ok(!observedForbiddenEffects({ s, c, state: state(), events }).some((f) => f.startsWith("unrecognized")), s.key);
  }

  const r: EvalResult = {
    scenario: s7.key,
    passed: true,
    failures: [],
    expectedBranch: "FIGHT",
    branch: "FIGHT",
    finalStatus: "resolved",
    submitAttempts: 2,
    providerCalls: 20,
    forbiddenEffects: 0,
    stripeWriteUnexpected: false,
    constraintViolation: false,
    chaos: "drop_submit_once",
    stateConsistent: true,
    wallMs: 1000,
    at: 0,
  };
  const m = computeMetrics([r]);
  assert.equal(m.recoveryRate, 100);
  assert.equal(m.taskSuccessRate, 100);
}

// --- local sandbox: the real adapters over HTTP against a stateful Salesforce/Gmail/Slack stand-in ---
{
  const { createSandbox, sandboxEnv } = await import("@/sandbox/server");
  const sfa = await import("@/adapters/salesforce");
  const gm = await import("@/adapters/gmail");
  const sl = await import("@/adapters/slack");
  const { server } = createSandbox();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  Object.assign(process.env, sandboxEnv(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
  sl.clearChannelCache();

  const { id } = await sfa.createContact({ firstName: "Alex", lastName: "Rivera", email: "alex@example.com", description: "LTV_CENTS: 28800\nRISK_FLAG: none" });
  const contact = await sfa.findContactByEmail("alex@example.com");
  assert.equal(contact?.Id, id);
  await sfa.updateContact(id, { Description: sfa.setDescriptionLine(contact!.Description, "RISK_FLAG", "friendly_fraud") });
  const reread = await sfa.getContact(id);
  assert.equal(sfa.descriptionLine(reread.Description, "RISK_FLAG"), "friendly_fraud");
  assert.equal(sfa.descriptionLine(reread.Description, "LTV_CENTS"), "28800");
  await sfa.createCase({ contactId: id, subject: "Evidence needed: du_x", description: "- no delivery record in Salesforce" });
  assert.equal((await sfa.findCases(id, "Evidence needed: du_x")).length, 1);
  assert.equal((await sfa.listCasesForContact(id)).length, 1);

  const first = await gm.insertMessage({ from: "Alex <alex@example.com>", to: "support@juniperpine.example", subject: "Re: order", body: "Got it, thanks!", date: new Date("2026-09-08T12:00:00Z") });
  await gm.insertMessage({ from: "support@juniperpine.example", to: "alex@example.com", subject: "Re: order", body: "Glad it arrived.", date: new Date("2026-09-08T13:00:00Z"), threadId: first.threadId });
  const threads = await gm.searchThreads("alex@example.com", "2026/03/01");
  assert.equal(threads.length, 1);
  const thread = await gm.getThread(threads[0].id);
  assert.equal(thread.length, 2);
  assert.equal(thread[0].text, "Got it, thanks!");
  assert.equal(thread[0].date, "2026-09-08T12:00:00.000Z");
  assert.deepEqual(await gm.searchThreads("nobody@example.com"), []);

  const posted = await sl.post("disputes", "Dispute du_x: fought and verified");
  assert.equal((await sl.readback(posted.channel, posted.ts)).found, true);
  assert.equal((await sl.findMessages("disputes", "du_x")).length, 1);
  server.close();
}

console.log("selftest: all checks passed");
