# HANDOFF — research agent

Entry point for build agents: `docs/research/README.md`. Tool contract: `DATA-CONTRACT.md`.

## Confirmed (docs opened 2026-09-13)
- Dispute status enum = warning_needs_response, warning_under_review, warning_closed, needs_response, under_review, won, lost, prevented (no charge_refunded) — stripe-disputes.md
- Dispute ID prefix `du_` in current docs — stripe-disputes.md
- Full reason enum (15 values), evidence field list split text/file, 20k per-field / 150k total limits — stripe-disputes.md
- `submit` defaults true; `submit=false` stages; close is irreversible, needs_response → lost — stripe-disputes.md
- Idempotency-Key: ≤255 chars, ≥24h, replays first status+body incl. 500s, param mismatch errors, POST only — stripe-disputes.md
- `/v1/disputes` list has charge/payment_intent/created filters, no customer filter — stripe-disputes.md
- Dispute webhook events (5) + Stripe-Signature v1 HMAC-SHA256, 5-min tolerance, raw body — stripe-disputes.md
- Dispute test cards + winning_evidence/losing_evidence/escalate_inquiry_evidence — stripe-disputes.md
- Arga Stripe twin implements disputes, files, idempotency keys, signed webhooks, webhook endpoints — arga-twins.md
- Arga provision API/SDK/CLI shapes, status response `twins.<name>.{base_url, admin_url, env_vars}`, reset restores provision baseline — arga-twins.md
- Salesforce twin: Contact/Case CRUD, SOQL, `/admin/reset`; Slack twin: Block Kit, scope enforcement, channels start empty — arga-twins.md
- Lemma: `@uselemma/tracing`, LEMMA_API_KEY/LEMMA_PROJECT_ID, `vercelAI()` integration auto root trace — lemma.md
- 8 scenarios + consistent fixtures generated from one script — fixtures/_gen.py, fixtures/scenarios/

## UNVERIFIED (what resolves it)
- How Arga Stripe twin seeds disputes → provision with scenario_prompt, `GET /v1/disputes`; else test card 4000000000002685 on twin.
- Twin webhook delivery (URL registration, secret, localhost reachability, retries) → `POST /v1/webhook_endpoints` on twin, check `secret`.
- Arga auth header name, TS npm package name, API key env var → docs.argalabs.com/api-reference/auth.md, sdks/typescript.md.
- Arga evidence export / forbidden-effect declaration / grading API → not found; ask Arga.
- Salesforce twin API version, Case picklist values, runtime custom fields → `GET /services/data`, `GET /sobjects/Case/describe`.
- Gmail twin search operators + base64url bodies → one live `threads.get`.
- Slack twin interactive callbacks → assume none.
- `Idempotent-Replayed` header, error text for updating evidence after submit, `payment_method_details.card.case_type` values → live twin/Stripe test call.
- Salesforce/Gmail/Slack/AI SDK shapes are standard-API knowledge, docs not re-opened this session (token budget) — marked K in each file.
- Lemma exact `vercelAI()` import code + "instructions"/audit feature → read `@uselemma/tracing` README after install.

## Blockers (change build plan)
- **Dispute seeding on twin undocumented** — Kill Check #1. Fallbacks in arga-twins.md.
- **Arga Free plan = 1 twin/run, fixed 10-min TTL.** 4-twin run needs Team plan (TTL up to 480 min). Extend before demo.
- **No ARGA creds in repo** ⇒ zero live captures; `fixtures/live/` empty. Any live response overrides fixtures.
- **Slack approvals: build in Sentinel UI**, Slack notify-only.
- **Salesforce: standard fields only** — risk flag/LTV as `Description` key lines (salesforce-crm.md). PATCH replaces Description whole.
- `src/domain/types.ts` comment says dispute id `dp_…`; current Stripe uses `du_`. Don't validate prefix.
- Scenario prompts can't guarantee exact amounts/dates (Arga maps "closest field or omits") — match seeded data by customer email, assert on relationships not fixture IDs.

## Questions for Nitu
1. Arga plan tier + API key — can you drop `ARGA_API_KEY` into `.env.local` so live captures can replace doc-derived fixtures?
2. Is Arga hackathon support (Discord/Slack) available to ask how the Stripe twin seeds disputes?
3. OK with Salesforce flag living in `Contact.Description` lines instead of custom fields?
4. Approval threshold fixed at $200.00 (20000 cents) per BUILD_BRIEF — confirm.
