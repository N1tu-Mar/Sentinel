import { anthropic } from "@ai-sdk/anthropic";
import { Lemma, vercelAI } from "@uselemma/tracing";
import { generateText, isStepCount, type Telemetry } from "ai";
import { callSink } from "@/adapters/logged-fetch";
import type { ChaosMode, DisputeCase, ProviderCall } from "@/domain/types";
import { getStore } from "@/store";
import { Chaos } from "./chaos";
import { createContext, type RunContext } from "./context";
import { errMsg } from "./idempotency";
import { approvalMessage, initialUserMessage, SYSTEM_PROMPT } from "./prompt";
import { buildTools, money, postToSlack } from "./tools";
import { verifyPostconditions } from "./verify";

export const agentModel = () => process.env.AGENT_MODEL ?? "claude-sonnet-5";

let lemmaClient: Lemma | undefined; // one shared server-side client (reads LEMMA_API_KEY / LEMMA_PROJECT_ID)

const sinkFor = (ctx: RunContext) => (call: ProviderCall) => void ctx.emit({ type: "provider_call", ...call });

export interface RunOptions {
  chaosMode?: ChaosMode;
  resume?: "post_approval";
  timing?: RunContext["timing"];
}

/** Load case → LLM tool loop → independent final verification → resolve. */
export async function runCase(caseId: string, opts: RunOptions = {}): Promise<DisputeCase> {
  const store = getStore();
  const c = await store.getCase(caseId);
  if (!c) throw new Error(`case ${caseId} not found`);
  if (!opts.resume) {
    Object.assign(c, {
      evidence: [],
      decision: undefined,
      actions: [],
      approval: undefined,
      verification: undefined,
      finalSummary: undefined,
      lemmaTraceId: undefined,
      providerCalls: 0,
      forbiddenEffects: 0,
      chaosMode: opts.chaosMode ?? "none",
    });
    await store.clearEvents(c.id);
  }
  const ctx = createContext(c, store, new Chaos(opts.resume ? "none" : c.chaosMode), opts.timing);
  c.status = "running";
  await ctx.emit({ type: "status", status: "running" });
  await ctx.save();

  const lemmaOn = !!(process.env.LEMMA_API_KEY && process.env.LEMMA_PROJECT_ID);
  const prompt = opts.resume
    ? [
        initialUserMessage(c),
        `Recorded decision:\n${JSON.stringify(c.decision, null, 2)}`,
        `Evidence:\n${c.evidence.map((e) => `${e.id} [${e.source}/${e.kind}] ${e.summary}`).join("\n")}`,
        approvalMessage(c.approval?.by ?? "a human", c.approval?.decidedAt ?? Date.now()),
      ].join("\n\n")
    : initialUserMessage(c);

  // Lemma (lemma-tracing skill, Vercel AI SDK path): a fresh vercelAI() per run, attached to a lemma.trace() handle
  // so the trace id can be shown on the case and readback/recovery spans land under the same root. The integration
  // sends the root when the AI SDK run ends (verified with npm run lemma:smoke); the explicit end() below only covers
  // a run that never reached that callback. threadId = dispute id groups the approval resume with the first run.
  const metadata = { threadId: c.id, disputeId: c.id, scenario: c.scenario ?? "", chaosMode: c.chaosMode, attempt: opts.resume ? 2 : 1 };
  const trace = lemmaOn ? (lemmaClient ??= new Lemma()).trace({ name: "sentinel.dispute_run", input: prompt, threadId: c.id, metadata }) : undefined;
  const lemma = trace ? vercelAI({ trace, agentName: "sentinel.dispute_run", metadata }) : undefined;
  if (trace) {
    c.lemmaTraceId = trace.id;
    ctx.trace = trace;
  }

  try {
    await callSink.run(sinkFor(ctx), async () => {
      const result = await generateText({
        model: anthropic(agentModel()),
        system: SYSTEM_PROMPT,
        prompt,
        tools: buildTools(ctx),
        stopWhen: [isStepCount(30), () => ctx.halted],
        telemetry: {
          isEnabled: lemmaOn,
          functionId: "sentinel.dispute_run",
          // Lemma types the integration against both AI SDK v6 and v7 events; runtime supports v7 (per its README).
          integrations: lemma ? [lemma as unknown as Telemetry] : undefined,
        },
        onLanguageModelCallEnd: async (e) => {
          for (const p of e.content)
            if (p.type === "text" && p.text.trim()) await ctx.emit({ type: "thought", text: p.text.trim() });
        },
        onToolExecutionStart: async (e) => {
          await ctx.emit({ type: "tool_call", tool: e.toolCall.toolName, input: e.toolCall.input });
        },
        onToolExecutionEnd: async (e) => {
          const out = (e.toolOutput.type === "tool-result" ? e.toolOutput.output : { error: errMsg(e.toolOutput.error) }) as {
            ok?: boolean;
            error?: string;
            observed?: string;
          } | null;
          await ctx.emit({
            type: "tool_result",
            tool: e.toolCall.toolName,
            ok: out?.ok !== false && !out?.error,
            summary: (out?.error ?? out?.observed ?? JSON.stringify(out) ?? "").slice(0, 240),
          });
        },
      });
      c.finalSummary = result.text;
    });
    await lemma?.flush();
  } catch (err) {
    await lemma?.fail(err);
    await lemma?.flush();
    if (trace && !trace.isEnded) await trace.end({ output: { status: "failed", error: errMsg(err) } });
    c.status = "failed";
    await ctx.emit({ type: "error", text: `Agent loop failed: ${errMsg(err)}` });
    await ctx.emit({ type: "status", status: "failed" });
    await ctx.save();
    return c;
  }

  await finalize(ctx);
  if (trace && !trace.isEnded)
    await trace.end({ output: { summary: c.finalSummary, status: c.status, verificationPassed: c.verification?.passed } });
  return c;
}

