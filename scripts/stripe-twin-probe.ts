import "./_env";
import { mkdir, writeFile } from "node:fs/promises";
import type Stripe from "stripe";
import { sleep } from "@/adapters/logged-fetch";
import { closeDispute, getDispute, idOf, stripe, submitEvidence } from "@/adapters/stripe";
import { errMsg } from "@/agent/idempotency";

// Kill Check #1 against a single Stripe twin (works on Arga's Free plan):
//   npm run provision -- --twins=stripe && npx tsx scripts/stripe-twin-probe.ts
// Can the twin create a dispute? Does submit=false leave it needs_response (the silent-failure case)?
// Does submit=true with a new key move it to under_review with submission_count 1? Does close → lost?
// Every response is saved to fixtures/live/stripe.probe.*.json.
const st = stripe();
const log: Record<string, unknown> = {};
const save = async (name: string, body: unknown) => {
  log[name] = body;
  await writeFile(`fixtures/live/stripe.probe.${name}.json`, `${JSON.stringify(body, null, 2)}\n`);
};
await mkdir("fixtures/live", { recursive: true });

const customer = await st.customers.create({ email: `probe+${Date.now().toString(36)}@example.com`, name: "Twin Probe" });

async function tryDispute(method: string): Promise<Stripe.Dispute | null> {
  try {
    const pm = method.startsWith("pm_")
      ? method
      : (await st.paymentMethods.create({ type: "card", card: { number: method, exp_month: 12, exp_year: 2030, cvc: "123" } })).id;
    const attached = await st.paymentMethods.attach(pm, { customer: customer.id });
    const pi = await st.paymentIntents.create({
      amount: 9600,
      currency: "usd",
      customer: customer.id,
      payment_method: attached.id,
      payment_method_types: ["card"],
      confirm: true,
      description: `probe via ${method}`,
    });
    const chargeId = idOf(pi.latest_charge);
    for (let i = 0; i < 15; i++) {
      const d = (await st.disputes.list({ charge: chargeId, limit: 1 })).data[0];
      if (d) return d;
      await sleep(1000);
    }
    console.log(`  ${method}: charge ${chargeId} (${pi.status}) produced no dispute`);
  } catch (e) {
    console.log(`  ${method}: ${errMsg(e)}`);
  }
  return null;
}

const results: Record<string, string> = {};
let dispute: Stripe.Dispute | null = null;
for (const method of ["pm_card_createDisputeProductNotReceived", "pm_card_createDispute", "4000000000002685", "4000000000000259", "pm_card_createDisputeInquiry"]) {
  const d = await tryDispute(method);
  results[method] = d ? `dispute ${d.id} status ${d.status} reason ${d.reason}` : "no dispute";
  console.log(`${d ? "✓" : "✗"} ${method}: ${results[method]}`);
  if (d && !dispute) dispute = d;
}
const existing = await st.disputes.list({ limit: 10 });
await save("disputes.list", existing);
if (!dispute) dispute = existing.data.find((d) => d.status === "needs_response") ?? null;

if (!dispute) {
  console.log("\nKill Check #1 FAILED: this Stripe twin produced no dispute. Fall back to real Stripe test mode for the Stripe adapter.");
} else {
  await save("dispute.created", dispute);
  const evidence = { uncategorized_text: "Probe narrative. Customer wrote: \"Got it, thanks!\"", shipping_tracking_number: "1Z999AA10123450778" };
  const id = dispute.id;
  const staged = await submitEvidence(id, evidence, { idempotencyKey: `sentinel:${id}:submit_evidence:1`, submit: false });
  const afterStaged = await getDispute(id);
  await save("dispute.after_submit_false", afterStaged);
  console.log(`\nsubmit=false  → HTTP ok, readback status ${afterStaged.status}, submission_count ${afterStaged.evidence_details?.submission_count} (expect needs_response, 0)`);
  console.log(`  update response status ${staged.status}`);

  const replay = await submitEvidence(id, evidence, { idempotencyKey: `sentinel:${id}:submit_evidence:1`, submit: false }).then(
    (r) => `replayed, status ${r.status}`,
    (e) => `error: ${errMsg(e)}`,
  );
  console.log(`same key, same params → ${replay}`);

  await submitEvidence(id, evidence, { idempotencyKey: `sentinel:${id}:submit_evidence:2`, submit: true });
  const afterSubmit = await getDispute(id);
  await save("dispute.after_submit_true", afterSubmit);
  console.log(`submit=true, new key → readback status ${afterSubmit.status}, submission_count ${afterSubmit.evidence_details?.submission_count} (expect under_review, 1)`);

  const again = await submitEvidence(id, evidence, { idempotencyKey: `sentinel:${id}:submit_evidence:3`, submit: true }).then(
    (r) => `accepted, status ${r.status}`,
    (e) => `rejected: ${errMsg(e)}`,
  );
  console.log(`third submit after under_review → ${again} (expect rejected)`);

  const second = await tryDispute("pm_card_createDispute");
  if (second) {
    await closeDispute(second.id, { idempotencyKey: `sentinel:${second.id}:accept_dispute:1` });
    const closed = await getDispute(second.id);
    await save("dispute.after_close", closed);
    console.log(`close → readback status ${closed.status} (expect lost)`);
  }
}
await writeFile("fixtures/live/stripe.probe.summary.json", `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`);
