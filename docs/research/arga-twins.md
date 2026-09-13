# Arga twins — reference

No Arga credentials in repo (`.env.example` only) ⇒ **no live captures yet**. Everything below is from docs. Index: https://docs.argalabs.com/llms.txt

## Provisioning (V)
- API: `POST /validate/twins/provision` body `{twins: string[], ttl_minutes? (1-480, default 60), scenario_id?, scenario_prompt?, scenario_generation_mode?: "fast"|"thorough" (default fast), public?: bool (default true)}` → `{run_id}`. https://docs.argalabs.com/api-reference/post-provision-twins.md
- Status: `GET /validate/twins/provision/{run_id}/status` → `{run_id, status: provisioning|ready|expired|cancelled|failed, expires_at (ISO), twins: {<name>: {base_url, admin_url, env_vars{}}}, proxy_token, seed_results, is_public}`. After expiry: `410 environment_destroyed`. https://docs.argalabs.com/api-reference/get-get-twin-provision-status.md
- API host: `https://api.argalabs.com` (seen in scenarios curl examples). Auth header name: **U** (see /api-reference/auth.md).
- Python: `pip install arga-py-sdk`; `client.twins.provision(twins=["stripe","salesforce","gmail","slack"], ttl_minutes=240, scenario_prompt="...", scenario_generation_mode="thorough")` → `.run_id`; `client.twins.get_status(run_id)`, `.reset(run_id)`, `.extend(run_id, ttl_minutes=)`, `.teardown(run_id)`. Client init / API key env name: U. https://docs.argalabs.com/sdks/python/twins.md
- TypeScript: `client.twins.provision({twins, ttlMinutes, scenarioId, scenarioPrompt, scenarioGenerationMode, public})` → `{runId}`; `getStatus`, `reset` ("restores the baseline captured when the Twin Run was provisioned"), `extend(runId,{ttlMinutes})`, `teardown`. npm package name: U. https://docs.argalabs.com/sdks/typescript/twins.md
- CLI (`uv tool install arga-cli`; `arga login`): https://docs.argalabs.com/cli-and-mcp.md
```
arga previews twins provision --twins stripe,salesforce,gmail,slack --scenario-id <id> --ttl <n> --wait
arga twin-runs create --twins <service> --ttl <n> --wait
arga previews twins status|reset|extend --ttl <n>|lock|teardown <run-id>
arga test-runner scenarios create --name N --prompt "..." --twin stripe --twin salesforce --twin gmail --twin slack --generation-mode thorough --json
arga test-runner scenarios export <id> --output f.json   |  import --file f.json  |  update <id> --file f.json
```
- MCP tools: `get_twin_catalog`, `provision_twins`, `start_url_validation`, `get_validation_results` (twin-reference.md).
- Env vars to expose: map `twins.<name>.env_vars` straight into `.env.local`. Salesforce documented: `SALESFORCE_INSTANCE_URL, SALESFORCE_API_BASE_URL, SALESFORCE_ACCESS_TOKEN`; Slack: `SLACK_API_URL` (twin `/api/` base), `SLACK_BOT_TOKEN`; Stripe: `STRIPE_SECRET_KEY` (+ base URL, name U). Keep `ARGA_TWIN_RUN_ID` for reset/extend.
- **Plan limits** (https://docs.argalabs.com/plans.md): Free = 1 twin per run, fixed 10-min TTL ⇒ **blocker for a 4-twin run**. Team/Paid = unlimited twins, TTL 1–480 min, default 60. Extend before demo; runs expire mid-demo otherwise.

## Scenarios (V https://docs.argalabs.com/features/custom-scenarios.md)
- Prompt → 2-pass: twin classifier (multiple twins only if prompt names multiple providers explicitly) → seed JSON generation. Unmappable details "mapped to the closest available field or omitted" ⇒ **exact amounts/dates not guaranteed from prompt**. After provisioning, READ BACK seeded IDs; don't hardcode fixture IDs.
- Structured alternative: `{name, twins[], seed_config: {slack:{channels:[{name, messages}], oauth_bot_scopes}, stripe:{customers:[{name,email}], ...}}}` via `POST /scenarios` or `scenarios import`. Stripe dispute seed key: **not documented (U)**.
- Cross-twin coherence: each twin gets its own seed block; no documented cross-twin linking ⇒ put the same email/name in every block yourself (our `fixtures/scenarios/*.json` `scenario_prompt` does this).

## Stripe twin (V https://docs.argalabs.com/concepts/twin-reference.md)
Implements customers, payment methods/intents, charges, refunds, **disputes**, files, events, webhook endpoints, test clocks, balance txns, etc. **Idempotency keys + signed webhooks supported.** Test cards for declines/3DS. Seed endpoint for starter products/prices/webhook config. `POST /mcp` Stripe-MCP-compatible. Resources start empty.
**How disputes get seeded: UNDOCUMENTED (Kill Check #1).** Try in order: (1) scenario_prompt naming disputes, then `GET /v1/disputes`; (2) create PaymentIntent with `payment_method=pm_card_createDisputeInquiry` or confirm card 4000000000002685 / 4000000000000259 and poll `GET /v1/disputes?payment_intent=`; (3) ask Arga (founders@argalabs.com / hackathon Discord).

## Webhooks from twins
Twin supports webhook endpoints resource ⇒ presumably `POST /v1/webhook_endpoints {url, enabled_events[]}` returns `secret` (K Stripe API; twin behavior U). Needs a URL the twin can reach (public Vercel/ngrok; localhost U). Retry behavior U.

## Salesforce twin (V)
sObject CRUD `/services/data/v{version}/sobjects/{Account|Contact|Case|EmailMessage|User...}`, SOQL `/query`, `queryAll`, SOSL, composite, describe. Bearer auth; OAuth `/services/oauth2/token`. Admin: `POST /admin/reset`, `GET /admin/state`, `POST /admin/clock`, `GET /healthz`. Custom fields: seedable via scenario import of custom metadata; creating `__c` at runtime: U ⇒ **we use standard fields only** (see salesforce-crm.md). API version string: U (use `GET /services/data` to discover; fixtures assume v62.0). Backend-only, no UI.

## Gmail twin (V)
Threads, messages, drafts, labels, attachments, search, send, watch. OAuth-style tokens, deterministic IDs, resettable. Search operator coverage and base64url body encoding: **U** (assume real-Gmail shape; decode defensively).

## Slack twin (V)
Web API conversations/chat/users/reactions/files/views; Block Kit accepted when `blocks` non-empty; bot/user tokens with **scope enforcement** (`missing_scope` errors) ⇒ bot token needs `chat:write`, `channels:history`, `channels:read`, `channels:manage` (for create). Channels start empty — create via `conversations.create`. Interactive button callbacks to our URL: **not documented (U) ⇒ plan approvals in our UI; Slack is notify-only.** Socket Mode not primary.

## Reset / evidence / grading
- Reset: `client.twins.reset(run_id)` / `arga previews twins reset <run-id>` restores provision-time baseline (V). Salesforce also `POST /admin/reset`. `arga wizard reset` resets local wizard twins to empty.
- Evidence export of provider calls/side-effects/state diffs, forbidden-effect declaration, grading API: **not documented in pages opened (U)**. Validation-run endpoints exist (`/api-reference/get-get-run-details.md`, `get-get-a-run-artifact.md`) but target URL/PR test runs. ⇒ Keep our own provider-call log + deterministic asserts (eval harness) as source of truth.
