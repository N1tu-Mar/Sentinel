# Arga twins: provision, seed, reset

Sentinel runs against four Arga twins in one twin run: `stripe`, `gmail`, `slack`, `salesforce`.

## Provision

```bash
export ARGA_API_KEY=arga_...
arga twin-runs create --twins stripe,gmail,slack,salesforce --ttl 480 --wait
```

Or with the TypeScript SDK (`arga-sdk`, already a dependency):

```ts
const arga = new Arga({ apiKey: process.env.ARGA_API_KEY! });
const { runId } = await arga.twins.provision({ twins: ["stripe", "gmail", "slack", "salesforce"], ttlMinutes: 480 });
const status = await arga.twins.getStatus(runId); // status.twins[name].baseUrl / .envVars
```

Copy each twin's `envVars` into `.env.local` and set `ARGA_TWIN_RUN_ID=<runId>`. Sentinel reads both its own
variable names and Arga's documented ones:

| System | Sentinel reads |
| --- | --- |
| Stripe | `STRIPE_SECRET_KEY` or `STRIPE_API_KEY`; `STRIPE_API_BASE_URL` or `STRIPE_TWIN_BASE_URL` |
| Slack | `SLACK_BOT_TOKEN` or `SLACK_TOKEN`; `SLACK_API_URL` or `SLACK_TWIN_BASE_URL` |
| Gmail | `GMAIL_ACCESS_TOKEN` or `GOOGLE_ACCESS_TOKEN`; `GMAIL_API_BASE_URL` |
| Salesforce | `SALESFORCE_ACCESS_TOKEN`; `SALESFORCE_API_BASE_URL` or `SALESFORCE_INSTANCE_URL` |

Then `npm run twins:check` should print four ✓ lines.

## Seed

`src/domain/scenarios.ts` defines the eight scenarios. `npm run seed -- <scenario ...>` (no args = all) creates
customers, charges, subscriptions, prior disputes, Salesforce contacts and cases, Gmail messages and Slack channels
through each twin's normal API. Every seeded customer email carries a run tag (`dana.kim+<tag>@example.com`), so
repeated seeds never collide even without a reset.

Disputes are created the way Stripe test mode creates them: charging the test payment methods
`pm_card_createDispute` / `pm_card_createDisputeProductNotReceived`. Whether the Stripe twin emulates these is the
first thing to confirm after provisioning (Kill Check #1 in the build brief). If it does not, point only the Stripe
variables at real Stripe test mode; the adapter is unchanged.

`deadline_passed` needs a dispute whose `due_by` is already in the past. Neither Stripe test mode nor the public
twin API lets us set that, so the harness reports the scenario as skipped (with the reason) instead of faking it.

## Reset

```bash
npm run reset                       # arga.twins.reset(ARGA_TWIN_RUN_ID): restore the provisioned baseline
npm run reset -- --salesforce-admin # also POST /admin/reset on the Salesforce twin
```

The eval harness (`src/eval/harness.ts`) calls the same reset before every scenario whenever `ARGA_TWIN_RUN_ID` is set.

## Don't let the twins expire mid-demo

Short-lived runs expire. Provision with a long TTL, extend with `arga.twins.extend(runId, { ttlMinutes })`, or create a
permanent environment from a saved scenario, and put those URLs in the Vercel env vars.
