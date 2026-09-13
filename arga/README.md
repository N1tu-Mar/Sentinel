# Arga twins: provision, seed, reset

Sentinel runs against four Arga twins in one twin run: `stripe`, `gmail`, `slack`, `salesforce`. Four twins in one run
needs Arga's Team plan (Free allows one twin with a fixed 10-minute lifetime). Research notes: `docs/research/arga-twins.md`.

## Provision

```bash
export ARGA_API_KEY=arga_...
npm run provision                              # empty twins; seed through the APIs
npm run provision -- --with-scenario-prompts   # twins seeded from the eight fixture scenario prompts
npm run twins:check -- --capture               # one read per system; saves live responses to fixtures/live/
```

`scripts/provision.ts` uses `arga-sdk` (`twins.provision` → poll `twins.getStatus` until `ready`) and writes every twin's
`envVars` plus `ARGA_TWIN_RUN_ID` to `.env.twins` (gitignored). Scripts load it automatically; for `next dev` copy it into
`.env.local`, and for production put the values in the Vercel env. TTL defaults to 480 minutes (`ARGA_TTL_MINUTES`).

Sentinel reads both its own variable names and Arga's documented ones:

| System | Sentinel reads |
| --- | --- |
| Stripe | `STRIPE_SECRET_KEY` or `STRIPE_API_KEY`; `STRIPE_API_BASE_URL` or `STRIPE_TWIN_BASE_URL` |
| Slack | `SLACK_BOT_TOKEN` or `SLACK_TOKEN`; `SLACK_API_URL` or `SLACK_TWIN_BASE_URL` |
| Gmail | `GMAIL_ACCESS_TOKEN` or `GOOGLE_ACCESS_TOKEN`; `GMAIL_API_BASE_URL` |
| Salesforce | `SALESFORCE_ACCESS_TOKEN`; `SALESFORCE_API_BASE_URL` or `SALESFORCE_INSTANCE_URL` |

## Seed

The eight scenarios are the research fixtures in `fixtures/scenarios/` (regenerate with `python3 fixtures/_gen.py`).

- **API seeding** (default): `npm run seed -- 07 04` (no args = all) creates the Stripe customer, prior disputes, the
  disputed charge with shipping, the Salesforce contact (Description lines) and cases, the Gmail threads, and the Slack
  channels through each twin's normal API. The customer email gets a run tag (`alex.rivera+<tag>@example.com`), so reruns
  never collide.
- **Prompt seeding**: provision with `--with-scenario-prompts` and set `EVAL_SEED_MODE=prompt`. The harness then finds
  each scenario's dispute by customer email instead of seeding. Arga maps prompts loosely, so assertions check
  relationships and fixture facts, not fixture ids.

How the Stripe twin creates disputes is undocumented (Kill Check #1). The seeder tries, per reason,
`pm_card_createDisputeProductNotReceived` / `pm_card_createDispute`, then the raw test cards `4000000000002685` /
`4000000000000259`, and records which one produced a dispute in its notes. If none do, point only the Stripe variables at
real Stripe test mode; nothing else changes.

`scenario-08` needs a dispute whose deadline has already passed. The public APIs cannot backdate `due_by`, so under API
seeding the harness reports it as skipped with that reason; prompt seeding may produce it.

## Reset

```bash
npm run reset                       # arga.twins.reset(ARGA_TWIN_RUN_ID): restore the provisioned baseline
npm run reset -- --salesforce-admin # also POST /admin/reset on the Salesforce twin
```

The eval harness calls the same reset before every scenario whenever `ARGA_TWIN_RUN_ID` is set.

## Don't let the twins expire mid-demo

Check `expires_at` from provisioning, extend with `arga.twins.extend(runId, { ttlMinutes })`, and reprovision before
recording if needed.
