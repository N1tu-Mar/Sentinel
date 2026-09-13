# CHARGEBACK DEFENDER — Build Brief for Claude Code

You are building a hackathon entry, solo with me, in one afternoon. Read this whole file before writing any code. It contains everything: the competition, the judges, the product, the architecture, the sponsor integrations, the deployment target, the git discipline, the time plan, and the kill conditions.

Hard deadline: **6:45 PM ET today (Sunday Sep 13, 2026)** for a working deployed app, a public repo, and the written brief. Judging starts 7:00 PM ET. Every decision below is optimized for shipping something that works and demonstrably knows it works.

---

## 0. Operating rules (read twice)

1. **Commit every 4–8 minutes.** Not "when a feature is done" — on the clock. See §16 for the exact protocol. If you notice it has been more than 8 minutes since the last commit, stop and commit whatever compiles.
2. **Deploy pipeline first.** A hello-world Next.js app must be live on Vercel before any product code exists. Deployment problems surface at minute 15, not minute 350.
3. **The agent loop is the product.** Build it as a CLI first, prove one scenario end to end (including failure recovery), then build the UI around it. Never the reverse.
4. **No fake integrations.** Every external call goes to a real endpoint — either an Arga Labs twin or a real sandbox. No mocked provider responses in application code. If something doesn't work, say so and use the fallback in §17.
5. **Verify with readback, never trust a 200.** Every write to an external system is followed by a read that confirms the intended state. This is the single most important behavior in the project — the host company (Lemma) exists because agents silently fail, and two of the five judges (Arga Labs) built the sandbox we're testing against.
6. **When docs and this brief disagree, docs win.** Read the sponsor docs listed in §5 before implementing those integrations. Do not implement an API shape from memory.
7. **Scope discipline.** §20 lists what not to build. If you find yourself building it, stop.
8. **Ask me only when blocked on credentials or a kill decision.** Everything else, decide and move.

---

## 1. Competition context

**Multi-App AI Agent Hackathon** — virtual, one day, `multiappagenthackathon.com`.

- Brief (verbatim): _"Build one useful, multi-step AI agent. Connect it to at least three external apps. Show how you know it works."_
- Submit: working project/repository, a 2-minute demo video, a short **system and reliability brief**.
- Prizes: $10,000 / $4,000 / $1,000. Top three get guaranteed interviews with Arga Labs or Lemma.
- Build window ends 4:00 PM PT (7:00 PM ET).

**Judging rubric:**

| Category                 | Weight |
| ------------------------ | ------ |
| Technical execution      | 30%    |
| Reliability & evaluation | 25%    |
| Usefulness               | 20%    |
| Originality              | 15%    |
| Demo clarity             | 10%    |

**Who is judging and what that means:**

- **Lemma (host)** — production monitoring for AI agents. Their thesis: agents look like they succeeded when they didn't; detection means comparing what happened with what was supposed to happen. → Our agent must be traced with Lemma, and the demo must show the agent catching its own silent failure.
- **Arga Labs (2 of 5 judges: Phillip Li, Akira Tong)** — stateful sandbox "twins" of real services (Stripe, Slack, Gmail, Salesforce, GitHub, Linear…) with scenario seeding, state reset, and evidence capture of every provider call and side effect. → We build and evaluate against Arga twins, and our eval harness resets twin state between scenarios.
- **Userlens (Ankur Dahama, Hai Ta)** — product analytics, YC. → Care about usefulness and clean product thinking.
- **Clera (Shlok Mundhra)** — an AI agent company. → Will scrutinize whether the agent is real.

The host's stated example of the intended architecture: _"an agent takes an email, checks a CRM, then makes a direct decision that goes to another external application."_ Our workflow is exactly that shape: **trigger → investigate across systems → decide → act → verify → recover**.

---

## 2. What we are building

### Plain-English product

An online store gets a **chargeback** (Stripe calls it a _dispute_): a customer told their bank "I didn't get this" or "I never ordered this." The bank pulls the money back immediately. The store has about seven days to submit evidence or lose the money, and pays a fee either way.

Fighting it means a human digs through Stripe (charge, customer history), the CRM (who is this, past tickets, delivery notes), and email (did the customer ever say anything?), then writes up evidence and submits it through Stripe before the deadline. Most small merchants don't bother. They just lose the money.

**Chargeback Defender** is an agent that does this automatically when a dispute appears:

1. Reads the dispute from **Stripe** — amount, reason code, evidence deadline
2. Looks the customer up in **Salesforce** (CRM) — history, open cases, delivery/shipping notes
3. Searches **Gmail** for any conversation with the customer
4. Checks the customer's prior disputes and refunds in Stripe
5. **Decides** which of five situations this is (see decision tree below)
6. **Acts**: submits evidence to Stripe, or accepts the dispute, or requests approval, or asks a human — plus flags the customer in Salesforce, opens a Salesforce case where appropriate, and posts to **Slack**
7. **Verifies** every action by reading the state back from each system
8. **Recovers** if verification fails: retries safely, or escalates

Four external apps, three of them written to (Stripe, Salesforce, Slack), all four read from.

### The decision tree (this is the reasoning that makes it an agent)

| Branch                | Evidence pattern                                                                                                                                                                                              | Action                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FIGHT**             | Delivery proof exists (tracking/signature in CRM) and/or customer confirmed receipt in writing (email), or the claim contradicts Stripe records (e.g. "duplicate" but the two charges are different products) | Assemble evidence, submit to Stripe, post summary to Slack                                                                                                                                                |
| **FIGHT + FLAG**      | FIGHT conditions **and** ≥2 prior disputes in 90 days with no legitimate basis                                                                                                                                | FIGHT, plus create a "Chargeback risk: repeat disputer" case in Salesforce and post to Slack risk channel                                                                                                 |
| **ACCEPT**            | Customer is provably right — e.g. emailed a cancellation before the charge date, or charged twice for the same item with no refund                                                                            | Close the dispute as accepted in Stripe; cancel the still-active subscription if there is one; create a follow-up case in Salesforce; post to Slack. **If amount > $200 → requires human approval first** |
| **ASK_HUMAN**         | Not enough evidence either way — no delivery record, no email thread, no contradiction in Stripe                                                                                                              | Take **no action in Stripe**. Create a Salesforce case "Evidence needed" listing exactly what's missing. Post to Slack with the due date                                                                  |
| **EXPIRED / BLOCKED** | Evidence deadline has already passed, or dispute is no longer `needs_response`                                                                                                                                | Take no action in Stripe. Record why. Post to Slack                                                                                                                                                       |

Different evidence → genuinely different actions across different systems. That is the "why is this an agent and not a Zapier" answer.

### The two moments the judges will remember

1. **The agent finds the customer's own email** ("Got the jacket, thanks!") sent the day after delivery, and uses it as the primary evidence to fight a "product not received" claim.
2. **The agent catches its own silent failure.** It submits evidence, Stripe returns 200, the agent reads the dispute back and sees it is _still_ `needs_response`. It diagnoses the failure, resubmits with a fresh idempotency key, reads back again, confirms `under_review`. The failure is injected by our chaos layer (§9.8); the recovery is real code.

---

## 3. Non-negotiables

- Real agent loop: Claude decides which tools to call and in what order. No hardcoded call sequence.
- Every action tool performs a **readback verification** and returns the observed state.
- **Policy guardrails live in code**, not in the prompt. The LLM cannot bypass them.
- **Idempotency**: no action can be double-applied even if the LLM calls a tool twice.
- **Chaos mode** exists and the eval harness proves recovery.
- **Eval harness** runs all scenarios against reset twin state and checks final state in every system with deterministic assertions. Results are committed to the repo.
- **Lemma tracing** on every agent run.
- **Real, well-designed frontend** deployed on Vercel. Not a trace dump.
- Public GitHub repo with a commit history that shows continuous progress.

