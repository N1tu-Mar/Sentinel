# Sentinel — system and reliability brief

## 1. System

Sentinel handles a Stripe chargeback for Juniper & Pine Outfitters end to end:

1. **Trigger**: an open dispute (`needs_response` / `warning_needs_response`) is pulled from Stripe (Sync), arrives by signed webhook, or is seeded from a scenario.
2. **Investigate**: Claude (`claude-sonnet-5`, AI SDK v7 tool loop, max 30 steps) chooses which tools to call.
3. **Decide**: it records one of five branches (FIGHT, FIGHT_AND_FLAG, ACCEPT, ASK_HUMAN, EXPIRED_OR_BLOCKED), citing evidence ids. The evidence playbook's decision gates and per-reason table are in the system prompt.
4. **Act**: action tools write to Stripe, Salesforce and Slack, each behind a policy check and an action ledger.
5. **Verify and recover**: every write is read back; a failed readback is retried once with a new idempotency key, then escalated. A final, LLM-independent verification reads all three systems.

| System | Read | Written |
| --- | --- | --- |
| Stripe | dispute, charge, customer, refunds, other disputes (created in 90 days, joined on charge.customer) | submit evidence, close (accept) dispute, cancel subscription |
| Salesforce | contact by email (`LTV_CENTS`, `PRIOR_DISPUTES_90D`, `RISK_FLAG` Description lines), cases from 180 days (delivery = `TRACKING:` + `DELIVERED:` lines) | `RISK_FLAG: friendly_fraud`, risk / "Evidence needed" / "Dispute accepted" cases |
| Gmail | threads `from:E OR to:E after:…`, decoded bodies with quoted replies stripped | — |
| Slack | channel history (ts readback) | #disputes, #risk, #dispute-approvals posts |

## 2. How we know it works

Three independent layers:

1. **Per-action readback** (`src/agent/idempotency.ts`). After a write: wait 400 ms, read the provider up to 3 times, 1 s apart. The tool returns `{ ok, verified, attempt, observed }`, e.g. `dispute status = needs_response, submission_count = 0, evidence populated, expected status under_review, submission_count = 1, evidence populated`. A 200 is never success on its own. Proofs: evidence submit ⇒ `under_review` and `submission_count == 1`; accept ⇒ `lost`; Salesforce flag ⇒ re-read `RISK_FLAG` line plus exactly one risk case; case create ⇒ exactly one case with that subject; Slack ⇒ `conversations.history oldest=ts inclusive limit=1` returns the posted ts, and exactly one message for the dispute.
2. **Final postconditions** (`src/agent/verify.ts`). After the loop, regardless of what the model said, Sentinel reads Stripe, Salesforce and Slack and checks the end state the recorded decision implies. A case is `resolved` only if every check passes; otherwise `needs_attention`.
3. **External eval assertions** (`src/eval/assertions.ts`). The harness reads provider state itself (not the case store) and evaluates every `assertions` entry and every `forbidden_effects` entry from the scenario fixture, plus branch, final status and verification.

**Ledger / idempotency.** One ledger entry per case per action (plus target, e.g. Slack channel). A verified action is never re-sent: a duplicate model call returns the stored observation. Keys are `sentinel:{dispute}:{action}:{attempt}`; a retry gets a new key because reusing one replays the first response, including a 200 that changed nothing. Before a retry, Sentinel re-reads: if the first attempt landed late it is recorded as done instead of repeated. Slack and Salesforce have no idempotency keys, so they always look before writing.

**Policy in code** (`src/agent/policy.ts`), against live provider state read right before each write: no action before `record_decision`; Stripe writes only while status is `needs_response`/`warning_needs_response`, `past_due` is false and `due_by` is in the future; submit only on FIGHT branches and only with `submission_count == 0`; accept only on ACCEPT and, above **$200 (20,000 cents)**, only after recorded human approval; flag only on FIGHT_AND_FLAG with **≥ 2 other disputes in 90 days**; **max 2 attempts** per action, never a third. Evidence respects Stripe's limits (20,000 chars per field, 150,000 total); quoted emails go in `uncategorized_text` because `customer_communication` is a file field. `record_evidence` only accepts refs a tool actually returned in this run.

## 3. Failure handling

| Chaos mode | Injected | Expected behaviour |
| --- | --- | --- |
| `drop_submit_once` | First evidence update is sent without `submit=true` (saved as draft, HTTP 200) | Readback sees `needs_response`, `submission_count 0`; the agent diagnoses, retries; Sentinel re-reads, sends with key `…:submit_evidence:2`; readback confirms `under_review`, count 1 |
| `stripe_500_once` | First dispute readback throws a synthetic 500 | Readback loop reads again; timeline shows the recovery |
| `slack_timeout_once` | Post request goes out but the client stops waiting after 100 ms | Readback finds the delivered message; no second post |

Every injection emits a visible `chaos` event. Every readback result and retry is also recorded as an explicit Lemma span (`verify.*` with `passed`, `recovery.retry` with old and new keys). Recovery rate comes from `eval/results.json`.

## 4. Evaluation

| Fixture | Scenario | Chaos | Expected |
| --- | --- | --- | --- |
| 01 | fight_receipt_confirmed ($89) | none | FIGHT |
| 02 | fight_delivery_and_email ($145) | none | FIGHT |
| 03 | accept_under_threshold_auto ($49) | none | ACCEPT |
| 04 | accept_over_threshold_needs_approval ($340) | none | ACCEPT after approval |
| 05 | friendly_fraud_repeat_disputer ($120) | none | FIGHT_AND_FLAG |
| 06 | ask_human_missing_evidence ($75) | none | ASK_HUMAN |
| 07 | injected_silent_submit_failure ($96) | drop_submit_once | FIGHT, 2 submit attempts |
| 08 | past_due_must_not_submit ($169) | none | EXPIRED_OR_BLOCKED |

Per scenario: `arga.twins.reset(runId)` → seed through the APIs (or locate prompt-seeded data by customer email) → ingest → run (approve for 04) → assert. Metrics: task success, decision accuracy, false-action rate, constraint-violation rate, recovery rate, state consistency, mean provider calls and wall time. `npm run eval` writes `eval/results.json` and `eval/results.md`; the numbers are whatever that run produced.

`npm test` checks adapters against the fixture payloads, the policy gates, the ledger and chaos recovery, the postconditions, and that every fixture assertion and forbidden effect maps to a real check — with no provider or model.

## 5. What we saw in Lemma

Every run sends one trace named `sentinel.dispute_run` (thread id = dispute id) via `vercelAI()` from `@uselemma/tracing`: model calls and tool executions, plus the verification and recovery spans above. The trace id is stored on the case and shown on the case page. Screenshot of scenario 07's trace: to be captured once `LEMMA_API_KEY` is configured.

## 6. Known limitations

- Evidence is text only: no file uploads, so file fields (`shipping_documentation`, `customer_communication`) stay empty.
- Approval happens in Sentinel's UI; Slack is notify-only (twin interactivity is undocumented).
- How the Stripe twin creates disputes is undocumented; the seeder tries test payment methods and cards and records which worked. Without one, Stripe runs on real test mode (hybrid).
- Under API seeding, scenario 08 cannot be seeded (no way to backdate `due_by`) and is reported as skipped. The past-due policy gate is covered by `npm test`.
- Without Upstash Redis the case store is in-memory per process; on Vercel that state does not survive across function instances.
- `stripe_500_once` is injected at Sentinel's readback, not by the twin.
- Final-verification checks run after the model call ends, so they are on the case and timeline but not in the Lemma trace.
