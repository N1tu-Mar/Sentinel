# Demo script (2:00)

Before recording: `npm run seed -- 07 05 04`, then Sync from Stripe on the queue, so all three cases are untouched.

| Time | Screen | Action / line |
| --- | --- | --- |
| 0:00–0:12 | Queue | "Juniper & Pine just got a chargeback. The bank pulled the money. A week to prove the customer's wrong." |
| 0:12–0:20 | Alex Rivera case ($96, scenario 07) | Inject failure → "Drop evidence submit". Click **Run agent**. |
| 0:20–0:50 | Timeline + evidence | Stripe read; the Salesforce delivery record appears as a card (UPS tracking, delivered Aug 30); Gmail search; **the email card arrives: "Got it, thanks! The Insulated water bottle set arrived today"** (pause); decision block: Fight the dispute. |
| 0:50–1:15 | Timeline + right panel | Submit evidence. **Red row: expected under_review, submission_count 1; observed needs_response, 0.** Recovery note, new key `sentinel:<id>:submit_evidence:2`. **Green row: Recovered and confirmed.** Slack post read back by ts. "0 forbidden effects." Trace id. |
| 1:15–1:25 | Scenario 05 case | Two earlier lost disputes: agent fights and flags. `RISK_FLAG: friendly_fraud` confirmed, risk case and #risk post confirmed. |
| 1:25–1:40 | Sam Whitfield case ($340, scenario 04) | Cancellation email three days before the renewal charge: agent decides to accept, hits the $200 limit, asks for approval. Type a name, **Approve and accept**. Dispute lost, "Dispute accepted" case, confirmed. |
| 1:40–1:55 | Evaluation | Metrics and scenario table. "Reset the Arga sandbox, replayed every scenario, checked every system against the fixture assertions and forbidden effects." |
| 1:55–2:00 | Repo + Vercel URL | — |