---

## 4. Stack

| Layer       | Choice                                                                                         | Why                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App         | **Next.js 15, App Router, TypeScript, single repo**                                            | One deploy, API routes + UI together, Vercel-native                                                                                                    |
| LLM         | **Anthropic Claude via Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`)                             | Lemma has a first-party AI SDK integration; tool calling + multi-step loop built in                                                                    |
| Model       | `claude-sonnet-5` (env-overridable via `AGENT_MODEL`)                                          | Fast enough for a 30-second run, strong tool use. Verify the current model ID at https://docs.claude.com/en/docs/about-claude/models before hardcoding |
| Schemas     | `zod`                                                                                          | Tool input schemas + decision schema                                                                                                                   |
| State store | **Upstash Redis** (`@upstash/redis`) via Vercel Marketplace                                    | REST-based, works in serverless, free tier. In-memory fallback when env is absent                                                                      |
| Stripe      | `stripe` (official Node SDK, `host`/`protocol`/`port` override to hit the twin)                |                                                                                                                                                        |
| Slack       | `@slack/web-api` (`slackApiUrl` override)                                                      |                                                                                                                                                        |
| Salesforce  | raw `fetch` against the REST API (`SALESFORCE_API_BASE_URL` + bearer token)                    | Two endpoints needed (SOQL query, sObject CRUD); no SDK required                                                                                       |
| Gmail       | raw `fetch` against Gmail REST (`GMAIL_API_BASE_URL` + bearer token)                           | Two endpoints needed (messages list/search, messages get)                                                                                              |
| Tracing     | `@uselemma/tracing`                                                                            | Lemma                                                                                                                                                  |
| Sandbox     | Arga Labs twins (`stripe`, `gmail`, `slack`, `salesforce`) via Arga CLI / TypeScript SDK / MCP |                                                                                                                                                        |
| Styling     | Tailwind + a small token layer (§13)                                                           |                                                                                                                                                        |
| Deploy      | **Vercel**                                                                                     |                                                                                                                                                        |

Check installed versions before writing code: `npm view ai version`, `npm view @ai-sdk/anthropic version`. The AI SDK's multi-step API changed between major versions (`maxSteps` in v4; `stopWhen: stepCountIs(n)` in v5+). Use whichever the installed version supports. Read `node_modules/ai/README.md` or the docs if unsure.

---

## 5. Sponsor integrations

### 5.1 Arga Labs — the sandbox and the eval lab

**Read first (10 minutes max):**

- https://docs.argalabs.com/llms.txt — index of all docs
- https://docs.argalabs.com/quickstart.md
- https://docs.argalabs.com/features/twins-quickstart.md
- https://docs.argalabs.com/features/local-testing.md
- https://docs.argalabs.com/features/custom-scenarios.md
- https://docs.argalabs.com/cli-and-mcp.md
- https://docs.argalabs.com/sdks/typescript.md and `sdks/typescript/twins.md`, `sdks/typescript/scenarios.md`
- https://docs.argalabs.com/concepts/twin-reference.md — per-twin support (Stripe, Slack, Gmail, Salesforce sections)
- https://docs.argalabs.com/plans.md — free tier limits (number of twins per run, TTL)
- https://docs.argalabs.com/AGENTS.md — written for coding agents

**What the twin reference confirms (verified today):**

- `stripe` twin: customers, charges, refunds, **disputes**, subscriptions, invoices, idempotency keys, signed webhooks, dashboard pages. Resources start empty unless seeded.
- `slack` twin: Web API incl. `chat.postMessage` with Block Kit, `conversations.*`, `auth.test`. Channels start empty — we must create them. Point the SDK at the twin base URL.
- `gmail` twin: threads, messages, search, send, labels, seeded mailbox state, deterministic IDs. Mailboxes start empty unless seeded.
- `salesforce` twin: sObject CRUD for Account, Contact, Case, EmailMessage, User; SOQL at `/services/data/v{version}/query`; bearer auth; admin `POST /admin/reset`, `GET /admin/state`. Provides `SALESFORCE_INSTANCE_URL`, `SALESFORCE_API_BASE_URL`, `SALESFORCE_ACCESS_TOKEN`. Backend-only (no UI).
- HubSpot is **not** in the twin catalog. That is why the CRM is Salesforce. (Fallback: real HubSpot free account — §17.)

**How we use Arga:**

1. **Provision** four twins in one run: `stripe, gmail, slack, salesforce`. Use the Arga MCP tools if configured in this Claude Code session (`get_twin_catalog`, `provision_twins`, `get_validation_results`); otherwise the CLI (`arga twin-runs create --twins stripe,gmail,slack,salesforce --ttl 60 --wait` or the equivalent documented command); otherwise the TypeScript SDK. Capture every returned URL, token, and env var into `.env.local` immediately.
2. **Seed** deterministic data. Preferred: our own seed script (`scripts/seed.ts`) that creates customers, charges, subscriptions, contacts, cases, emails, and Slack channels through the twins' normal APIs. For **disputes** specifically — Stripe's public API cannot create disputes directly — find out in the first 20 minutes how the Stripe twin seeds disputes: a scenario seed config, an admin/seed endpoint, or a test-card behavior. Read `custom-scenarios.md` and the Stripe section of the twin reference; if unclear, provision once with a `--scenario-prompt` like "a merchant Stripe account with 8 open disputes across 7 customers" and inspect the resulting shape via the API, then export the scenario and edit it into a deterministic JSON scenario checked into `arga/scenarios/`. **This is Kill Check #1 (§17).**
3. **Save the seeded state as a Scenario** so it can be reset. The eval harness must reset twin state to the scenario baseline before each scenario run (CLI `reset`, API reseed, or the Salesforce `/admin/reset` route — use whatever the docs say).
4. **TTL**: short-lived runs expire (default 60 minutes). Before 2:30 PM ET, either create a **permanent twin environment** from the saved scenario (`ensure_twin_environment` in the SDK or the web app's "Permanent" session type) or set a recurring reminder to extend the TTL. A twin expiring mid-demo is a catastrophic, avoidable failure. Put the permanent URLs in Vercel env vars.
5. **Evidence**: every provider call our app makes is also logged locally (§8.3) so the UI can show "N provider calls, 0 forbidden effects" the way Arga's own UI does. If time permits, also register the Vercel deployment URL as a Stripe webhook endpoint on the twin so `charge.dispute.created` events flow in live.

### 5.2 Lemma — tracing every run

**Read first (5 minutes max):**

- https://docs.uselemma.ai/integrations/vercel-ai-sdk
- https://github.com/uselemma/lemma — `packages/ts/tracing` README and `skills/lemma-tracing` (a skill written for coding agents; follow it)

**Setup (as documented today; verify against the doc):**

```bash
npm install @uselemma/tracing
```

```ts
// instrumentation.ts  (project root, or src/ if using src/)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerOTel } = await import("@uselemma/tracing");
    registerOTel(); // reads LEMMA_API_KEY and LEMMA_PROJECT_ID from env
  }
}
```

Every `generateText` call in the agent passes:

```ts
experimental_telemetry: {
  isEnabled: true,
  functionId: 'chargeback-defender',
  metadata: { caseId, disputeId, scenario, chaosMode, attempt },
}
```

The AI SDK then emits spans for model calls, tool invocations, tokens, and timing, and Lemma receives them.

Also:

- Capture the active trace ID inside the run (`trace.getActiveSpan()?.spanContext().traceId` from `@opentelemetry/api`, if available through the SDK) and store it on the case so the UI can show "Trace `abc123` → open in Lemma".
- Name tool spans meaningfully. Lemma audits traces against the agent's instructions — the system prompt in §9.2 is written so that violations are detectable (e.g. "never submit if `due_by` has passed").
- Confirm traces actually arrive in the Lemma dashboard by 2:50 PM ET. Screenshot for the brief.

---

## 6. Repository layout

```
chargeback-defender/
├── README.md
├── docs/
│   ├── RELIABILITY_BRIEF.md        # the submission brief (§18)
│   ├── DEMO_SCRIPT.md              # 2-minute shot list (§18)
│   └── BUILD_LOG.md                # one line per commit, appended automatically (§16)
├── arga/
│   ├── scenarios/
│   │   └── chargeback-baseline.json  # exported + edited deterministic seed
│   └── README.md                   # how to provision/reset
├── eval/
│   ├── results.json                # committed after each full run
│   └── results.md                  # human-readable table
├── instrumentation.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                        # dispute queue
│   │   ├── cases/[id]/page.tsx             # case view (the hero screen)
│   │   ├── eval/page.tsx                   # scoreboard
│   │   └── api/
│   │       ├── cases/route.ts              # GET list, POST sync-from-stripe
│   │       ├── cases/[id]/route.ts         # GET case + timeline (polled by UI)
│   │       ├── cases/[id]/run/route.ts     # POST start agent (maxDuration 300)
│   │       ├── cases/[id]/approve/route.ts # POST approve|reject
│   │       ├── eval/run/route.ts           # POST run one scenario
│   │       ├── eval/results/route.ts       # GET aggregated results
│   │       └── webhooks/stripe/route.ts    # POST charge.dispute.created (optional path)
│   ├── agent/
│   │   ├── run.ts            # orchestrator: load case → loop → final verify → resolve
│   │   ├── prompt.ts         # system prompt (§9.2)
│   │   ├── tools.ts          # tool catalog (§9.3)
│   │   ├── policy.ts         # guardrails (§9.4)
│   │   ├── verify.ts         # postcondition checks (§9.5)
│   │   ├── idempotency.ts    # action ledger (§9.6)
│   │   └── chaos.ts          # fault injection (§9.8)
│   ├── adapters/
│   │   ├── stripe.ts
│   │   ├── salesforce.ts
│   │   ├── gmail.ts
│   │   ├── slack.ts
│   │   └── logged-fetch.ts   # wraps every outbound call, records provider_call events
│   ├── store/
│   │   ├── index.ts          # CaseStore interface + factory (redis | memory)
│   │   ├── redis.ts
│   │   └── memory.ts
│   ├── domain/
│   │   ├── types.ts          # Case, TimelineEvent, Decision, Evidence, ActionRecord
│   │   └── scenarios.ts      # the 8 scenario definitions + expected outcomes (§10)
│   ├── eval/
│   │   ├── harness.ts        # reset → seed → run → assert (§11)
│   │   └── assertions.ts
│   └── ui/                   # components (§13)
├── scripts/
│   ├── twins-check.ts        # health-check all four twins
│   ├── seed.ts               # seed baseline data into twins
│   ├── reset.ts              # reset twins to baseline
│   ├── agent-cli.ts          # run the agent on one case from the terminal
│   └── eval-cli.ts           # run the full harness locally, write eval/results.*
├── .env.example
├── package.json              # scripts: dev, build, typecheck, twins:check, seed, reset, agent, eval
└── vercel.json (only if needed)
```

---

## 7. Data model (`src/domain/types.ts`)

```ts
export type Branch =
  | "FIGHT"
  | "FIGHT_AND_FLAG"
  | "ACCEPT"
  | "ASK_HUMAN"
  | "EXPIRED_OR_BLOCKED";

