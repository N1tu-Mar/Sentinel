# Sentinel — system and reliability brief

## 1. System

Sentinel handles a Stripe chargeback end to end:

1. **Trigger**: a `needs_response` dispute is pulled from Stripe (Sync) or seeded from a scenario.
2. **Investigate**: Claude (`claude-sonnet-5`, AI SDK v7 tool loop, max 30 steps) chooses which tools to call.
3. **Decide**: it records one of five branches (FIGHT, FIGHT_AND_FLAG, ACCEPT, ASK_HUMAN, EXPIRED_OR_BLOCKED), citing evidence ids.
4. **Act**: action tools write to Stripe, Salesforce and Slack, each behind a policy check and an action ledger.
5. **Verify and recover**: every write is read back; failed readbacks are retried once with a new idempotency key, then escalated. A final, LLM-independent verification reads all three systems.

| System | Read | Written |
| --- | --- | --- |
| Stripe | dispute, charge, customer, prior disputes, charges, subscriptions | submit evidence, accept (close) dispute, cancel subscription |
| Salesforce | contact by email, cases (delivery notes) | follow-up / "Evidence needed" / risk cases, contact risk flag |
| Gmail | message search + full message bodies | — |
| Slack | channel history (readback) | summary, risk and approval posts |

## 2. How we know it works

Three independent layers:

1. **Per-action readback** (`src/agent/idempotency.ts`). After a write: wait 400 ms, read the provider up to 3 times, 1 s apart. The tool returns `{ ok, verified, attempt, observed }`, e.g. `dispute status = needs_response, evidence populated, expected status under_review with evidence populated`. A 200 alone never counts as success.
2. **Final postconditions** (`src/agent/verify.ts`). After the loop, regardless of what the model said, Sentinel reads Stripe, Salesforce and Slack and checks the end state the recorded decision implies. A case is `resolved` only if every check passes; otherwise `needs_attention`.
3. **External eval assertions** (`src/eval/assertions.ts`). The harness reads provider state itself (not the case store) and asserts branch, dispute status, evidence, subscription, case counts, Slack post counts, ledger attempts and forbidden effects.

**Ledger / idempotency.** One ledger entry per case per action (plus target, e.g. Slack channel). A verified action is never re-sent: a duplicate model call returns the stored observation. Stripe writes use `<case>:<action>:attempt<n>`; a retry gets a new key and is preceded by a readback, so a late-landing first attempt is recognised instead of repeated. Slack and Salesforce have no idempotency keys, so they always look before writing.

**Policy in code** (`src/agent/policy.ts`), checked against live provider state right before each write: no action before `record_decision`; submit only on FIGHT branches, only while `needs_response` and before `due_by`; accept only on ACCEPT and, above **$200 (20,000 cents)**, only after human approval; flag only on FIGHT_AND_FLAG with **≥ 2 prior disputes in 90 days**; **max 2 attempts** per action. A blocked call never reaches the provider. `record_evidence` only accepts refs that a tool actually returned in this run.

## 3. Failure handling

| Chaos mode | Injected | Expected behaviour |
| --- | --- | --- |
| `drop_submit_once` | First evidence update is sent without `submit=true` (saved as a draft, HTTP 200) | Readback sees `needs_response`; the agent diagnoses, retries with a new key; readback confirms `under_review` |
| `stripe_500_once` | First dispute readback throws a synthetic 500 | Readback loop reads again; timeline shows the recovery |
| `slack_timeout_once` | Post request goes out but the client stops waiting after 100 ms | Readback finds the delivered message; no second post |

Every injection emits a visible `chaos` event. Recovery rate comes from `eval/results.json`.

## 4. Evaluation

| # | Scenario | Chaos | Expected |
| --- | --- | --- | --- |
| 1 | receipt_confirmed_repeat | none | FIGHT_AND_FLAG |
| 2 | canceled_before_charge_small | none | ACCEPT + cancel subscription |
| 3 | canceled_before_charge_large | none | ACCEPT → approval → accepted |
| 4 | no_evidence | none | ASK_HUMAN |
| 5 | false_duplicate_claim | none | FIGHT |
| 6 | delivered_no_email_loyal | none | FIGHT |
| 7 | chaos_drop_submit | drop_submit_once | FIGHT_AND_FLAG, 2 submit attempts |
| 8 | deadline_passed | none | EXPIRED_OR_BLOCKED |

Per scenario: `arga.twins.reset(runId)` → seed → ingest → run (auto-approve for #3) → assert. Metrics: task success, decision accuracy, false-action rate, constraint-violation rate, recovery rate, state consistency, mean provider calls and wall time. `npm run eval` writes `eval/results.json` and `eval/results.md`; the numbers are whatever that run produced — see those files.

The policy, ledger, chaos-recovery, postcondition and assertion logic also has an offline check that needs no providers: `npm test`.

## 5. What we saw in Lemma

Every run sends one Lemma trace via `vercelAI()` from `@uselemma/tracing` (model calls and tool executions as child spans, with case id, scenario and chaos mode as metadata). The trace id is stored on the case and shown on the case page. Screenshot of scenario 7's trace: to be captured once `LEMMA_API_KEY` is configured.

## 6. Known limitations

- Evidence is text only: no receipts, carrier API or file uploads. Delivery proof comes from seeded CRM notes.
- Approval happens in Sentinel's UI, not via Slack interactivity.
- `deadline_passed` cannot be seeded on Stripe test mode or the public twin API (no way to backdate `due_by`); the harness marks it skipped rather than faking it. The policy guard for it is covered by `npm test`.
- Stripe dispute creation relies on dispute test payment methods; if the twin does not emulate them, Stripe runs on real test mode (hybrid).
- Dispute `reason` comes from the test card (`fraudulent` or `product_not_received`), not the scenario's nominal reason.
- Without Upstash Redis the case store is in-memory per process; on Vercel that means state does not survive across function instances.
- `stripe_500_once` is injected at Sentinel's readback, not by the twin.