/** Independent final verification — does NOT trust the LLM's claim of success. */
async function finalize(ctx: RunContext) {
  const { c } = ctx;
  try {
    const v = await callSink.run(sinkFor(ctx), () => verifyPostconditions(c));
    c.verification = { passed: v.passed, checks: v.checks, at: v.at };
    const failed = v.checks.filter((x) => !x.passed);
    for (const x of failed)
      await ctx.emit({ type: "verify", action: `Final: ${x.check}`, expected: x.expected, observed: x.observed, passed: false });
    await ctx.emit({
      type: "verify",
      action: "Final verification across Stripe, Salesforce and Slack",
      expected: `${v.checks.length} checks pass`,
      observed: `${v.checks.length - failed.length}/${v.checks.length} passed`,
      passed: v.passed,
    });
  } catch (e) {
    c.verification = {
      passed: false,
      checks: [{ system: "sentinel", check: "Final verification ran", expected: "yes", observed: errMsg(e), passed: false }],
      at: Date.now(),
    };
    await ctx.emit({ type: "error", text: `Final verification could not run: ${errMsg(e)}` });
  }
  const awaiting = c.decision?.requiresApproval && !c.approval?.outcome && c.approval?.requestedAt;
  c.status = !c.verification.passed ? "needs_attention" : awaiting ? "awaiting_approval" : "resolved";
  await ctx.emit({ type: "status", status: c.status });
  await ctx.save();
}

export async function decideApproval(caseId: string, outcome: "approved" | "rejected", by: string): Promise<DisputeCase> {
  const store = getStore();
  const c = await store.getCase(caseId);
  if (!c || c.status !== "awaiting_approval" || !c.approval) throw new Error(`case ${caseId} is not awaiting approval`);
  c.approval = { ...c.approval, outcome, by, decidedAt: Date.now() };
  await store.appendEvent(c.id, { t: Date.now(), type: outcome === "approved" ? "approval_granted" : "approval_rejected" });
  await store.putCase(c);
  if (outcome === "approved") return runCase(caseId, { resume: "post_approval" });

  // Rejected: no Stripe action. Tell the team, then verify the untouched end state.
  const ctx = createContext(c, store, new Chaos("none"));
  c.decision = { ...c.decision!, note: `rejected by ${by}` };
  await callSink.run(sinkFor(ctx), () =>
    postToSlack(ctx, "disputes", `Accept of ${money(c.dispute.amount)} dispute ${c.id} was rejected by ${by}. No Stripe action taken.`),
  );
  await finalize(ctx);
  return c;
}