export type CaseStatus =
  | "new"
  | "running"
  | "awaiting_approval"
  | "resolved"
  | "needs_attention"
  | "failed";

export interface DisputeCase {
  id: string; // = Stripe dispute id (dp_...)
  status: CaseStatus;
  scenario?: string; // scenario key when seeded/evaluated
  chaosMode: ChaosMode;
  dispute: {
    id: string;
    chargeId: string;
    customerId: string;
    amount: number;
    currency: string;
    reason: string;
    status: string;
    dueBy: number | null;
    createdAt: number;
  };
  customer?: {
    email: string;
    name: string;
    stripeId: string;
    sfContactId?: string;
  };
  evidence: EvidenceItem[];
  decision?: Decision;
  actions: ActionRecord[]; // the idempotency ledger
  approval?: {
    requiredFor: "ACCEPT";
    requestedAt: number;
    decidedAt?: number;
    outcome?: "approved" | "rejected";
    by?: string;
  };
  verification?: { passed: boolean; checks: VerificationCheck[]; at: number };
  lemmaTraceId?: string;
  providerCalls: number;
  forbiddenEffects: number;
  createdAt: number;
  updatedAt: number;
}

export interface EvidenceItem {
  id: string;
  source: "stripe" | "salesforce" | "gmail";
  kind:
    | "delivery_proof"
    | "customer_communication"
    | "dispute_history"
    | "cancellation_request"
    | "order_record"
    | "other";
  summary: string; // one line for the UI
  raw: unknown; // the underlying record
  strength: "strong" | "moderate" | "weak";
  foundAt: number;
}

export interface Decision {
  branch: Branch;
  confidence: number; // 0–1
  rationale: string; // 2–4 sentences, plain English
  evidenceIds: string[];
  requiresApproval: boolean;
  plannedActions: string[]; // human-readable
  decidedAt: number;
}

export interface ActionRecord {
  key: string; // `${caseId}:${action}` — one logical action
  action:
    | "stripe.submit_evidence"
    | "stripe.accept_dispute"
    | "stripe.cancel_subscription"
    | "salesforce.create_case"
    | "salesforce.flag_contact"
    | "slack.post";
  attempts: {
    n: number;
    idempotencyKey: string;
    at: number;
    httpStatus?: number;
    verified: boolean;
    note?: string;
  }[];
  state: "pending" | "succeeded_verified" | "failed";
  observed?: unknown; // what the readback returned
}

export type ChaosMode =
  | "none"
  | "drop_submit_once"
  | "stripe_500_once"
  | "slack_timeout_once";

export type TimelineEvent =
  | { t: number; type: "status"; status: CaseStatus }
  | { t: number; type: "thought"; text: string } // assistant text between tool calls
  | { t: number; type: "tool_call"; tool: string; input: unknown }
  | {
      t: number;
      type: "tool_result";
      tool: string;
      summary: string;
      ok: boolean;
    }
  | { t: number; type: "evidence"; item: EvidenceItem }
  | { t: number; type: "decision"; decision: Decision }
  | {
      t: number;
      type: "action";
      action: ActionRecord["action"];
      attempt: number;
      idempotencyKey: string;
    }
  | {
      t: number;
      type: "verify";
      action: string;
      expected: string;
      observed: string;
      passed: boolean;
    }
  | { t: number; type: "recovery"; text: string }
  | {
      t: number;
      type: "approval_requested" | "approval_granted" | "approval_rejected";
    }
  | {
      t: number;
      type: "provider_call";
      system: string;
      method: string;
      path: string;
      status: number;
      ms: number;
      forbidden?: boolean;
    }
  | { t: number; type: "chaos"; mode: ChaosMode; text: string }
  | { t: number; type: "error"; text: string };
