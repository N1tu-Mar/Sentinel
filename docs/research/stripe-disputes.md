# Stripe Disputes — verified reference

Fixtures: `fixtures/stripe/`. Legend: **V** = verified in docs opened 2026-09-13 (URL given). **K** = known Stripe behavior, doc not re-opened this session. **U** = UNVERIFIED.

## Dispute object — https://docs.stripe.com/api/disputes/object (V)
| field | type | notes |
|---|---|---|
| id | string | **prefix `du_`** in current docs (older disputes `dp_`). Accept both. |
| object | "dispute" | |
| amount | int cents | may differ from charge amount (partial / FX) |
| balance_transactions | array | 0–2 (withdrawn, reinstated) |
| charge | string `ch_` | expandable |
| created | unix seconds | |
| currency | lowercase ISO | |
| enhanced_eligibility_types | enum[] | `mastercard_compliance`, `visa_compelling_evidence_3`, `visa_compliance` |
| evidence | object | see below. "Updating any field in the hash submits all fields in the hash for review." |
| evidence_details | object | `due_by` (unix s), `has_evidence` (bool), `past_due` (bool), `submission_count` (int) |
| is_charge_refundable | bool | "If true, it's still possible to refund the disputed payment." Accept branch: if true, refunding stops further withdrawals — but we use `/close` (accept) instead. |
| livemode, metadata | | |
| payment_intent | string `pi_` nullable | |
| payment_method_details | object nullable | `type` + `card.{brand, case_type, network_reason_code}` (K; case_type values `chargeback`/`inquiry`/`compliance`/`block`/`request` = U) |
| reason | enum | `bank_cannot_process, check_returned, credit_not_processed, customer_initiated, debit_not_authorized, duplicate, fraudulent, general, incorrect_account_details, insufficient_funds, noncompliant, product_not_received, product_unacceptable, subscription_canceled, unrecognized` |
| status | enum | `warning_needs_response, warning_under_review, warning_closed, needs_response, under_review, won, lost, prevented`. **`charge_refunded` NOT in current enum** — `prevented` is new. |

## Evidence fields — https://docs.stripe.com/api/disputes/update.md?query=evidence (V)
Combined character count of all fields ≤ **150,000**. Fields marked 20k have per-field max 20,000.

Text: `access_activity_log`(20k), `billing_address`, `cancellation_policy_disclosure`(20k), `cancellation_rebuttal`(20k), `customer_email_address`, `customer_name`, `customer_purchase_ip`, `duplicate_charge_explanation`(20k), `duplicate_charge_id`, `product_description`(20k), `refund_policy_disclosure`(20k), `refund_refusal_explanation`(20k), `service_date`, `shipping_address`, `shipping_carrier`, `shipping_date`, `shipping_tracking_number`, `uncategorized_text`(20k).

