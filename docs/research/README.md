# Research index — start here (for build agents)

All research output lives in `docs/research/` and `fixtures/`. Nothing else in the repo was touched.

## Read order
1. **DATA-CONTRACT.md** — every tool's input/output/preconditions/readback + gotchas + threshold/merchant constants. Build adapters from this.
2. **HANDOFF.md** — what's confirmed, UNVERIFIED, blockers, open questions.
3. Per-service detail when writing an adapter: `stripe-disputes.md`, `salesforce-crm.md`, `gmail.md`, `slack.md`.
4. Infra: `arga-twins.md` (provision/reset/seed), `lemma.md` (tracing), `vercel-ai-sdk.md`.
5. Runtime system prompt material: `evidence-playbook.md` (paste decision gates + per-reason table into prompt).

## Fixtures (`fixtures/`)
| dir | contents | use |
|---|---|---|
| stripe/ | dispute (needs_response, under_review, warning, close response, list of 2 priors), charge, customer, refund, webhook events created/updated, update request body | adapter unit tests; webhook route test (`event.charge.dispute.created.json`) |
| salesforce/ | contact, delivery/cancellation cases, SOQL query responses, PATCH + create bodies, create + error responses | SF adapter tests |
| gmail/ | receipt-confirmed thread, cancellation thread, messages/threads list, empty list | body decoding + evidence extraction tests |
| slack/ | approval postMessage request/response, history, conversations.list, error, block_actions payload | Slack adapter + readback tests |
| scenarios/ | `index.json` + `scenario-01..08.json`: `name, branch, chaos_mode, scenario_prompt, seed{stripe,salesforce,gmail}, expected_decision, expected_actions, forbidden_effects, assertions` | eval harness input; `scenario_prompt` → Arga provisioning; `seed` → own seed script if prompts are imprecise |

Every dir has `_sources.md` (provenance). **Regenerate** all fixtures: `python3 fixtures/_gen.py` (edit dates/IDs/threshold there; `NOW = 2026-09-13T12:00Z`).

## Scenarios
| # | name | expected_decision | amount |
|---|---|---|---|
| 01 | fight_receipt_confirmed | FIGHT | $89.00 |
| 02 | fight_delivery_and_email | FIGHT | $145.00 |
| 03 | accept_under_threshold_auto | ACCEPT | $49.00 |
| 04 | accept_over_threshold_needs_approval | ACCEPT (approval) | $340.00 |
| 05 | friendly_fraud_repeat_disputer | FIGHT_AND_FLAG | $120.00 |
| 06 | ask_human_missing_evidence | ASK_HUMAN | $75.00 |
| 07 | injected_silent_submit_failure (`chaos_mode: drop_submit_once`) | FIGHT + recovery | $96.00 |
| 08 | past_due_must_not_submit | EXPIRED_OR_BLOCKED | $169.00 |

Decision labels match `src/domain/types.ts` `Branch`. Chaos mode matches `ChaosMode`.

## Loading in TS
```ts
import scenario from "@/../fixtures/scenarios/scenario-07.json"; // or fs.readFileSync in scripts/eval
const { seed, assertions, forbidden_effects } = scenario;
```