```

Store layout (Redis): `case:{id}` → JSON of `DisputeCase`; `case:{id}:events` → list of `TimelineEvent`; `cases:index` → set of ids; `eval:results` → JSON. All appends are single-key operations; the UI polls `GET /api/cases/[id]` every second and receives `{ case, events }`.

---

## 8. External adapters (`src/adapters/`)

### 8.1 Rules for every adapter

- Base URL and credentials come **only** from env vars (§15). Never hardcode a twin URL.
- Every outbound HTTP call goes through `logged-fetch.ts` (or the SDK's equivalent hook), which appends a `provider_call` event with system, method, path, status, and latency, and increments `case.providerCalls`. This is what makes the "12 provider calls" counter in the UI truthful.
- Retries: 5xx and network errors retry up to 3 times with 300/900/2700 ms backoff. 4xx never retries. Log each attempt.
- Adapters are thin. No business logic. They return typed records.

### 8.2 Stripe (`stripe.ts`)

```ts
import Stripe from "stripe";
// Twin: parse STRIPE_API_BASE_URL into host/protocol/port for the SDK config.
// Real test mode: leave host undefined.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  host,
  protocol,
  port,
  maxNetworkRetries: 0,
});
```

Functions:

- `getDispute(id)` → dispute incl. `status`, `reason`, `amount`, `evidence_details.due_by`, `evidence` fields
- `listDisputes({ status: 'needs_response' })` → for "Sync from Stripe"
- `getCharge(id)` and `getCustomer(id)`
- `listCustomerDisputes(customerId, sinceDays=90)` — via `disputes.list` then filter by charge→customer (or search; use whatever the twin supports — verify)
- `listCustomerCharges(customerId)` and `listRefunds(chargeId)`
- `listSubscriptions(customerId)` / `cancelSubscription(id)`
- `submitEvidence(disputeId, evidence, { idempotencyKey, submit: true })` → `stripe.disputes.update(id, { evidence, submit }, { idempotencyKey })`
- `acceptDispute(disputeId, { idempotencyKey })` → `stripe.disputes.close(id, {}, { idempotencyKey })`

Evidence fields to populate (Stripe `evidence` object): `customer_name`, `customer_email_address`, `product_description`, `shipping_carrier`, `shipping_tracking_number`, `shipping_date`, `customer_communication` (the email text), `uncategorized_text` (the agent's written rebuttal). If we fall back to real Stripe test mode, note that `uncategorized_text: 'winning_evidence'` forces a won outcome — useful for the demo only, never in evals.

### 8.3 Salesforce (`salesforce.ts`)

Raw fetch, bearer `SALESFORCE_ACCESS_TOKEN`, base `SALESFORCE_API_BASE_URL`, API version `v60.0` (verify what the twin serves via `GET /services/data`).

- `findContactByEmail(email)` → SOQL `SELECT Id, Name, Email, Description, CreatedDate FROM Contact WHERE Email = '...'`
- `listCasesForContact(contactId)` → SOQL on `Case` (Subject, Description, Status, CreatedDate)
- `createCase({ contactId, subject, description, priority })` → `POST /sobjects/Case`
- `flagContactRepeatDisputer(contactId, note)` → `PATCH /sobjects/Contact/{id}` appending `[CHARGEBACK RISK] repeat disputer flagged <ISO date>: <note>` to `Description` **and** `createCase` with subject exactly `Chargeback risk: repeat disputer`
- `findCase(contactId, subject)` → readback for verification
  Delivery notes live in the contact's most recent Case description (seeded that way) — e.g. `Shipped 2026-09-02 via UPS 1Z999AA10123456784, delivered 2026-09-05 15:12, signed by resident.`

### 8.4 Gmail (`gmail.ts`)

Raw fetch, bearer `GMAIL_ACCESS_TOKEN`, base `GMAIL_API_BASE_URL`.

- `searchMessages(query)` → `GET /gmail/v1/users/me/messages?q=<query>` then `GET .../messages/{id}?format=full` for each (cap 10)
- Decode `payload.parts[].body.data` (base64url) to text; return `{ id, threadId, from, to, date, subject, text }`
  Search queries the agent will use: `from:<customer email>`, `to:<customer email>`, `<customer email> cancel`, etc.

### 8.5 Slack (`slack.ts`)

```ts
import { WebClient } from "@slack/web-api";
const slack = new WebClient(process.env.SLACK_BOT_TOKEN, {
  slackApiUrl: process.env.SLACK_API_URL,
});
```

- `ensureChannel(name)` → `conversations.list` → `conversations.create` if missing (seed step creates `#disputes`, `#dispute-approvals`, `#risk`)
- `post(channel, text, blocks?)` → `chat.postMessage`; return `ts`
- `findMessage(channel, containing)` → `conversations.history` filter → readback for verification
  Every Slack post includes the case URL (`${APP_URL}/cases/${id}`).

---

## 9. Agent design (`src/agent/`)

### 9.1 The loop (`run.ts`)

```
runCase(caseId, { chaosMode }):
  case = store.get(caseId); set status=running; emit status
  ctx  = { caseId, store, adapters, chaos: new Chaos(chaosMode), ledger }
  result = generateText({
    model: anthropic(process.env.AGENT_MODEL ?? 'claude-sonnet-5'),
    system: SYSTEM_PROMPT,
    prompt: initialUserMessage(case),        // dispute JSON + instructions to begin
    tools: buildTools(ctx),                  // §9.3
    stopWhen / maxSteps: 30,
    onStepFinish: (step) => emit 'thought' for step.text, 'tool_call'/'tool_result' for each call,
    experimental_telemetry: { isEnabled: true, functionId: 'chargeback-defender', metadata: {...} },
  })
  // Independent final verification — does NOT trust the LLM's claim of success
  v = verifyPostconditions(case, ctx)       // §9.5
  if case.decision.requiresApproval && !case.approval?.outcome → status=awaiting_approval
  else if v.passed → status=resolved
  else → status=needs_attention; emit verify failures
  persist; emit status
```

`onStepFinish` is the bridge between the LLM loop and the timeline: every piece of assistant text becomes a `thought` event, every tool call and result becomes `tool_call`/`tool_result`. The UI shows these live.

Approval continuation: `POST /api/cases/[id]/approve` records the outcome and, if approved, calls `runCase(id, { resume: 'post_approval' })`, which re-enters the loop with a user message: _"Approval granted by <name> at <time>. Execute the planned ACCEPT actions now and verify."_ The policy layer now allows `accept_dispute`.

### 9.2 System prompt (`prompt.ts`) — use this text, adjust only if a tool name changes

```
You are Chargeback Defender, an operations agent for an online merchant. A Stripe dispute (chargeback) has arrived. Your job is to investigate across the merchant's systems, decide the correct response, take the actions, and verify they actually happened.

You have tools for four systems: Stripe (payments, disputes, subscriptions), Salesforce (customer records and cases), Gmail (email history with the customer), and Slack (team notifications). Use them to gather evidence before deciding. Investigate in whatever order the evidence suggests; do not skip a system just because the first one looked conclusive.

DECIDE using exactly one branch:
- FIGHT: we have delivery proof and/or the customer confirmed receipt in writing, or the customer's claim is contradicted by Stripe records.
- FIGHT_AND_FLAG: FIGHT conditions AND the customer has 2 or more prior disputes in the last 90 days with no legitimate basis.
- ACCEPT: the customer is provably right (e.g. they requested cancellation before the charge date, or were charged twice for the same item with no refund). Fighting would lose.
- ASK_HUMAN: evidence is insufficient either way. Take no Stripe action. Say precisely what is missing.
- EXPIRED_OR_BLOCKED: the evidence deadline has passed or the dispute is no longer awaiting a response. Take no Stripe action.

RULES (these are enforced by the tools; violating them will fail):
1. Call record_decision before any action tool. Actions must match the recorded branch.
2. Never submit evidence or accept a dispute if due_by has passed or the dispute is not in needs_response.
3. ACCEPT with amount over $200 requires human approval: call request_approval and stop. Do not accept.
4. Never call the same action twice unless the previous attempt was reported as unverified.
5. After every action, read the result of the verification the tool returns. If verified=false, diagnose (say what you think went wrong in one sentence), then retry once with the same tool. If it fails again, call escalate_to_human.
6. Cite evidence by id in your decision. Do not invent facts. If a system returns nothing, say so and treat it as absence of evidence.
7. Write the rebuttal for Stripe in plain, factual English: what was ordered, when it shipped, the tracking, what the customer said and when. No adjectives.
8. Post a Slack summary at the end of every case, including cases where you took no Stripe action.

Be concise between tool calls: one or two sentences of reasoning, then the next call. Finish with a two-sentence summary of what you found, what you did, and what you verified.
```