File ID (upload via `/v1/files` with `purpose=dispute_evidence` — V https://docs.stripe.com/disputes/api): `cancellation_policy`, `customer_communication`, `customer_signature`, `duplicate_charge_documentation`, `receipt`, `refund_policy`, `service_documentation`, `shipping_documentation`, `uncategorized_file`.

**Gotcha:** `customer_communication` is a FILE field. Put quoted email text in `uncategorized_text` unless you upload a file. Dates (`shipping_date`, `service_date`) are human-readable strings, not unix.

Also `enhanced_evidence.visa_compelling_evidence_3.{disputed_transaction{...}, prior_undisputed_transactions[exactly 2]{charge (required), customer_account_id, customer_device_fingerprint(≥20 chars), customer_device_id(≥15), customer_email_address, customer_purchase_ip, product_description, shipping_address{city,country,line1,line2,postal_code,state}}}` and `*_compliance.fee_acknowledged`. **Stretch verdict: skip.** CE3.0 targets `fraudulent` only, needs two prior undisputed charges ≥120 days old sharing IP/device (K); our friendly-fraud case has *lost* prior disputes, not undisputed ones.

## Endpoints (V unless noted)
| op | request | notes |
|---|---|---|
| retrieve | `GET /v1/disputes/:id` | |
| list | `GET /v1/disputes?charge=&payment_intent=&created[gte]=&limit=(1-100, default 10)&starting_after=&ending_before=` | **No `customer` filter.** For repeat-disputer check: list prior charges by customer (`GET /v1/charges?customer=cus_`, K), then `disputes?charge=` each — or list `created[gte]=now-90d` and join on charge.customer. Response `{object:"list", url, has_more, data[]}` |
| update | `POST /v1/disputes/:id` form: `evidence[field]=`, `metadata[k]=`, `submit=true|false` | `submit` default **true**. `false` = staged (visible, editable), submit later with `true`. |
| close | `POST /v1/disputes/:id/close` (no params) | "Closing a dispute is irreversible." Status `needs_response` → `lost`. |

Submit semantics: after `submit=true`, status → `under_review` (warning → `warning_under_review`), `submission_count` +1, `has_evidence=true`. Updating evidence after submission is not possible (K — Stripe returns 400 once under review; exact message U). **Treat submit as final.**

Test mode: `uncategorized_text=winning_evidence` → won; `losing_evidence` → lost; `escalate_inquiry_evidence` → inquiry becomes chargeback (V https://docs.stripe.com/testing#disputes). **Never put these strings in real narratives.**

## Idempotency — https://docs.stripe.com/api/idempotent_requests (V)
- Header `Idempotency-Key` (stripe-node: `{ idempotencyKey }` request option). ≤255 chars. V4 UUID suggested; no PII.
- Server saves status code + body of first request that *began executing* (success or failure, including 500). Same key ⇒ same result replayed.
- Keys prunable after ≥24h; reuse after pruning = new request.
- Same key + **different params ⇒ error** (idempotency_error, K).
- Not saved when params fail validation or conflict with concurrent request ⇒ safe to retry.
- Only POST. GET/DELETE ignore it.
- Replay marker: response header `Idempotent-Replayed: true` (K, not on this page — U for twin).

**Injected-failure recovery rule:** attempt 1 key `sentinel:{dispute_id}:submit:1`. Readback still `needs_response` ⇒ retrying with the SAME key replays the saved 200 and changes nothing. Must use a NEW key (`...:submit:2`) and identical-or-new params. Before attempt 2, re-read: if `submission_count ≥ 1` or status ≠ needs_response, do NOT resubmit. Verify end: `status==under_review && submission_count==1`.

## Webhooks
Events (V https://docs.stripe.com/api/events/types):
| event | fires |
|---|---|
| charge.dispute.created | customer disputes a charge |
| charge.dispute.updated | dispute updated (usually evidence) |
| charge.dispute.closed | status → `lost`, `warning_closed`, or `won` |
| charge.dispute.funds_withdrawn | funds removed |
| charge.dispute.funds_reinstated | funds returned after close |

Envelope (V https://docs.stripe.com/webhooks + K): `{id:"evt_", object:"event", api_version, created, data:{object, previous_attributes?}, livemode, pending_webhooks, request:{id, idempotency_key}, type}`. `previous_attributes` only on `*.updated`. created→updated diff: `status`, `evidence.*`, `evidence_details.has_evidence/submission_count`, `is_charge_refundable`.

Signature (V https://docs.stripe.com/webhooks): header `Stripe-Signature: t=<unix>,v1=<hex>[,v0=...]`. signed_payload = `t + "." + rawBody`; HMAC-SHA256 with `whsec_` secret; constant-time compare against every `v1`; ignore non-v1; default tolerance 5 min. Needs **raw body** — Next.js App Router: `await req.text()` then `stripe.webhooks.constructEvent(body, sig, secret)`. Sandbox retries: 3 times over a few hours. No ordering guarantee; dedupe on `event.id`.

## Related objects (fields we read; K — https://docs.stripe.com/api/charges/object, /customers/object, /refunds/object)
- Charge: `id, amount, amount_refunded, currency, customer, receipt_email, billing_details{address,email,name}, shipping{address,carrier,name,tracking_number}, payment_intent, outcome{network_status,risk_level,risk_score,type}, refunded, disputed, created, metadata`.
- Customer: `id, email, name, created, metadata`.
- Refund: `id, charge, amount, created, currency, reason (duplicate|fraudulent|requested_by_customer), status (pending|requires_action|succeeded|failed|canceled)`. List: `GET /v1/refunds?charge=`.

## Test cards (fallback if twin can't seed) — https://docs.stripe.com/testing#disputes (V)
| card | result |
|---|---|
| 4000000000000259 | dispute `fraudulent` |
| 6026507838377928 | Discover, `fraudulent` |
| 4000000000002685 | dispute `product_not_received` |
| 4000000000001976 | **inquiry** (`warning_needs_response`) |
| 4000000000005423 | early fraud warning (no dispute) |
| 4000000404000079 | multiple disputes |
| 4000000404000038 | Visa CE3.0 eligible |
| 4000008400000779 / 5105008400000002 | Visa / Mastercard compliance |
| 4000000001000043 | Smart Disputes eligible |
PaymentMethod token shortcut: `pm_card_createDisputeInquiry` (V, update docs prereq). Other `pm_card_createDispute*` tokens = U.
