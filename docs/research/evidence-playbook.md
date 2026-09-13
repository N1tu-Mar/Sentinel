# Evidence playbook (runtime prompt material)

Basis: https://docs.stripe.com/disputes/categories and /disputes/best-practices (K, not re-opened this session; field names V in stripe-disputes.md). Write evidence as facts with dates, amounts, IDs. Never argue emotionally.

## Universal rules
- Fill every field you have real data for: `customer_name`, `customer_email_address`, `product_description`, `billing_address`, plus reason-specific fields.
- `uncategorized_text` narrative (≤20,000 chars; total ≤150,000): 1) one-line summary of why the claim is wrong; 2) timeline with dates (order, ship, delivery, customer contact, dispute); 3) quoted customer words verbatim with sender + date; 4) record IDs (order, tracking, charge). Plain text, short paragraphs.
- Never: invent facts, include full card numbers, attach unrelated customer data, use the test strings `winning_evidence`/`losing_evidence`, submit after `due_by`, submit twice, insult the cardholder.
- If you can't cite a record for a claim, leave it out.

## By reason
| reason | fill | strong narrative | never |
|---|---|---|---|
| product_not_received | `shipping_carrier`, `shipping_tracking_number`, `shipping_date`, `shipping_address` (must match charge shipping/billing), `shipping_documentation` (file) | carrier + tracking + delivered date to the address on the charge; customer email confirming receipt quoted | claim delivery without tracking/record |
| fraudulent | `customer_purchase_ip`, `billing_address`, `shipping_address`, `customer_email_address`, AVS/CVC pass (from charge.outcome/checks) in text; prior undisputed orders same customer | card checks passed, shipped to cardholder's billing address, customer later communicated about the order (proves they are the buyer) | ship-to mismatch unaddressed |
| product_unacceptable | `product_description`, `refund_policy` (file), `refund_policy_disclosure`, `refund_refusal_explanation` | item matched description; customer never requested return per policy, or used it | dismiss documented defect |
| subscription_canceled | `cancellation_policy` (file), `cancellation_policy_disclosure`, `cancellation_rebuttal`, `service_date` | customer did not cancel before renewal per policy; usage after renewal | fight if customer emailed cancel before charge ⇒ **ACCEPT instead** |
| duplicate | `duplicate_charge_id`, `duplicate_charge_explanation`, `duplicate_charge_documentation` | two charges are distinct orders (different items/dates/shipments) | fight a true duplicate with no refund ⇒ ACCEPT |
| credit_not_processed | `refund_policy_disclosure`, `refund_refusal_explanation`, refund IDs if issued | refund already issued (id, date, amount) or customer not eligible per disclosed policy | claim refund without `re_` record |
| unrecognized | `customer_name`, `customer_email_address`, `billing_address`, `product_description`, receipt | descriptor ↔ merchant name, receipt emailed to customer's address, delivery | — |
| general | `uncategorized_text` + any of above | whichever facts apply | — |

## Decision gates (code enforces; model should expect)
1. `status` not `needs_response`/`warning_needs_response`, or `evidence_details.past_due`, or `due_by < now` ⇒ EXPIRED_OR_BLOCKED: no Stripe write, post Slack.
2. Customer cancellation email dated before `charge.created` ⇒ ACCEPT (close). amount > 20000 cents ⇒ Slack approval + recorded human approval first.
3. Delivery record (SF Case with TRACKING/DELIVERED) and/or customer receipt-confirmation email ⇒ FIGHT.
4. FIGHT + ≥2 other disputes on this customer's charges with `created` in last 90 days ⇒ FIGHT_AND_FLAG (SF `RISK_FLAG: friendly_fraud`, risk Case, Slack #risk).
5. None of the above ⇒ ASK_HUMAN: SF Case "Evidence needed" listing exact gaps (e.g. "no delivery record in Salesforce", "no email thread in Gmail") + Slack with due date.

## Friendly-fraud indicators
- ≥2 disputes in 90 days on the same customer (Stripe list, join by charge.customer).
- Customer confirmed receipt in writing, then disputed as not received.
- Dispute filed after a refund request was refused, or instead of using the return process.
- Delivery signature matches cardholder name; order shipped to billing address.
- Continued orders/logins after disputing an earlier charge as fraudulent.
Flag = note risk, still respond with facts. Never accuse in evidence text.