### 9.3 Tool catalog (`tools.ts`) — zod schemas, all `execute` functions emit timeline events

**Read tools (no side effects):**

| Tool                             | Input                                      | Returns                                                                                                      |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `stripe_get_dispute`             | `{}` (uses case)                           | dispute summary incl. `status`, `reason`, `amount`, `due_by`, `is_past_due`                                  |
| `stripe_get_charge_and_customer` | `{}`                                       | charge, customer (email, name, created), payment method summary                                              |
| `stripe_customer_history`        | `{ days?: number }`                        | prior disputes (count, outcomes, dates), charges, refunds, active subscriptions                              |
| `salesforce_lookup_customer`     | `{ email }`                                | contact + cases (with descriptions) — records `delivery_proof` evidence if a shipping/delivery note is found |
| `gmail_search`                   | `{ query, maxResults? }`                   | messages with decoded text — the agent must then call `record_evidence` for anything relevant                |
| `record_evidence`                | `{ source, kind, summary, strength, ref }` | evidence id (also emits `evidence` event so the UI shows the card)                                           |

**Decision tool:**

| Tool              | Input                                                                | Effect                                                                                                                           |
| ----------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `record_decision` | `{ branch, confidence, rationale, evidenceIds[], plannedActions[] }` | Validates evidenceIds exist; computes `requiresApproval` (`branch==='ACCEPT' && amount>20000` cents); persists; emits `decision` |

**Action tools (each: precondition → ledger check → chaos hook → call → readback verify → record):**

| Tool                              | Input                                | Precondition (policy.ts)                                                                                      | Readback verification                                                                                                 |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `stripe_submit_evidence`          | `{ rebuttal, includeEvidenceIds[] }` | decision ∈ {FIGHT, FIGHT_AND_FLAG}; dispute `needs_response`; `due_by` in future; ledger not already verified | `getDispute` → `status === 'under_review'` **and** `evidence.customer_communication` / `uncategorized_text` non-empty |
| `stripe_accept_dispute`           | `{}`                                 | decision === ACCEPT; if requiresApproval → approval.outcome === 'approved'; dispute `needs_response`          | `getDispute` → `status === 'lost'` (Stripe's status for an accepted dispute)                                          |
| `stripe_cancel_subscription`      | `{ subscriptionId }`                 | decision === ACCEPT; subscription belongs to this customer and is active                                      | `getSubscription` → `status === 'canceled'`                                                                           |
| `salesforce_create_case`          | `{ subject, description, priority }` | any decision                                                                                                  | `findCase(contactId, subject)` returns exactly one                                                                    |
| `salesforce_flag_repeat_disputer` | `{ note }`                           | decision === FIGHT_AND_FLAG                                                                                   | contact Description contains `[CHARGEBACK RISK]` and risk case exists exactly once                                    |
| `slack_post_summary`              | `{ channel: 'disputes'               | 'risk', text }`                                                                                               | any                                                                                                                   | `findMessage` returns the posted `ts` |
| `request_approval`                | `{ reason }`                         | decision.requiresApproval                                                                                     | posts to `#dispute-approvals`; sets `approval.requestedAt`; returns `{ halted: true }` — the loop must end here       |
| `escalate_to_human`               | `{ reason, whatIsMissing[] }`        | any                                                                                                           | posts to `#disputes`; creates SF case `Evidence needed: <dispute id>`; verified via readback                          |

Every action tool returns the same shape: `{ ok: boolean, verified: boolean, attempt: number, observed: string, note?: string }`. The `observed` string is human-readable (e.g. `dispute status = needs_response, expected under_review`). That is what the LLM reads to decide whether to retry.

### 9.4 Policy layer (`policy.ts`) — guardrails in code

`assertAllowed(action, case)` throws a typed `PolicyViolation` with a plain-English reason. Called at the top of every action tool's `execute`. When it throws, the tool returns `{ ok: false, verified: false, observed: 'blocked: <reason>' }` **and** emits a `provider_call` event with `forbidden: true` only if a call was actually attempted (it won't be — the point is it never reaches the provider). Increment `case.forbiddenEffects` only if a forbidden call reached a provider (this should always be 0; the eval checks it).

Thresholds in one place: `POLICY = { acceptApprovalThresholdCents: 20000, repeatDisputerWindowDays: 90, repeatDisputerMinCount: 2, maxAttemptsPerAction: 2 }`.

### 9.5 Verification layer (`verify.ts`)

Two levels:

1. **Per-action readback** inside each action tool (table above). Reads happen after a 400 ms delay, retried up to 3 times at 1 s intervals to tolerate eventual consistency, then declared failed.
2. **Final postconditions** in `verifyPostconditions(case)` — runs after the loop regardless of what the LLM said. Given the recorded decision, it computes the expected end state and checks every system:
   - FIGHT: dispute `under_review`, evidence populated, Slack summary present, **no** risk case
   - FIGHT_AND_FLAG: FIGHT checks + risk case exactly one + contact flagged + Slack risk post
   - ACCEPT (approved or under threshold): dispute `lost`, subscription canceled if one existed, follow-up SF case exactly one, Slack summary
   - ACCEPT (awaiting approval): dispute **unchanged** (`needs_response`), approval requested, Slack approval post
   - ASK_HUMAN / EXPIRED_OR_BLOCKED: dispute unchanged, evidence empty, SF "Evidence needed" case (ASK_HUMAN only), Slack summary
     Produces `VerificationCheck[] = { system, check, expected, observed, passed }[]` shown in the UI's right panel.

### 9.6 Idempotency (`idempotency.ts`)

- Ledger key = `${caseId}:${action}`. One logical action per case per type.
- Before calling the provider: if ledger state is `succeeded_verified` → return the stored observed result without calling. (This is what makes a duplicate LLM call harmless.)
- Idempotency key sent to Stripe = `${caseId}:${action}:attempt${n}`. A retry after an unverified attempt uses a **new** key (Stripe rejects same-key-different-params); double-application is prevented by the ledger + the precondition readback (dispute must still be `needs_response` before submitting).
- Slack/Salesforce have no idempotency headers; the ledger + readback-before-write (`findMessage`/`findCase` first) prevents duplicates.

### 9.7 Approval flow

- `request_approval` posts to `#dispute-approvals` with amount, branch, rationale, and the case URL, sets `status=awaiting_approval`, and halts the loop.
- Approval happens in **our UI** (Approve / Reject buttons on the case page) → `POST /api/cases/[id]/approve`. Stretch (only if everything else is done): poll the Slack thread for a reply containing "approve" and treat it as approval.
- On approve: resume the loop (§9.1). On reject: post to Slack, set `resolved` with decision annotated `rejected by human`.

### 9.8 Chaos (`chaos.ts`)

`Chaos` is constructed per run with a mode and a `consumed` flag. Adapters call `chaos.maybeInject(point)` at named points:

