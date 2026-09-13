# Lemma tracing

Sources: https://github.com/uselemma/skills (archived 2026-07-01, moved) → https://github.com/uselemma/lemma `skills/lemma-tracing/SKILL.md` (V, opened). docs.uselemma.com did not resolve.

- Install skill: `npx skills add uselemma/lemma --skill "skills/lemma-tracing"` (V).
- Packages: TS `@uselemma/tracing`, Python `uselemma-tracing` (V).
- Env: `LEMMA_API_KEY`, `LEMMA_PROJECT_ID`, `LEMMA_DEBUG=1` optional; endpoint default `https://api.uselemma.ai` (V). Server-only — never `NEXT_PUBLIC_*` (V).
- Vercel AI SDK v6/v7: built-in `vercelAI()` integration inside AI SDK telemetry config; it creates + finalizes the root trace automatically — **do not wrap in `lemma.trace(...)`** (V). Exact import/registration code: U — run the skill or read `@uselemma/tracing` README in node_modules after install.
- Manual API (non-integration work, e.g. our readback verifier): `recordGeneration() / recordTool() / recordSpan()` for finished work; `startSpan()/startTool()` + `.end()` for in-flight (V).
- Grouping: one agent execution = one root trace with **stable `name`**; share `threadId`/`userId` across related runs (V).

## How we should use it
- Root trace name stable: `sentinel.dispute_run`. Per run: `threadId = dispute id`, metadata `{scenario: "scenario-07", chaos_mode, branch}` via AI SDK `experimental_telemetry.metadata`.
- Eval: each scenario run = own execution ⇒ own trace; `threadId = scenario-XX:<dispute id>`.
- Recovery visibility: record readback as tool span `stripe.verify_dispute` with attrs `{expected:"under_review", observed:"needs_response", passed:false}` then span `recovery.resubmit {idempotency_key_old, idempotency_key_new}`. Failed verify must be an explicit span with `passed:false`, not a swallowed log, so an audit sees a caught issue + fix.
- "Instructions" / audit-against-instructions feature: **U** (not in pages opened). Draft instruction set to paste if the product has it: (1) never submit evidence after `due_by`; (2) every write followed by readback; (3) never close a dispute > $200 without recorded approval; (4) never reuse an idempotency key after a failed readback; (5) at most one successful evidence submission per dispute.
