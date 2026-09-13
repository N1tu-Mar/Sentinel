# Vercel AI SDK (short)

Docs: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling , /generating-text , /telemetry , https://ai-sdk.dev/providers/ai-sdk-providers/anthropic (K — not re-opened; check installed version in `node_modules/ai/package.json`, APIs below are v5+).

```ts
import { generateText, streamText, tool, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic"; // reads ANTHROPIC_API_KEY
import { z } from "zod";

const getDispute = tool({
  description: "Read a Stripe dispute",
  inputSchema: z.object({ disputeId: z.string() }), // v4 used `parameters`
  execute: async ({ disputeId }) => stripe.disputes.retrieve(disputeId),
});

const result = streamText({
  model: anthropic(process.env.AGENT_MODEL ?? "claude-sonnet-5"),
  system, prompt,
  tools: { getDispute /* … */ },
  stopWhen: stepCountIs(25),            // v4: maxSteps
  experimental_telemetry: { isEnabled: true, functionId: "sentinel.dispute_run", metadata: { disputeId, scenario } },
  onStepFinish: ({ toolCalls, toolResults }) => timeline.push(...),
});
```
- Streaming to UI: route handler `return result.toUIMessageStreamResponse()`; client `useChat` sees tool parts `tool-<name>` with states `input-available` / `output-available` (v5, K). Or iterate `result.fullStream` for `tool-call` / `tool-result` events and push to your own SSE/Redis timeline.
- Model IDs (current, from system context): `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`. Keep `AGENT_MODEL` override.
- Guardrails belong in `execute` (code), not prompt: throw/return `{ok:false, reason}` when policy blocks.