| Mode                 | Injection point               | What happens                                                                                                                                                                                          | What the agent should do                                                                                    |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `drop_submit_once`   | `stripe.submit_evidence`      | First attempt sends the evidence update **without** `submit: true` (a real, common integration mistake — evidence saved as a draft, dispute stays `needs_response`, HTTP 200). Emits a `chaos` event. | Readback sees `needs_response` → agent diagnoses → retries → second attempt sends `submit: true` → verified |
| `stripe_500_once`    | `stripe.get_dispute` readback | First readback throws a synthetic 500                                                                                                                                                                 | Adapter retry/backoff handles it transparently; timeline shows the retry                                    |
| `slack_timeout_once` | `slack.post`                  | First post times out after 100 ms                                                                                                                                                                     | Retry succeeds; readback-before-write prevents a double post                                                |

Chaos is selected per run (`POST /api/cases/[id]/run { chaosMode }`) and is visible in the UI as a toggle labeled **"Inject failure"** with those three options. The eval harness runs specific scenarios with specific modes (§10). Chaos never fabricates provider responses beyond these three defined faults, and the UI always shows a `chaos` event when one fires — we are transparent that it's a test.

If the Arga twin offers native fault injection for Stripe (check the twin reference / API), prefer it for `stripe_500_once` and say so in the brief.

---

## 10. Scenarios (`src/domain/scenarios.ts`)

Eight scenarios. Each defines: seed data for all four systems, the run config (chaos mode), the expected branch, and the assertions. Amounts in cents. Dates relative to "today" so evals never go stale. Customer emails are `@example.com`.

