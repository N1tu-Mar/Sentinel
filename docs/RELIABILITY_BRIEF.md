# Sentinel — system and reliability brief

## 1. System

Sentinel handles a Stripe chargeback for Juniper & Pine Outfitters end to end:

1. **Trigger**: an open dispute is pulled from Stripe (Sync), seeded from a scenario, or arrives by signed webhook.
2. **Investigate**: Claude (`claude-sonnet-5`, AI SDK v7 tool loop, max 30 steps) chooses which tools to call. The evidence playbook's decision gates and per-reason table are in the system prompt.
3. **Decide**: one branch (FIGHT, FIGHT_AND_FLAG, ACCEPT, ASK_HUMAN, EXPIRED_OR_BLOCKED), citing evidence ids that must refer to records a tool returned.
4. **Act**: Stripe, Salesforce and Slack writes, each behind a policy check and an action ledger.
5. **Verify and recover**: every write is read back; a failed readback is re-read and retried once with a new idempotency key, then escalated. A final LLM-independent check reads all three systems.

| System | Read | Written | Backend for results |
| --- | --- | --- | --- |
| Stripe | dispute, charge, customer, refunds, other disputes (90 days, joined on charge.customer) | submit evidence, close dispute, cancel subscription | Real Stripe test mode |
| Salesforce | contact (`RISK_FLAG`, `LTV_CENTS` Description lines), cases (delivery = `TRACKING:` + `DELIVERED:`) | risk flag, risk / "Evidence needed" / "Dispute accepted" cases | Arga twin or Sentinel sandbox |
| Gmail | threads to/from the customer, decoded, quoted replies stripped | — | Arga twin or Sentinel sandbox |
| Slack | channel history (ts readback) | #disputes, #risk, #dispute-approvals | Arga twin or Sentinel sandbox |

**Why the split.** Kill Check #1 failed on the Arga Stripe twin. Dispute test cards, scenario prompts and `/_twin/seed` all created no dispute, and `/v1/charges/{id}/dispute` returned a stub that `/v1/disputes` never lists (`fixtures/live/`). Stripe therefore runs on real test mode, as the brief's fallback prescribes. The Arga free plan allows one twin per run for 10 minutes, and this account's monthly runs were used up during the build. Salesforce, Gmail and Slack therefore also run against Sentinel's sandbox (`src/sandbox/server.ts`), which serves the API subset the adapters call with the shapes observed on live twins. Every result is labeled with its environment and stored separately.

## 2. How we know it works

1. **Per-action readback** (`src/agent/idempotency.ts`). After a write: wait 400 ms, then read up to 3 times, 1 s apart. The tool returns `{ ok, verified, attempt, observed }`, e.g. `dispute status = needs_response, submission_count = 0, expected status under_review, submission_count = 1`. Proofs: evidence ⇒ `under_review` and `submission_count == 1`; accept ⇒ `lost`; flag ⇒ re-read `RISK_FLAG` plus exactly one risk case; case ⇒ exactly one with that subject; Slack ⇒ history returns the posted `ts`.
2. **Final postconditions** (`src/agent/verify.ts`). After the loop, regardless of what the model said, Sentinel reads Stripe, Salesforce and Slack and checks the end state the decision implies. `resolved` only if every check passes.
3. **External eval assertions** (`src/eval/assertions.ts`). The harness reads provider state itself and evaluates every `assertions` and `forbidden_effects` entry of the scenario fixture, plus branch, final status and the agent's own verdict.

**Ledger / idempotency.** One entry per case per action. Verified actions are never re-sent. Keys are `sentinel:{dispute}:{action}:{attempt}`; a retry uses a new key because reusing one replays the first response. Before a retry Sentinel re-reads, so a late-landing write is recorded as done. Slack and Salesforce look before writing.

**Policy in code** (`src/agent/policy.ts`), against live provider state read right before each write:
- No action before `record_decision`.
- Stripe writes only while status is `needs_response`/`warning_needs_response`, `past_due` is false and `due_by` is in the future.
- Submit only on FIGHT branches with `submission_count == 0`.
- Accept only on ACCEPT, and above **$200** only after recorded human approval.
- Flag only on FIGHT_AND_FLAG with **≥ 2 other disputes in 90 days**.
- **Max 2 attempts** per action.
- Evidence respects Stripe's 20,000/150,000-character limits; quoted emails go in `uncategorized_text`.

