# Demo script (2:00)

Record on https://sentinel-orpin-psi.vercel.app. Production uses Stripe test mode with the in-app sandbox for Salesforce, Gmail and Slack; to record on Arga twins instead, run `npm run provision && npm run env:use -- arga` right before recording (twins last 10 minutes).

Before recording: on `/disputes`, pick **Evidence saved as draft — detect and retry** → **Simulate new dispute**, then **Canceled before charge — approval required** → **Simulate new dispute**. Don't run them yet.

| Time | Screen | Action / line |
| --- | --- | --- |
| 0:00–0:10 | Landing `/` | "The bank pulled the money back. Now prove what happened. And HTTP 200 doesn't mean done." Click **Open the dispute queue**. |
| 0:10–0:18 | Queue `/disputes` | Open Alex Rivera ($96). Inject failure → **Drop evidence submit**. Click **Run agent**. |
| 0:18–0:50 | Case: evidence + timeline | Stripe read; the Salesforce delivery record arrives as a card (UPS tracking, delivered); Gmail search; **the email card arrives: "Got it, thanks! … arrived today"** (pause); decision block: Fight the dispute, citing the evidence. |
| 0:50–1:15 | Case: timeline + right panel | Submit evidence. **Red row: expected under_review, submission_count 1; observed needs_response, 0.** Recovery note and new key `sentinel:<id>:submit_evidence:2`. **Green row: Recovered and confirmed.** Slack post read back by ts. "0 forbidden effects." Trace id → Lemma. |
| 1:15–1:25 | Sandbox `/sandbox` | The Salesforce case, the Gmail thread, and the single #disputes post the agent just verified. |
| 1:25–1:42 | Sam Whitfield case ($340) | Run agent: cancellation email three days before the renewal, so the agent decides to accept, hits the $200 limit and asks for approval. Type a name, **Approve and accept**. Dispute lost, "Dispute accepted" case, all checks green. |
| 1:42–1:55 | Evaluation `/eval` | Sandbox tab: 7/7, recovery 100%, 0 false actions, 0 constraint violations; Arga twins tab kept separately. "Reset, replayed every scenario, checked every system against the fixture assertions and forbidden effects." |
| 1:55–2:00 | Repo + URL | github.com/N1tu-Mar/Sentinel |