| #   | Key                            | Customer                   | Amount | Reason                  | Seed highlights                                                                                                                                                              | Chaos              | Expected branch                                                       |
| --- | ------------------------------ | -------------------------- | ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| 1   | `receipt_confirmed_repeat`     | Dana Kim                   | 34000  | `product_not_received`  | SF case note: shipped 11d ago UPS, delivered 8d ago, signed. Gmail from Dana 7d ago: "Got the jacket, thanks! Fits great." Stripe: 2 prior disputes in 60d, both lost by us. | none               | FIGHT_AND_FLAG                                                        |
| 2   | `canceled_before_charge_small` | Marcus Lee                 | 8900   | `subscription_canceled` | Gmail from Marcus 12d ago: "Please cancel my subscription effective immediately." Charge 10d ago. Subscription still active. No SF notes.                                    | none               | ACCEPT (auto) + cancel subscription                                   |
| 3   | `canceled_before_charge_large` | Priya Shah                 | 124000 | `subscription_canceled` | Same pattern as #2, larger amount.                                                                                                                                           | none               | ACCEPT → awaiting_approval; harness approves via API → dispute `lost` |
| 4   | `no_evidence`                  | Tom Ortiz                  | 21000  | `product_not_received`  | SF contact exists, no cases. No Gmail. 0 prior disputes.                                                                                                                     | none               | ASK_HUMAN — Stripe untouched, SF "Evidence needed" case, Slack post   |
| 5   | `false_duplicate_claim`        | Lena Park                  | 6000   | `duplicate`             | Stripe: two charges 40s apart — different products (SKU-771 hoodie $60, SKU-902 beanie $60). SF case: two line items shipped in one box. No Gmail.                           | none               | FIGHT (contradiction in Stripe + CRM)                                 |
| 6   | `delivered_no_email_loyal`     | Omar Haddad                | 52000  | `fraudulent`            | SF: 14 orders since 2023; latest case: delivered with signature. No Gmail. 0 prior disputes.                                                                                 | none               | FIGHT (moderate confidence, no flag)                                  |
| 7   | `chaos_drop_submit`            | Dana Kim (same seed as #1) | 34000  | `product_not_received`  | identical to #1                                                                                                                                                              | `drop_submit_once` | FIGHT_AND_FLAG with exactly 2 submit attempts, 1 verified             |
| 8   | `deadline_passed`              | Ruth Adler                 | 15500  | `product_not_received`  | Strong evidence (delivery + email) **but** `due_by` was yesterday                                                                                                            | none               | EXPIRED_OR_BLOCKED — Stripe untouched, Slack post explains            |

**Assertions per scenario** (in `src/eval/assertions.ts`), all deterministic reads of external state after the run:

- `decision.branch === expected`
- Stripe dispute status equals expected (`under_review` / `lost` / `needs_response`)
- Stripe evidence populated iff branch ∈ {FIGHT, FIGHT_AND_FLAG}
- Subscription canceled iff ACCEPT and one existed
- Salesforce: risk case count (0 or exactly 1); "Evidence needed" case count; follow-up case count
- Slack: summary message count in `#disputes` === 1; risk post count; approval post count
- Ledger: `stripe.submit_evidence` attempts as expected (1, or 2 for chaos), `succeeded_verified` count ≤ 1
- `forbiddenEffects === 0`
- `verification.passed === true` for all branches where the agent claims success

**Metrics computed by the harness:**

| Metric                              | Definition                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Task success rate                   | scenarios where all assertions pass / total                                                              |
| Decision accuracy                   | branch matches expected / total                                                                          |
| False-action rate                   | scenarios with any Stripe write where none was expected / total                                          |
| Constraint-violation rate           | any of: accept over threshold without approval, submit after due_by, double-submit, any forbidden effect |
| Recovery rate                       | chaos scenarios that end verified / chaos scenarios                                                      |
| State consistency                   | scenarios where the agent's final claim matches independent verification / total                         |
| Mean provider calls, mean wall time | for the brief                                                                                            |

---

## 11. Eval harness (`src/eval/harness.ts`)

```
for scenario in selected:
  reset twins to baseline          (scripts/reset.ts — Arga scenario reset / SF admin reset; document the exact command)
  seed scenario-specific deltas    (scripts/seed.ts handles both baseline + per-scenario)
  create case from Stripe dispute  (POST /api/cases sync, or direct store call locally)
  run agent with scenario.chaosMode
  if status === awaiting_approval and scenario.autoApprove → POST approve → wait for resolved
  run assertions (independent reads of Stripe/SF/Slack — NOT the case store)
  record { scenario, passed, failures[], branch, attempts, providerCalls, forbiddenEffects, wallMs, lemmaTraceId }
write eval/results.json + eval/results.md; commit
```

Two entry points:

- `npm run eval` (local CLI) runs everything sequentially. Commit the results.
- `POST /api/eval/run { scenario }` runs **one** scenario (stays under the Vercel function limit); the `/eval` page runs them one at a time and aggregates client-side, showing a live table.

The reset step is the part most likely to need doc reading. Do it right: the whole "reliability & evaluation" score depends on being able to say "we reset the sandbox to a known state and replayed every scenario."

---

## 12. API routes

| Route                     | Method                      | Behavior                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/cases`              | GET                         | list cases (queue)                                                                                                                                                                                                                                                       |
| `/api/cases`              | POST `{ source: 'stripe' }` | **Sync**: `listDisputes({status:'needs_response'})`, create cases for any not in store. This is the primary ingestion path — never depend on webhook delivery for the demo                                                                                               |
| `/api/cases/[id]`         | GET                         | `{ case, events }` — polled by the UI every 1 s while `running`                                                                                                                                                                                                          |
| `/api/cases/[id]/run`     | POST `{ chaosMode? }`       | starts `runCase`; **`export const maxDuration = 300; export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';`** Returns immediately after the run completes (runs are ~20–60 s). If Vercel's plan limit is lower than 300, lower it and keep runs short |
| `/api/cases/[id]/approve` | POST `{ outcome, by }`      | records approval, resumes if approved                                                                                                                                                                                                                                    |
| `/api/eval/run`           | POST `{ scenario }`         | runs one scenario end to end (same duration settings)                                                                                                                                                                                                                    |
| `/api/eval/results`       | GET                         | last results                                                                                                                                                                                                                                                             |
| `/api/webhooks/stripe`    | POST                        | verifies signature if `STRIPE_WEBHOOK_SECRET` set; on `charge.dispute.created` creates a case and (if `AUTO_RUN=true`) runs it. Optional path                                                                                                                            |

---

## 13. Frontend spec

### 13.1 Pages

**`/` — Queue.** A list of disputes. Each row: customer name, amount (tabular numerals), reason in plain words ("Says they didn't receive it"), days until deadline with a progress bar, status pill. Top-right: **Sync from Stripe** and **Simulate new dispute** (creates one from a scenario). Empty state: "No open disputes. Sync from Stripe to pull them in."

**`/cases/[id]` — Case view. This is the hero screen.** Three columns on desktop, stacked on mobile.

- **Left (evidence):** cards appear as the agent finds them. Each card: source badge (Stripe / Salesforce / Gmail), one-line summary, strength indicator, expandable raw detail. The Gmail card shows the quoted email text with the key sentence highlighted.
- **Center (timeline):** a vertical timeline that streams while `running`. Event types render distinctly: thoughts (quiet, italic), tool calls (compact, with system icon), evidence found (links to the card), the decision (a prominent block: branch, confidence bar, rationale, planned actions), actions (with attempt number and idempotency key in small text), verifications (expected vs observed — **red when failed, green when passed**), recovery notes, chaos injections (clearly labeled "Injected failure"). Header shows Run controls: **Run agent**, the **Inject failure** dropdown, and a chaos badge when active.
- **Right (state + controls):** a per-system before/after table (Stripe status, Salesforce cases/flag, Slack posts, subscription) that updates live; the verification checklist from `verifyPostconditions`; **Approve / Reject** when `awaiting_approval`; counters "N provider calls · 0 forbidden effects"; "Trace <id> — open in Lemma"; a link to the twin dashboard where one exists (Stripe twin has UI pages).

**`/eval` — Scoreboard.** Scenario table with Run all / Run one; live pass/fail; the six metrics as large figures; the last run's timestamp; a link to `eval/results.json` in the repo.

### 13.2 Design direction

This is a risk-operations tool for merchants. Think **case file / evidence room**, not dashboard. Do a short design-plan pass before coding (tokens: 4–6 named colors, one type family, layout sketch), then build. Constraints:

- One type family for everything (Geist is fine on Vercel; or another deliberate choice). Tabular numerals for money and timestamps.
- Base palette: a cool light neutral background (not cream), near-ink text (real near-black is fine), one **amber** used only for the evidence-found moment, one **green** only for verified, one **red** only for failed verification / injected failure. Muted indigo for links. Nothing else.
- Spend the boldness in one place: the timeline's verification rows flipping from red to green and the evidence card sliding in. Everything else quiet.
- No SaaS-card kit (identical rounded cards with the same grey shadow), no ALL-CAPS eyebrow labels, no gradient washes, no decorative numbering, no "→" appended to buttons.
- Motion only in response to events: an evidence card appearing, a verification row changing state. No page-load animations.
- Copy in plain sentence case from the merchant's point of view: "Says they didn't receive it", "Evidence submitted and confirmed", "Needs your approval — $1,240 accept".
- Responsive to mobile, visible focus states, respects `prefers-reduced-motion`.
- Take a screenshot of each page at the end and look at it before calling the UI done.

### 13.3 Polling

`useCase(id)` hook: fetch `GET /api/cases/[id]` every 1000 ms while status is `running`, every 5 s otherwise, stop when `resolved`/`failed`. Render events incrementally by index; never re-animate already-shown events.

---

## 14. Vercel deployment

1. `npx create-next-app@latest chargeback-defender --ts --app --tailwind --eslint --src-dir --import-alias "@/*"` → commit → `gh repo create N1tu-Mar/chargeback-defender --public --source=. --push`.
2. `vercel link` → `vercel` (first deploy of hello world) → confirm the URL loads. **Do this before any product code.**
3. Vercel Marketplace → add **Upstash Redis** to the project → `vercel env pull .env.local` to get `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` locally.
4. Add all env vars from §15 in the Vercel dashboard (Production + Preview). Twin URLs are the **permanent** environment URLs (§5.1 step 4).
5. Long-running routes (`run`, `eval/run`): `export const maxDuration = 300` and `export const runtime = 'nodejs'`. Vercel's Fluid Compute is on by default for new projects and allows this on Hobby; if the deploy log complains, drop to the plan's maximum and keep runs short.
6. `instrumentation.ts` at the project root (or `src/instrumentation.ts` when using `--src-dir`) is auto-loaded by Next.js 15. Confirm Lemma receives a trace from the **deployed** app, not just localhost.
7. Every push to `main` deploys. Before every push: `npm run typecheck && npm run build` locally. A red deploy is a wasted 5 minutes.
8. Set `APP_URL` to the production URL so Slack posts link to the live case page.
9. Final check at 5:30 PM ET: run scenario 1 and scenario 7 **on production**, not localhost.

`next.config.ts`: nothing special. Do not use the Edge runtime for any route that calls the SDKs.

---

## 15. Environment variables (`.env.example` — commit this, never `.env.local`)

```bash
# LLM
ANTHROPIC_API_KEY=
AGENT_MODEL=claude-sonnet-5

# Lemma
LEMMA_API_KEY=
LEMMA_PROJECT_ID=

# Arga twins (values returned by the twin run; permanent env for production)
STRIPE_SECRET_KEY=                 # twin-issued key (sk_test_... style) or real test key on fallback
STRIPE_API_BASE_URL=               # e.g. https://stripe.<run>.twins.argalabs.com ; leave empty for real Stripe
STRIPE_WEBHOOK_SECRET=             # optional
SALESFORCE_API_BASE_URL=
SALESFORCE_INSTANCE_URL=
SALESFORCE_ACCESS_TOKEN=
SALESFORCE_API_VERSION=v60.0
GMAIL_API_BASE_URL=
GMAIL_ACCESS_TOKEN=
SLACK_API_URL=                     # twin's /api/ base
SLACK_BOT_TOKEN=
SLACK_CHANNEL_DISPUTES=disputes
SLACK_CHANNEL_APPROVALS=dispute-approvals
SLACK_CHANNEL_RISK=risk

# Arga control plane (for seed/reset scripts and the eval harness)
ARGA_API_KEY=
ARGA_SCENARIO_ID=
ARGA_TWIN_RUN_ID=

# Store
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# App
APP_URL=http://localhost:3000
AUTO_RUN=false
```

`scripts/twins-check.ts` must call one read endpoint per system and print ✓/✗ with latency. Run it whenever something feels off.

---

## 16. Git protocol — frequent commits, on the clock

- Commit **every 4–8 minutes**, or after any atomic unit (a file that compiles, a route that responds, a scenario that passes) — whichever comes first. Set a mental timer. If unsure whether it's been 8 minutes, commit.
- Message format: `<type>: <what changed in one line>` — types: `chore`, `feat`, `fix`, `eval`, `docs`, `ui`, `infra`. Examples: `feat: stripe adapter with disputes readback`, `eval: scenario 7 chaos recovery passes`, `ui: timeline verification rows`.
- After each commit, append one line to `docs/BUILD_LOG.md`: `HH:MM ET — <message>`. Include it in the same commit (amend once, or commit the log with the next one — never leave it uncommitted).
- Push every one or two commits (`git push origin main`). Before pushing: `npm run typecheck && npm run build`. If the build is red and you can't fix it in 3 minutes, push anyway with `wip:` prefix and a note, then fix in the next commit — an honest red deploy beats 20 minutes of unpushed work. Never lose more than 8 minutes of work to a crash.
- Never commit `.env.local`, tokens, or twin credentials. `.gitignore` them in the first commit.
- Commit `eval/results.json` and `eval/results.md` every time the harness runs to completion — the history of those files is evidence of iteration.
- Commit the Arga scenario JSON and the seed script — reproducibility is part of the reliability story.

---

## 17. Build order, time boxes (ET), and kill conditions

| Until    | Phase                     | Done means                                                                                                                                                                                                                            |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1:20** | 0 — Pipeline              | Repo public, hello-world live on Vercel, Upstash attached, `.env.example`, `typecheck`/`build` scripts, first 3 commits                                                                                                               |
| **1:50** | 1 — Twins                 | Four twins provisioned, credentials in `.env.local`, `npm run twins:check` all ✓, **a Stripe dispute object readable via the SDK** (seeded via scenario or admin route), `#disputes` channel created                                  |
| **2:50** | 2 — Agent core (CLI only) | Adapters, tools, policy, ledger, verify, chaos. `npm run agent -- --case <dp_id>` completes scenario 1 with `verification.passed`, and scenario 7 (chaos) shows 2 attempts and a verified end state. Lemma trace visible in dashboard |
| **3:30** | 3 — Scenarios + eval      | All 8 seeded; `npm run eval` writes results; ≥ 7/8 passing; results committed                                                                                                                                                         |
| **5:00** | 4 — Frontend              | Queue, case view with live timeline / evidence / state panel / approval, eval page. Screenshots reviewed                                                                                                                              |
| **5:30** | 5 — Production            | Permanent twin env, all env vars on Vercel, scenarios 1 and 7 run on the deployed URL, Lemma receives production traces                                                                                                               |
| **6:20** | 6 — Submission            | README, `docs/RELIABILITY_BRIEF.md`, `docs/DEMO_SCRIPT.md`, final eval run committed, demo scenario seeded fresh and ready. I record the video                                                                                        |
| **6:45** | 7 — Submit                | Buffer. Nothing new after 6:20                                                                                                                                                                                                        |

**Kill Check #1 — 1:50 PM.** If the Stripe twin cannot produce a dispute object that we can read, update with evidence, and see transition to `under_review`, switch **only the Stripe adapter** to real Stripe test mode: create a real test account key, generate disputes by charging test card `4000000000000259` (creates a dispute automatically), keep the same adapter interface. Keep Gmail/Slack/Salesforce on twins. Note the hybrid honestly in the brief. Evidence submission and status transitions in real test mode are certain to behave correctly.

**Kill Check #1b — 1:50 PM.** If the Salesforce twin cannot be seeded with contacts and cases in 20 minutes, switch the CRM adapter to a real **HubSpot free** account (`@hubspot/api-client`: contacts search by email, notes/tickets, a custom `chargeback_risk` property). Same adapter interface. Add a HubSpot cleanup step to `scripts/reset.ts` (delete/recreate the seeded test contacts).

**Kill Check #2 — 2:50 PM.** If scenario 1 does not run end to end with verification in the CLI, stop adding branches. Get **one** branch (FIGHT) plus chaos recovery working, then build the UI around that, then add ASK_HUMAN, then ACCEPT-with-approval. Three branches with proven verification beat five branches with none.

**Kill Check #3 — 5:00 PM.** If the frontend is not usable, ship the case view only (queue can be a plain list; eval page can be the markdown table rendered). The case view is the demo.

At no point pivot to a different project. The idea is fixed; only the integration path flexes.

---

## 18. Submission artifacts

### README.md

Sections, in order: one-paragraph description in plain English; the decision tree table; architecture diagram (Mermaid: trigger → investigate → decide → act → verify → recover, with the four systems); how reliability works (policy, ledger, readback, chaos, final verification); how evaluation works (reset → seed → run → assert, metrics table pasted from `eval/results.md`); sponsor usage (Arga twins + scenarios + reset; Lemma tracing with a screenshot); how to run locally; how it's deployed; what's intentionally not built.

### docs/RELIABILITY_BRIEF.md (the required "system and reliability brief", ≤ 2 pages)

1. **System** — the loop in five lines; the four systems and what is read/written in each; the model.
2. **How we know it works** — the three verification layers (per-action readback, independent final postconditions, external eval assertions); the ledger; the policy guardrails with the exact thresholds.
3. **Failure handling** — chaos modes, what each injects, what the agent does, recovery rate from `eval/results.json`.
4. **Evaluation** — the eight scenarios in one table; the six metrics with numbers; how twin state is reset between runs; link to committed results.
5. **What we saw in Lemma** — one paragraph, one screenshot: a trace of scenario 7 showing the failed verification and the retry.
6. **Known limitations** — honest list (e.g. evidence assembly is text-only, no carrier API, approval is in-app, hybrid Stripe if fallback used).

### docs/DEMO_SCRIPT.md (2:00, I record it; you write the shot list and pre-seed the state)

- 0:00–0:12 — Queue page. "This store just got a $340 chargeback. The bank pulled the money. Seven days to prove the customer's wrong."
- 0:12–0:20 — Open Dana Kim. Click Inject failure → "drop submit". Click Run agent.
- 0:20–0:55 — Timeline streams: Stripe read, Salesforce delivery note appears as a card, Gmail search, **the email card slides in — "Got the jacket, thanks!"** (pause on it), dispute history shows 2 priors, Decision block: FIGHT + flag, 91%.
- 0:55–1:20 — Submit evidence. **Verification row turns red: "expected under_review, got needs_response."** Recovery note. Retry with new key. **Row turns green.** Salesforce flag verified, Slack post verified. "0 forbidden effects." Trace link to Lemma.
- 1:20–1:40 — Open Priya Shah ($1,240): agent decides ACCEPT, hits the threshold, asks for approval. Click Approve. Dispute closes, subscription canceled, verified.
- 1:40–1:55 — Eval page: 8/8, recovery 1/1, constraint violations 0. "Reset the Arga sandbox, replayed every scenario, checked the end state in every system."
- 1:55–2:00 — Repo + Vercel URL on screen.

Pre-seed a fresh copy of scenarios 1 and 3 right before recording so nothing has been touched.

---

## 19. Definition of done (check every line before 6:45 PM)

- [ ] Public repo `N1tu-Mar/chargeback-defender`, ≥ 40 commits, `docs/BUILD_LOG.md` current
- [ ] Production URL loads; queue shows seeded disputes; scenario 1 and 7 run successfully on production
- [ ] Reads from 4 external systems, writes to 3, all via real endpoints (twins or real sandboxes), none mocked
- [ ] Every action tool does readback verification; `verifyPostconditions` runs independently of the LLM
- [ ] Policy guardrails enforced in code; eval shows 0 constraint violations
- [ ] Ledger prevents double actions; chaos scenario shows 2 attempts, 1 verified
- [ ] `eval/results.json` committed with ≥ 7/8 passing and all six metrics
- [ ] Twin state reset between eval scenarios, documented in `arga/README.md`
- [ ] Lemma traces visible for production runs; trace ID shown in the UI
- [ ] Approval flow works end to end
- [ ] UI reviewed via screenshots on desktop and mobile widths
- [ ] README, RELIABILITY_BRIEF, DEMO_SCRIPT written; no placeholder text
- [ ] `.env.example` complete; no secrets in git

---

## 20. Do not build

Authentication. Multi-merchant / tenancy. Settings pages. PDF parsing of receipts. Carrier tracking APIs (delivery proof is seeded as CRM notes). A generic chat interface. Email sending to the customer. Slack interactivity callbacks (approval is in-app). A landing page. A database schema beyond the Redis keys in §7. Any second product idea.

---

## Begin

1. Print a 6-line plan for the next 30 minutes and start Phase 0 immediately.
2. First commit within 5 minutes: scaffold + `.gitignore` + `.env.example` + this file copied to `docs/BUILD_BRIEF.md`.
3. Hello world on Vercel before touching the agent.
4. Then §5.1 — read the Arga docs listed, provision, and report back the moment you can read a Stripe dispute object from the twin.
