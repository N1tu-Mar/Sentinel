# DATA CONTRACT — Sentinel tools

Read by build agent + runtime model. Constants: merchant **Juniper & Pine Outfitters** (`support@juniperpine.example`), approval threshold **20000 cents ($200.00)** — accept with `amount > 20000` needs human approval. Slack channels `#disputes`, `#dispute-approvals`, `#risk` (resolve IDs at startup). Detail docs: stripe-disputes.md, salesforce-crm.md, gmail.md, slack.md. Example payloads: `fixtures/`.

## Stripe
| tool | input | output (trimmed) | preconditions | readback proof | gotchas |
|---|---|---|---|---|---|
| stripe.getDispute | `{disputeId}` | `{id, amount, currency, charge, payment_intent, reason, status, created, evidence, evidence_details{due_by,past_due,has_evidence,submission_count}, is_charge_refundable}` | — | — | id `du_`/`dp_`; `due_by` unix s |
| stripe.listDisputes | `{charge?, payment_intent?, createdGte?}` | `{data:[dispute], has_more}` | — | — | no `customer` filter; paginate `starting_after`; exclude current dispute id |
| stripe.getCharge | `{chargeId}` | `{id, amount, amount_refunded, refunded, currency, customer, receipt_email, billing_details, shipping{address,carrier,tracking_number}, outcome, created}` | — | — | cents |
| stripe.getCustomer | `{customerId}` | `{id, email, name, created, metadata}` | — | — | email may be null → use charge.billing_details.email |
| stripe.listRefunds | `{chargeId}` | `{data:[{id, amount, created, reason, status}]}` | — | — | only `status=succeeded` counts |
| stripe.submitEvidence | `{disputeId, evidence{...}, idempotencyKey}` → `POST /v1/disputes/:id` `evidence[..]`, `submit=true`, header `Idempotency-Key` | dispute | status ∈ {needs_response, warning_needs_response}; `!past_due`; `now < due_by`; `submission_count==0`; text ≤20k/field, ≤150k total; branch ∈ FIGHT* | getDispute: `status` ∈ {under_review, warning_under_review} AND `submission_count==1` | **final/irreversible**; file fields need `/v1/files purpose=dispute_evidence` IDs; dates as readable strings |
| stripe.closeDispute | `{disputeId, idempotencyKey}` → `POST /v1/disputes/:id/close` | dispute | same status/deadline checks; branch ACCEPT; if `amount>20000` recorded approval | getDispute: `status=="lost"` (inquiry: `warning_closed`) | **irreversible** |

## Salesforce
| tool | input | output | preconditions | readback | gotchas |
|---|---|---|---|---|---|
| sf.findContact | `{email}` | `{Id, Name, Email, Description}` or null | escape `'` | — | `totalSize==0` ⇒ null; parse Description lines `LTV_CENTS`, `PRIOR_DISPUTES_90D`, `RISK_FLAG` |
| sf.listCases | `{contactId, days=180}` | `[{Id, CaseNumber, Subject, Description, Status, Type, CreatedDate}]` | — | — | delivery = Description has `TRACKING:` + `DELIVERED:` |
| sf.updateContact | `{contactId, riskFlag}` | `{ok}` | read Description first; rewrite only RISK_FLAG line | findContact: Description matches `RISK_FLAG: friendly_fraud` | PATCH 204 empty body; Description replaced whole |
| sf.createCase | `{contactId, subject, description, priority}` | `{id}` | dedupe: query Case by ContactId + Subject first | `GET /sobjects/Case/{id}` Subject equals | picklist values U on twin |

## Gmail
| tool | input | output | readback | gotchas |
|---|---|---|---|---|
| gmail.searchThreads | `{email, afterDate}` → `q=from:E OR to:E after:YYYY/MM/DD` | `[{id, snippet}]` | — | empty ⇒ key missing |
| gmail.getThread | `{threadId}` | `[{id, from, to, subject, date(ISO from internalDate), text}]` (decoded) | — | internalDate epoch **ms string**; base64url no padding; strip quoted replies |

## Slack
| tool | input | output | readback | gotchas |
|---|---|---|---|---|
| slack.postMessage | `{channel (ID), text, blocks?}` | `{ts, channel}` | slack.readback | HTTP 200 even on error — check `ok`; always send `text` |
| slack.readback | `{channel, ts}` | `{found, text}` | `conversations.history oldest=ts inclusive=true limit=1` → `messages[0].ts===ts` | `not_in_channel` ⇒ join |

## Verify rule
After every write: read back. Observed ≠ expected ⇒ action FAILED (even if HTTP 200). Record `{expected, observed, passed}`.

## Injected failure: silent submit drop (scenario-07)
1. submit attempt 1, key `sentinel:{disputeId}:submit_evidence:1` → 200.
2. getDispute → `needs_response`, `submission_count 0` ⇒ mismatch, log recovery.
3. Re-read to confirm no concurrent success. If `submission_count≥1` or `under_review` ⇒ STOP (already applied).
4. submit attempt 2 with **new key** `…:2` (same key would replay the stored 200 and change nothing; same key + different params ⇒ idempotency error).
5. getDispute → `under_review` && `submission_count==1` ⇒ verified. Else escalate ASK_HUMAN; no attempt 3.

## Gotchas
- **Money:** Stripe amounts integer cents, currency lowercase. Display `$(amount/100).toFixed(2)`. Threshold compare in cents.
- **Time:** Stripe unix **seconds**; Salesforce ISO-8601 `+0000`; Gmail `internalDate` epoch **ms string**; Slack `ts` string `"1757764800.000100"` (ID, not a number to round). Convert all to ms internally (`types.ts dueBy` is ms).
- **submit=true finality:** default is true; one shot; no edits after. Use `submit=false` only if staging.
- **Evidence limits:** 20,000 chars on long text fields; 150,000 combined. Truncate narrative, never silently drop required fields.
- **Idempotency:** header `Idempotency-Key`, ≤255 chars, ≥24h retention, POST only; same key replays first response (incl. 500s); different params + same key ⇒ error; new key only after readback proves the write didn't land.
- **due_by:** block if `past_due` OR `due_by*1000 <= Date.now()`; also warn when <24h left.
- **base64url:** `Buffer.from(data, "base64url")`; not plain `atob`.
- **Slack channels:** API wants IDs (`C…`); names only via conversations.list lookup; twin starts with no channels.
- **Repeat-disputer count:** disputes on *other* charges of same customer with `created >= now-90d`, excluding the current dispute.
- **Twin IDs** won't match fixture IDs; match seeded data by customer email.
