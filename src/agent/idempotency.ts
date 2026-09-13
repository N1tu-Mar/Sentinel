import { HttpError, sleep } from "@/adapters/logged-fetch";
import type { ActionName, ActionRecord, ActionResult, DisputeCase } from "@/domain/types";
import type { RunContext } from "./context";
import { assertAllowed, POLICY, PolicyViolation, type GuardedAction, type LiveState } from "./policy";

export const SKIPPED_NOTE = "already present; write skipped";
/** Attempts that actually sent a write to the provider (excludes readback-before-write skips). */
export const sentAttempts = (rec: ActionRecord | undefined) => rec?.attempts.filter((a) => a.note !== SKIPPED_NOTE) ?? [];

export const errMsg =(e: unknown) => (e instanceof Error ? e.message : String(e));

/** One logical action per case per type (+ target, e.g. a Slack channel or a Salesforce case kind). */
export function ledger(c: DisputeCase, action: ActionName, target?: string): ActionRecord {
  const key = target ? `${c.id}:${action}:${target}` : `${c.id}:${action}`;
  let rec = c.actions.find((a) => a.key === key);
  if (!rec) {
    rec = { key, action, attempts: [], state: "pending" };
    c.actions.push(rec);
  }
  return rec;
}

export interface Observation {
  passed: boolean;
  observed: string;
}

/** Readback after a write: 400 ms delay, then up to 3 reads 1 s apart to tolerate eventual consistency. */
export async function readback(ctx: RunContext, label: string, verify: () => Promise<Observation>): Promise<Observation> {
  await sleep(ctx.timing.readbackDelayMs);
  let last: Observation = { passed: false, observed: "no readback" };
  for (let i = 0; i < 3; i++) {
    try {
      last = await verify();
      if (last.passed) return last;
    } catch (e) {
      last = { passed: false, observed: `readback error: ${errMsg(e)}` };
      await ctx.emit({ type: "recovery", text: `Readback for ${label} failed (${errMsg(e)}); reading again` });
    }
    if (i < 2) await sleep(ctx.timing.readbackIntervalMs);
  }
  return last;
}

export interface ActionSpec {
  action: ActionName;
  target?: string;
  guard?: GuardedAction;
  expected: string; // human-readable expected end state
  live?: () => Promise<LiveState>; // fresh provider state for the policy check
  checkBeforeWrite?: boolean; // Slack/Salesforce have no idempotency keys: look before writing
  perform: (attempt: number, idempotencyKey: string) => Promise<void>;
  verify: () => Promise<Observation>;
}

/** precondition → ledger check → (chaos inside perform) → call → readback verify → record */
export async function runAction(ctx: RunContext, spec: ActionSpec): Promise<ActionResult> {
  const { c } = ctx;
  const rec = ledger(c, spec.action, spec.target);
  const label = spec.target ? `${spec.action} (${spec.target})` : spec.action;

  if (rec.state === "succeeded_verified")
    return {
      ok: true,
      verified: true,
      attempt: rec.attempts.length,
      observed: rec.observed ?? "",
      note: "already done and verified; no call made",
    };

  if (rec.attempts.length >= POLICY.maxAttemptsPerAction) {
    rec.state = "failed";
    await ctx.save();
    return {
      ok: false,
      verified: false,
      attempt: rec.attempts.length,
      observed: `blocked: ${label} already attempted ${rec.attempts.length} times; call escalate_to_human`,
    };
  }

  const n = rec.attempts.length + 1;
  const idempotencyKey = `${rec.key}:attempt${n}`;

  // Readback-before-write. On a retry it runs before the policy check: a late-landing first attempt
  // (e.g. dispute now under_review) is recognised as done instead of being blocked or re-sent.
  const preCheck = async (): Promise<ActionResult | null> => {
    const pre = await spec.verify().catch((e): Observation => ({ passed: false, observed: errMsg(e) }));
    if (!pre.passed) return null;
    rec.attempts.push({ n, idempotencyKey, at: Date.now(), verified: true, note: SKIPPED_NOTE });
    rec.state = "succeeded_verified";
    rec.observed = pre.observed;
    await ctx.emit({ type: "verify", action: label, expected: spec.expected, observed: pre.observed, passed: true });
    await ctx.save();
    return { ok: true, verified: true, attempt: n, observed: pre.observed, note: "already present; not sent again" };
  };

  if (n > 1) {
    const done = await preCheck();
    if (done) return done;
  }

  try {
    assertAllowed(spec.guard ?? spec.action, c, spec.live ? await spec.live() : {});
  } catch (e) {
    if (!(e instanceof PolicyViolation)) throw e;
    return { ok: false, verified: false, attempt: rec.attempts.length, observed: `blocked: ${e.message}` };
  }

  if (spec.checkBeforeWrite && n === 1) {
    const done = await preCheck();
    if (done) return done;
  }

  if (n > 1) await ctx.emit({ type: "recovery", text: `Retrying ${label} with a new idempotency key ${idempotencyKey}` });
  await ctx.emit({ type: "action", action: spec.action, attempt: n, idempotencyKey });
  const attempt: ActionRecord["attempts"][number] = { n, idempotencyKey, at: Date.now(), verified: false };
  rec.attempts.push(attempt);
  try {
    await spec.perform(n, idempotencyKey);
    attempt.httpStatus = 200;
  } catch (e) {
    const status = e instanceof HttpError ? e.status : (e as { statusCode?: number }).statusCode;
    attempt.httpStatus = status;
    attempt.note = errMsg(e);
  }

  const v = await readback(ctx, label, spec.verify);
  attempt.verified = v.passed;
  rec.observed = v.observed;
  rec.state = v.passed ? "succeeded_verified" : n >= POLICY.maxAttemptsPerAction ? "failed" : "pending";
  await ctx.emit({ type: "verify", action: label, expected: spec.expected, observed: v.observed, passed: v.passed });
  await ctx.save();
  return {
    ok: !attempt.note,
    verified: v.passed,
    attempt: n,
    observed: v.passed ? v.observed : `${v.observed}, expected ${spec.expected}`,
    note: attempt.note,
  };
}
