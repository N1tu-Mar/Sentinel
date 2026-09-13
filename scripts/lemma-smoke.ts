import "./_env";
import { anthropic } from "@ai-sdk/anthropic";
import { enableDebugMode, Lemma, vercelAI } from "@uselemma/tracing";
import { generateText, isStepCount, tool, type Telemetry } from "ai";
import { z } from "zod";
import { agentModel } from "@/agent/run";

// npm run lemma:smoke — one real AI SDK call with one tool, traced the same way runCase does
// (lemma.trace() handle + vercelAI({ trace }) + explicit end). Expect: trace handle created → sending trace → trace sent.
enableDebugMode();
if (!process.env.LEMMA_API_KEY || !process.env.LEMMA_PROJECT_ID) throw new Error("LEMMA_API_KEY and LEMMA_PROJECT_ID are required");

const prompt = "Smoke test: call get_dispute_status for du_smoke, then answer with the status in one word.";
const metadata = { threadId: "du_smoke", scenario: "smoke" };
const trace = new Lemma().trace({ name: "sentinel.dispute_run", input: prompt, threadId: "du_smoke", metadata });
const lemma = vercelAI({ trace, agentName: "sentinel.dispute_run", metadata });
// Spans must be recorded before the AI SDK run ends: the integration sends the trace from its terminal callback.
trace.recordSpan({ name: "verify.smoke", input: { expected: "under_review" }, output: { observed: "under_review", passed: true } });

try {
  const result = await generateText({
    model: anthropic(agentModel()),
    prompt,
    tools: {
      get_dispute_status: tool({
        description: "Returns a fixed dispute status for the smoke test.",
        inputSchema: z.object({ disputeId: z.string() }),
        execute: async ({ disputeId }) => ({ disputeId, status: "under_review" }),
      }),
    },
    stopWhen: isStepCount(3),
    telemetry: { isEnabled: true, functionId: "sentinel.dispute_run", integrations: [lemma as unknown as Telemetry] },
  });
  await lemma.flush();
  console.log(`integration ended trace: ${trace.isEnded}`);
  if (!trace.isEnded) await trace.end({ output: result.text });
  console.log(`model answered: ${result.text}\ntrace id: ${trace.id}`);
} catch (e) {
  await lemma.fail(e);
  await lemma.flush();
  if (!trace.isEnded) await trace.end({ output: { error: String(e) } });
  throw e;
}
