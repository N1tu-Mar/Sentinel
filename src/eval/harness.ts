import * as slack from "@/adapters/slack";
import { ingestDispute, providerEnvironment } from "@/agent/cases";
import { errMsg } from "@/agent/idempotency";
import { decideApproval, runCase } from "@/agent/run";
import { readExternalState } from "@/agent/verify";
import { scenarioByKey } from "@/domain/scenarios";
import type { EvalResult } from "@/domain/types";
import { getStore } from "@/store";
import { assertScenario } from "./assertions";
import { applyTwinEnv, hasTwinRuns, provisionTwins, resetTwins } from "./arga";
import { locateScenario, seedScenario } from "./seed";

/**
 * reset → seed (or locate prompt-seeded data by email) → ingest → run (→ approve) → assert against provider state.
 * EVAL_SEED_MODE=prompt: twins were provisioned with the fixtures' scenario_prompt, so reset restores that data.
 */
export async function runScenario(key: string): Promise<EvalResult> {
  const s = scenarioByKey(key);
  if (!s) throw new Error(`unknown scenario ${key}`);
  const start = Date.now();
  const result: EvalResult = {
    scenario: s.key,
    passed: false,
    failures: [],
    expectedBranch: s.expected,
    submitAttempts: 0,
    providerCalls: 0,
    forbiddenEffects: 0,
    stripeWriteUnexpected: false,
    constraintViolation: false,
    chaos: s.chaos,
    environment: providerEnvironment(),
    stateConsistent: false,
    wallMs: 0,
    at: start,
  };
  try {
    // Free plan: twins live 10 minutes, so ARGA_REPROVISION=1 provisions fresh twins per scenario instead of resetting.
    if (process.env.SANDBOX_URL) {
      const reset = await fetch(`${process.env.SANDBOX_URL}/_sandbox/reset`, { method: "POST" });
      if (!reset.ok) throw new Error(`local sandbox reset failed: HTTP ${reset.status}`);
      slack.clearChannelCache();
    } else if (process.env.ARGA_REPROVISION === "1") applyTwinEnv((await provisionTwins()).env);
    else if (hasTwinRuns()) await resetTwins();
    const seeded = process.env.EVAL_SEED_MODE === "prompt" ? await locateScenario(s) : await seedScenario(s);
    const wantPastDue = s.fixture.seed.stripe.dispute.evidence_details.past_due;
    if (wantPastDue && seeded.dueBy !== null && seeded.dueBy > Date.now()) {
      result.skipped = "the Stripe backend could not seed a past evidence deadline";
    } else {
      const store = getStore();
      const created = await ingestDispute(seeded.disputeId, s.key);
      let c = await runCase(created.id, { chaosMode: s.chaos });
      let beforeApproval;
      if (c.status === "awaiting_approval") {
        beforeApproval = await readExternalState(c);
        if (s.needsApproval) c = await decideApproval(c.id, "approved", "eval-harness");
      }
      const state = await readExternalState(c);
      const a = assertScenario({ s, c, state, beforeApproval, events: await store.getEvents(c.id) });
      Object.assign(result, {
        passed: a.failures.length === 0,
        failures: a.failures,
        forbiddenObserved: a.forbidden,
        branch: c.decision?.branch,
        finalStatus: c.status,
        submitAttempts: a.submitAttempts,
        providerCalls: c.providerCalls,
        forbiddenEffects: a.forbidden.length,
        stripeWriteUnexpected: a.stripeWriteUnexpected,
        constraintViolation: a.constraintViolation,
        stateConsistent: a.stateConsistent,
        caseId: c.id,
        lemmaTraceId: c.lemmaTraceId,
      });
    }
  } catch (e) {
    result.failures.push(`harness error: ${errMsg(e)}`);
  }
  result.wallMs = Date.now() - start;
  await getStore().putEvalResult(result);
  return result;
}