## 3. Failure handling

| Chaos mode | Injected | Behaviour |
| --- | --- | --- |
| `drop_submit_once` | First evidence update sent without `submit=true` (draft, HTTP 200) | Readback sees `needs_response`, 0 submissions; agent diagnoses and retries; Sentinel re-reads and sends key `…:submit_evidence:2`; readback confirms `under_review`, 1 submission |
| `stripe_500_once` | First dispute readback throws a synthetic 500 | Readback loop reads again |
| `slack_timeout_once` | Post goes out but the client stops waiting after 100 ms | Readback finds the delivered message; no second post |

Live-provider issues found and handled during the build:
- Stripe test mode returns `429 lock_timeout` on a just-created dispute; the SDK retries those.
- The Salesforce twin rejects `Contact.Description` in SOQL but returns it on the record, so contacts are read by id.
- The Salesforce twin returns zero rows for `LAST_N_DAYS` instead of an error, so the date window is applied in code.
- The Gmail twin stamps inserted mail with its own clock, so dates come from the Date header.

## 4. Evaluation

Per scenario: reset (Arga `twins.reset` or sandbox reset) → seed from `fixtures/scenarios/` → ingest → run (approve 04) → assert.

| # | Scenario | Expected | Sandbox result |
| --- | --- | --- | --- |
| 01 | Customer confirmed delivery | FIGHT | pass |
| 02 | Delivery record + customer email | FIGHT | pass |
| 03 | Canceled before charge, $49 | ACCEPT | pass |
| 04 | Canceled before charge, $340 | ACCEPT after approval | pass |
| 05 | Repeat disputer | FIGHT_AND_FLAG | pass |
| 06 | Missing evidence | ASK_HUMAN | pass |
| 07 | Evidence saved as draft (injected) | FIGHT, 2 submit attempts | pass |
| 08 | Deadline passed | EXPIRED_OR_BLOCKED | skipped: Stripe test mode cannot seed a past deadline |

**Stripe test mode + Sentinel sandbox:** task success 7/7, decision accuracy 100%, false-action rate 0%, constraint-violation rate 0%, recovery 100% (1 chaos scenario), state consistency 100%, mean 31 provider calls and 44 s per scenario (`eval/results.json`). Scenario 01 also passes on the deployed app against the hosted sandbox.

**Stripe test mode + Arga twins:** full eval not run (quota). Scenario 07 ran once end to end on live twins (`docs/evidence/scenario-07-live-run.log`). The dropped submit was caught, retried with key `:2` and verified, and the Slack post was confirmed by ts. The final check then failed on the Salesforce SOQL quirk above, which is now fixed.

`npm test` covers the policy gates (including past-due), the ledger and chaos recovery, the postconditions, every fixture assertion mapping, and the adapters over HTTP.

## 5. What we see in Lemma

Every run is one trace named `sentinel.dispute_run`, with the dispute id as thread id, created via `vercelAI()` on a `lemma.trace()` handle. It records model generations, tool calls, and explicit `verify.<action>` spans with `passed` plus `recovery.retry` spans carrying the old and new idempotency keys, so scenario 07's caught failure and fix are visible as spans. Delivery is verified: `npm run lemma:smoke` logs `trace sent` (HTTP 201) with the expected span count. The trace id is shown on each case.

## 6. Known limitations

- The full Arga-twin evaluation has not run (free-plan quota). The sandbox results are labeled as such and never shown as twin results.
- Stripe runs on real test mode because the twin cannot create disputes; scenario 08 cannot be seeded there.
- The hosted sandbox stores each system as one Redis value, so concurrent runs can overwrite each other. One run at a time is safe.
- Evidence is text only (no file uploads). Approval happens in Sentinel's UI; Slack is notify-only.
- The final cross-system check runs after the Lemma trace is sent, so it is on the case timeline but not in the trace.
- `stripe_500_once` is injected at Sentinel's readback, not by a provider.
- The deployed app has no authentication, by design for the demo, so anyone with the URL can start test-mode runs.
