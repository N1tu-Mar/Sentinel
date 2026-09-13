import { ingestDispute } from "@/agent/cases";
import { errMsg } from "@/agent/idempotency";
import { decideApproval, runCase } from "@/agent/run";
import { readExternalState } from "@/agent/verify";
import { scenarioByKey } from "@/domain/scenarios";
import type { EvalResult } from "@/domain/types";
import { getStore } from "@/store";
import { assertScenario } from "./assertions";
import { resetTwins, seedScenario } from "./seed";

/** reset → seed → ingest → run (→ approve) → assert against provider state (not the case store). */
export async function runScenario(key: string): Promise<EvalResult> {
  const s = scenarioByKey(key);
  if (!s) throw new Error(`unknown scenario ${key}`);
  const start = Date.now();
  const result: EvalResult = {
    scenario: key,
    passed: false,
    failures: [],
    expectedBranch: s.expected,
    submitAttempts: 0,
    providerCalls: 0,
    forbiddenEffects: 0,
    stripeWriteUnexpected: false,
    constraintViolation: false,
    chaos: s.chaos,
    stateConsistent: false,
    wallMs: 0,
    at: start,
  };
  try {
    if (process.env.ARGA_TWIN_RUN_ID) await resetTwins();
    const seeded = await seedScenario(s);
    if (s.stripe.deadlinePassed && seeded.notes.length) {
      result.skipped = seeded.notes.join("; ");
    } else {
      const created = await ingestDispute(seeded.disputeId, s.key);
      let c = await runCase(created.id, { chaosMode: s.chaos });
      if (c.status === "awaiting_approval" && s.autoApprove) c = await decideApproval(c.id, "approved", "eval-harness");
      const a = assertScenario(s, c, await readExternalState(c));
      Object.assign(result, {
        passed: a.failures.length === 0,
        failures: a.failures,
        branch: c.decision?.branch,
        finalStatus: c.status,
        submitAttempts: a.submitAttempts,
        providerCalls: c.providerCalls,
        forbiddenEffects: c.forbiddenEffects,
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
