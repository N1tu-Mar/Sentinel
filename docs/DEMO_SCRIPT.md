# Demo script (2:00)

Before recording: `npm run seed -- receipt_confirmed_repeat canceled_before_charge_large`, then Sync from Stripe on the queue, so both cases are untouched.

| Time | Screen | Action / line |
| --- | --- | --- |
| 0:00–0:12 | Queue | "This store just got a $340 chargeback. The bank pulled the money. Seven days to prove the customer's wrong." |
| 0:12–0:20 | Dana Kim case | Inject failure → "Drop evidence submit". Click **Run agent**. |
| 0:20–0:55 | Timeline + evidence | Stripe read; Salesforce delivery note appears as a card; Gmail search; **the email card arrives: "Got the jacket, thanks!"** (pause); history shows 2 prior disputes; decision block: Fight and flag the customer. |
| 0:55–1:20 | Timeline + right panel | Submit evidence. **Red row: expected under_review, observed needs_response.** Recovery note, new idempotency key. **Green row: Recovered and confirmed.** Salesforce flag and Slack posts confirmed. "0 forbidden effects." Trace id. |
| 1:20–1:40 | Priya Shah case ($1,240) | Run agent: decides to accept, hits the $200 limit, asks for approval. Type a name, **Approve and accept**. Dispute closed, subscription canceled, confirmed. |
| 1:40–1:55 | Evaluation | Metrics and scenario table. "Reset the Arga sandbox, replayed every scenario, checked the end state in every system." |
| 1:55–2:00 | Repo + Vercel URL | — |
